// Constrained inverse kinematics for drag-to-pose.
//
// ---------------------------------------------------------------------------
// WHY NOT THREE.CCDIKSolver (a deliberate revision of ARCHITECTURE.md §0/§2.2)
// ---------------------------------------------------------------------------
// The architecture originally specced `THREE.CCDIKSolver`. Once joints.ts
// existed, a custom solver turned out to be both smaller and strictly safer:
//
//  1. joints.ts models range-of-motion as "a signed angle about ONE named
//     local axis, clamped to [min,max]" (see its RomRange). CCDIKSolver takes
//     `rotationMin`/`rotationMax` as Euler boxes applied after an unconstrained
//     3-DOF rotation — a different shape that would need a lossy translation
//     step, and which permits off-axis rotation that our ROM model has no
//     opinion about (a shoulder that twists axially, an elbow that bends
//     sideways). Those are exactly the non-human poses the ROM exists to stop.
//  2. This solver only ever rotates about a joint's ALLOWED axes, so an
//     impossible pose is unrepresentable by construction rather than clamped
//     back after the fact. That's the user's hard requirement
//     ("인간이 가능한 동작 내에서 구현해야해") enforced structurally.
//  3. CCDIKSolver requires target/effector nodes to be real bones inside the
//     Skeleton, which means mutating the rig just to drag it, and it carries
//     an open upstream bug (three.js#29682) where constraints silently break
//     if any bind-pose rotation falls outside [-pi, pi]. Neither risk buys us
//     anything here.
//
// The algorithm is still plain CCD (cyclic coordinate descent): walk the chain
// from the joint nearest the grabbed point up toward the root, and at each
// joint rotate to bring the effector as close to the target as that joint's
// single allowed axis permits. Repeat until it converges.
// ---------------------------------------------------------------------------

import * as THREE from 'three'
import type { BoneName, Mannequin } from '../scene/rig'
import type { JointAction, JointMotion, JointName } from '../anatomy/movements'
import { clampToRom, jointActionAxis, jointRom, type Axis, type Side } from '../anatomy/joints'

/**
 * The axes a joint may actually be posed about.
 *
 * Narrower than joints.ts's `Axis` on purpose: no joint in this app models
 * axial ('y') rotation — joints.ts has no ROM for it and its own docs say an
 * axis without a ROM entry is "no rotation allowed", never "unlimited". Baking
 * that into the type means an unconstrained twist can't be expressed here even
 * by accident.
 */
export type PoseAxis = Extract<Axis, 'x' | 'z'>

/** One rotatable joint in a drag chain. */
export interface ChainLink {
  bone: BoneName
  joint: JointName
  side: Side
  /** Degrees of freedom this joint actually has, derived from joints.ts. */
  axes: readonly PoseAxis[]
}

export interface DragTarget {
  key: string
  /** Korean label, for the handle's accessible name / debug UI. */
  label: string
  /**
   * The bone whose ORIGIN is the point the user grabs. Bone origins sit at
   * the joint itself (a bone's head), so `forearm_L`'s origin IS the left
   * elbow — grabbing "the elbow" means dragging `forearm_L`'s origin.
   */
  effector: BoneName
  /** Ordered effector-most -> root-most. CCD must iterate in this order. */
  chain: readonly ChainLink[]
  side: 'L' | 'R'
}

/**
 * Per-bone rotation state, in the exact signed-angle-about-a-named-axis space
 * joints.ts's ROM uses.
 *
 * We track angles explicitly instead of reading them back off the bone's
 * quaternion each frame. Reading back would let tiny off-axis numerical drift
 * accumulate into rotation we never sanctioned, and would make the ROM clamp
 * approximate. Here, the bone's rotation is *by definition* only ever the
 * composition of its allowed axes — there is no other DOF to drift into.
 */
export type BonePose = { x: number; z: number }
export type PoseState = Map<BoneName, BonePose>

const AXES: readonly PoseAxis[] = ['x', 'z']
const ALL_ACTIONS: readonly JointAction[] = ['flexion', 'extension', 'abduction', 'adduction']

/** Which axes this joint may rotate about: exactly those joints.ts gives a
 * ROM for. An axis with no ROM entry is not a degree of freedom (joints.ts's
 * own docs: treat `undefined` as "no rotation allowed", never as "unlimited"). */
function axesFor(joint: JointName, side: Side): PoseAxis[] {
  return AXES.filter((axis) => jointRom(joint, side, axis) !== undefined)
}

function link(bone: BoneName, joint: JointName, side: Side): ChainLink {
  return { bone, joint, side, axes: axesFor(joint, side) }
}

function limbTargets(side: 'L' | 'R'): DragTarget[] {
  const shoulder = link(`upperArm_${side}`, 'shoulder', side)
  const elbow = link(`forearm_${side}`, 'elbow', side)
  const hip = link(`thigh_${side}`, 'hip', side)
  const knee = link(`shin_${side}`, 'knee', side)

  const ko = side === 'L' ? '왼' : '오른'
  return [
    // Grabbing the elbow only drives the shoulder — the elbow's own angle is
    // not what moves it through space.
    { key: `elbow_${side}`, label: `${ko}쪽 팔꿈치`, effector: `forearm_${side}`, chain: [shoulder], side },
    // Grabbing the wrist drives elbow + shoulder together: the user's own
    // example ("팔꿈치를 들고 위로 드래그하면 ... 손을 들게 되는거야").
    { key: `wrist_${side}`, label: `${ko}쪽 손목`, effector: `hand_${side}`, chain: [elbow, shoulder], side },
    { key: `knee_${side}`, label: `${ko}쪽 무릎`, effector: `shin_${side}`, chain: [hip], side },
    { key: `ankle_${side}`, label: `${ko}쪽 발목`, effector: `foot_${side}`, chain: [knee, hip], side },
  ]
}

export const DRAG_TARGETS: readonly DragTarget[] = [...limbTargets('L'), ...limbTargets('R')]

export const DRAG_TARGET_BY_KEY: ReadonlyMap<string, DragTarget> = new Map(
  DRAG_TARGETS.map((t) => [t.key, t]),
)

export function createPoseState(): PoseState {
  return new Map()
}

export function getBonePose(state: PoseState, bone: BoneName): BonePose {
  let pose = state.get(bone)
  if (!pose) {
    pose = { x: 0, z: 0 }
    state.set(bone, pose)
  }
  return pose
}

/**
 * Write a bone's tracked angles onto its quaternion.
 *
 * Euler order 'XYZ' means the composed rotation is Rx * Ry * Rz, i.e. the Z
 * rotation is applied in the bone's own frame and the X rotation in the
 * parent's. `worldAxis()` below depends on exactly that fact — change the
 * order here and it must change there too.
 */
const scratchEuler = new THREE.Euler()
export function applyBonePose(bone: THREE.Bone, pose: BonePose): void {
  scratchEuler.set(pose.x, 0, pose.z, 'XYZ')
  bone.quaternion.setFromEuler(scratchEuler)
}

/** Seed the tracked angles from a bone's current rotation. Called when a drag
 * starts so IK continues smoothly from wherever a clip left the limb, instead
 * of snapping it back to bind pose under the user's finger. */
export function syncPoseFromBones(state: PoseState, mannequin: Mannequin, target: DragTarget): void {
  for (const l of target.chain) {
    const bone = mannequin.bonesByName[l.bone]
    const pose = getBonePose(state, l.bone)
    pose.x = l.axes.includes('x') ? bone.rotation.x : 0
    pose.z = l.axes.includes('z') ? bone.rotation.z : 0
    // Whatever the clip left on an axis this joint doesn't own is not a pose
    // we're willing to keep — normalise it away on the first solve.
    applyBonePose(bone, pose)
  }
}

// -- solve ------------------------------------------------------------------

const vBone = new THREE.Vector3()
const vEffector = new THREE.Vector3()
const vToEffector = new THREE.Vector3()
const vToTarget = new THREE.Vector3()
const vCross = new THREE.Vector3()
const vAxis = new THREE.Vector3()
const qParent = new THREE.Quaternion()
const qBone = new THREE.Quaternion()

/**
 * The world-space axis that changing `axis` actually rotates the bone about.
 *
 * Given local rotation R = Rx * Rz (Euler 'XYZ' with y fixed at 0):
 *  - perturbing x gives Rx' * Rz = (dRx) * R, a rotation about the PARENT's x
 *  - perturbing z gives Rx * Rz' = R * (dRz), a rotation about the BONE's own z
 *
 * Getting this wrong doesn't throw — it just makes CCD converge to the wrong
 * pose or oscillate, which is why it's spelled out rather than hand-waved.
 */
function worldAxis(bone: THREE.Bone, axis: PoseAxis, out: THREE.Vector3): THREE.Vector3 {
  if (axis === 'x') {
    if (bone.parent) bone.parent.getWorldQuaternion(qParent)
    else qParent.identity()
    out.set(1, 0, 0).applyQuaternion(qParent)
  } else {
    bone.getWorldQuaternion(qBone)
    out.set(0, 0, 1).applyQuaternion(qBone)
  }
  return out.normalize()
}

/** Signed angle from `from` to `to` measured about `axis`, with both vectors
 * first flattened into the plane perpendicular to `axis` (rotation about an
 * axis can't affect the component along it). Returns 0 when either vector is
 * degenerate after flattening — i.e. the effector sits on the rotation axis,
 * where no rotation about it helps. */
function signedAngleAbout(from: THREE.Vector3, to: THREE.Vector3, axis: THREE.Vector3): number {
  const f = from.clone().projectOnPlane(axis)
  const t = to.clone().projectOnPlane(axis)
  if (f.lengthSq() < 1e-8 || t.lengthSq() < 1e-8) return 0
  f.normalize()
  t.normalize()
  const dot = THREE.MathUtils.clamp(f.dot(t), -1, 1)
  vCross.crossVectors(f, t)
  return Math.atan2(vCross.dot(axis), dot)
}

export interface SolveOptions {
  iterations?: number
  /** Stop early once the effector is within this distance (metres). */
  tolerance?: number
}

/**
 * Drag `target`'s effector toward `targetWorld`, rotating only the chain's
 * joints and only about their allowed axes, never outside their ROM.
 *
 * Mutates both `state` and the live bone quaternions. Returns the final
 * distance from effector to target (useful for telling "solved" from
 * "reached its anatomical limit" — the latter is expected and correct, e.g.
 * dragging a hand further than the arm is long).
 */
export function solveDrag(
  mannequin: Mannequin,
  target: DragTarget,
  targetWorld: THREE.Vector3,
  state: PoseState,
  { iterations = 10, tolerance = 0.001 }: SolveOptions = {},
): number {
  const effectorBone = mannequin.bonesByName[target.effector]

  for (let i = 0; i < iterations; i++) {
    for (const l of target.chain) {
      const bone = mannequin.bonesByName[l.bone]
      const pose = getBonePose(state, l.bone)

      for (const axis of l.axes) {
        vBone.setFromMatrixPosition(bone.matrixWorld)
        vEffector.setFromMatrixPosition(effectorBone.matrixWorld)

        vToEffector.subVectors(vEffector, vBone)
        vToTarget.subVectors(targetWorld, vBone)
        worldAxis(bone, axis, vAxis)

        const delta = signedAngleAbout(vToEffector, vToTarget, vAxis)
        if (delta === 0) continue

        // Clamping here — not after a free rotation — is what makes an
        // out-of-range pose unreachable rather than merely corrected.
        pose[axis] = clampToRom(l.joint, l.side, axis, pose[axis] + delta)
        applyBonePose(bone, pose)
        // Refresh descendants so the next axis/link sees where the effector
        // actually ended up, not where it was at the top of the iteration.
        bone.updateMatrixWorld(true)
      }
    }

    vEffector.setFromMatrixPosition(effectorBone.matrixWorld)
    if (vEffector.distanceTo(targetWorld) < tolerance) break
  }

  vEffector.setFromMatrixPosition(effectorBone.matrixWorld)
  return vEffector.distanceTo(targetWorld)
}

// -- movement recognition ---------------------------------------------------

/** Angle below which a joint counts as "not deliberately moved" (~1.7deg).
 * Keeps IK's own sub-degree residuals from lighting up muscles. */
const MOTION_EPSILON = 0.03

/** Which anatomical action a signed rotation on this axis corresponds to.
 * Inverts joints.ts's (action -> axis+sign) table; returns null for a
 * direction that isn't a modeled action. */
function actionFor(joint: JointName, side: Side, axis: PoseAxis, delta: number): JointAction | null {
  const sign = delta > 0 ? 1 : -1
  for (const action of ALL_ACTIONS) {
    let entry
    try {
      entry = jointActionAxis(joint, action, side)
    } catch {
      // joints.ts throws rather than guessing for unmodeled combinations.
      // Here that's expected (e.g. an elbow has no abduction), so skip it.
      continue
    }
    if (entry.axis === axis && entry.sign === sign) return action
  }
  return null
}

/**
 * Read the pose as a set of anatomical joint motions.
 *
 * Measured against BIND POSE (angle 0), not against the previous frame: the
 * question the app answers is "which muscles hold you in the pose you're in",
 * so a raised arm keeps its muscles lit while it's held, rather than only
 * flashing them while the finger is moving.
 */
export function recognizeMotions(target: DragTarget, state: PoseState): JointMotion[] {
  const motions: JointMotion[] = []
  for (const l of target.chain) {
    const pose = state.get(l.bone)
    if (!pose) continue
    for (const axis of l.axes) {
      const angle = pose[axis]
      if (Math.abs(angle) < MOTION_EPSILON) continue
      const action = actionFor(l.joint, l.side, axis, angle)
      if (action) motions.push({ joint: l.joint, action })
    }
  }
  return motions
}

/** Reset every dragged bone back to bind pose. */
export function resetPose(mannequin: Mannequin, state: PoseState): void {
  for (const [boneName, pose] of state) {
    pose.x = 0
    pose.z = 0
    applyBonePose(mannequin.bonesByName[boneName], pose)
  }
  mannequin.bonesByName.hips.updateMatrixWorld(true)
}
