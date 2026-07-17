// Procedural placeholder animation clips.
//
// If the rig ever ships baked clips, this is what they would replace. — once the purchased
// Alex Lashko rig ships Blender-authored AnimationClips inside the .glb,
// this entire file goes away. Everything downstream (useClips.ts,
// Scrubber.tsx, MovementBar.tsx) only depends on "a clip exists per
// MovementDef.key with the mapped bone names as track targets", which is
// exactly what a Blender export driving the SAME bone names would also
// produce — so nothing else needs to change, only this generator gets
// deleted and its export (`GENERATED_CLIPS`) gets replaced by clips read
// off `gltf.animations`.
//
// Until then, every clip here is built from MOVEMENTS (movements.ts) +
// joints.ts: which bones move, on which axis, which sign, clamped to
// joints.ts's ROM — never hand-authored angles.
import * as THREE from 'three'
import { MOVEMENTS, type JointMotion, type MovementDef } from '../anatomy/movements'
import { jointActionAxis, jointBone, jointRom, type Axis, type Side } from '../anatomy/joints'
import type { BoneName } from '../scene/rig'
import { BONE_LOCAL, BONE_PARENT } from '../anatomy/rigRest'

const CLIP_DURATION = 2 // seconds, per spec ("natural-looking ~2s clip")
const SAMPLE_COUNT = 33 // dense enough that slerp between samples reads as smooth easing, not linear
/** Unilateral movements (arm curl, single-leg raise, etc.) demo one side.
 * Left, to match movements.ts's `resolveMovement`'s own side default. */
const DEFAULT_SIDE: Side = 'L'

const AXIS_VECTORS: Record<Axis, THREE.Vector3> = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
}

// ---------------------------------------------------------------------------
// Easing — ease in/out with a natural "settle" at the peak, not a linear
// there-and-back. three.js's QuaternionKeyframeTrack always slerps linearly
// IN TIME between adjacent keyframes (there is no cubic/smooth interpolation
// mode for quaternion tracks), so "ease" has to come from placing many
// samples along an eased curve rather than from track interpolation mode.
// ---------------------------------------------------------------------------

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
}

/** u = normalized time in [0,1] across the whole clip. Returns a phase in
 * [0,1]: 0 at the start, eases up to 1 at the midpoint (the "peak" pose —
 * with zero velocity approaching it from both sides, so it reads as a
 * natural pause, e.g. the bottom of a squat, not a bounce), eases back to 0
 * at the end. */
function phaseAt(u: number): number {
  return u <= 0.5 ? easeInOutCubic(u / 0.5) : easeInOutCubic((1 - u) / 0.5)
}

function sampleTimes(duration: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => (i / (count - 1)) * duration)
}

// ---------------------------------------------------------------------------
// Bone drives -> QuaternionKeyframeTrack
// ---------------------------------------------------------------------------

interface BoneDrive {
  bone: BoneName
  axis: Axis
  /** Signed target angle in radians (already clamped to ROM by the caller) —
   * the pose at the eased peak (phase=1). Neutral (phase=0) is always the
   * bind-pose identity rotation. */
  target: number
}

function buildQuaternionTrack(drive: BoneDrive, times: readonly number[], phases: readonly number[]): THREE.QuaternionKeyframeTrack {
  const axisVec = AXIS_VECTORS[drive.axis]
  const values: number[] = []
  const q = new THREE.Quaternion()
  for (const phase of phases) {
    q.setFromAxisAngle(axisVec, drive.target * phase)
    values.push(q.x, q.y, q.z, q.w)
  }
  return new THREE.QuaternionKeyframeTrack(`${drive.bone}.quaternion`, times as number[], values)
}

/** The ROM-bounded target angle for a joint's FLEXION direction specifically
 * (as opposed to whatever `motion.action` literally says) — squat/sit-to-
 * stand both need "how far can this joint bend", regardless of whether the
 * muscle action driving it is concentric flexion or concentric extension. */
function flexionExtremeAngle(joint: JointMotion['joint'], side: Side): number {
  const { axis, sign } = jointActionAxis(joint, 'flexion', side)
  const rom = jointRom(joint, side, axis)
  if (!rom) throw new Error(`placeholderClips: no ROM for ${joint}/${axis}`)
  return sign === -1 ? rom.min : rom.max
}

/**
 * joints.ts's hip flexion ROM (120deg, per spec) is the standard clinical
 * figure for the HIP JOINT — but that figure is conventionally measured
 * with the KNEE BENT, which slackens the hamstrings. `hip_flexion` here is
 * a single-joint demo that does NOT also bend the knee (movements.ts's
 * motion list for it is just `{joint:'hip', action:'flexion'}`), so
 * animating a dead-straight leg all the way to 120deg produces a
 * dancer-level high kick well above horizontal — not a pose most people can
 * actually do, which fails the "humanly possible" requirement even though
 * 120deg is a correct number for the joint itself. Scale the STRAIGHT-LEG
 * demo back to a realistic straight-leg raise instead (still a strong,
 * clearly-a-real-movement pose, just short of horizontal). This does NOT
 * change joints.ts's ROM_TABLE — that stays the accurate clinical 120deg
 * for the later IK phase, which drives the knee independently and won't
 * have this straight-leg artifact. */
const SINGLE_JOINT_DEMO_FRACTION: Partial<Record<string, number>> = {
  hip_flexion: 0.7, // 120deg * 0.7 = 84deg — a high but achievable straight-leg raise
}

/** Resolve one `JointMotion` (from a single-joint MovementDef) to a bone
 * drive, clamped to joints.ts's ROM. When the named action's own ROM bound
 * sits at neutral (true only for elbow/knee "extension" — a joint that
 * can't hyperextend has literally zero range past straight), fall back to
 * the OPPOSITE bound: the clip still needs to show visible motion, and
 * "extension" from a bent reference pose back to neutral is exactly what
 * the eased 0->peak->0 curve produces when peak = the flexed bound. */
function resolveSingleJointDrive(motion: JointMotion, movementKey: string): BoneDrive {
  const side: Side = motion.joint === 'spine' ? 'C' : DEFAULT_SIDE
  const bone = jointBone(motion.joint, side)
  const { axis, sign } = jointActionAxis(motion.joint, motion.action, side)
  const rom = jointRom(motion.joint, side, axis)
  if (!rom) throw new Error(`placeholderClips: no ROM for ${motion.joint}/${axis}`)

  let target = sign === 1 ? rom.max : rom.min
  if (Math.abs(target) < 1e-6) {
    target = sign === 1 ? rom.min : rom.max
  }
  target *= SINGLE_JOINT_DEMO_FRACTION[movementKey] ?? 1
  return { bone, axis, target }
}

function buildSingleMotionClip(movement: MovementDef): THREE.AnimationClip {
  const times = sampleTimes(CLIP_DURATION, SAMPLE_COUNT)
  const phases = times.map((t) => phaseAt(t / CLIP_DURATION))
  const tracks = movement.motions.map((motion) => buildQuaternionTrack(resolveSingleJointDrive(motion, movement.key), times, phases))
  return new THREE.AnimationClip(movement.key, CLIP_DURATION, tracks)
}

// ---------------------------------------------------------------------------
// Bilateral leg-compound clips (squat, sit_to_stand) — the ones the task
// calls out as needing to look like an actual squat/sit, not a robot.
//
// Rotating the thigh (hip flexion) and shin (knee flexion) alone, with the
// hips bone held at its bind position, does NOT keep the foot on the
// ground — the whole leg swings as a pendulum from a fixed pelvis, so the
// foot lifts into the air (or, at other angle combinations, would need to
// pass through the floor to stay reachable). A real squat/sit-to-stand
// keeps the feet planted and instead translates the PELVIS down and
// (slightly) back. We solve this by literal forward kinematics on a scratch
// (unrendered) copy of the same skeleton buildMannequin.ts produces: for
// each sampled phase, rotate the scratch left thigh/shin/foot to that
// phase's angles with the hips held at bind position, read off where the
// ankle ends up, and write a hips.position track that shifts the pelvis by
// exactly the Y delta needed to put the ankle back at its standing-height
// bind position. Both legs share one Y offset — squat/sit-to-stand are
// left-right symmetric, so the left leg's solve applies equally to the
// right.
// ---------------------------------------------------------------------------

interface LegCompoundOptions {
  /** Fraction of the joint's full flexion ROM to actually use — a squat
   * doesn't need to drive the hip to its absolute anatomical limit to read
   * as a real squat, and stopping short of the hard ROM wall also keeps
   * the pose looking like effort/control rather than a marionette snapping
   * to its limit. */
  hipFraction: number
  kneeFraction: number
  includeAnkle: boolean
  /** Forward trunk lean, as a fraction of spine flexion ROM — not part of
   * `movement.motions` (which only lists the joints listed in
   * ARCHITECTURE.md's movement table), but without it the torso stays
   * bolt upright over moving hips/knees, which is exactly the "looks like
   * a robot" failure mode the task calls out. A slight forward lean is
   * anatomically correct for both squat and sit-to-stand (keeps the
   * center of mass over the base of support) and is exactly why
   * erector_spinae/rectus_abdominis are listed as synergists for both in
   * movements.ts — they're working to control this lean. */
  spineLeanFraction: number
}

/**
 * Lazily-built, module-scoped scratch skeleton used ONLY for the forward-
 * kinematics solve above — never rendered, never added to a scene.
 *
 * Built from `rigRest`, which tools/build-anatomy.mjs emits from the same run
 * that writes anatomy.glb. That matters: this solve is entirely about limb
 * proportions, and it used to run against a hand-made placeholder whose thigh
 * was 0.40m while the shipped model's is 0.455m — so it was computing the
 * pelvis drop for a body that wasn't on screen.
 */
let scratchBones: Record<BoneName, THREE.Bone> | null = null
function getScratchBones(): Record<BoneName, THREE.Bone> {
  if (!scratchBones) {
    const bones = {} as Record<BoneName, THREE.Bone>
    for (const name of Object.keys(BONE_PARENT) as BoneName[]) {
      const b = new THREE.Bone()
      b.name = name
      b.position.fromArray(BONE_LOCAL[name] as unknown as number[])
      bones[name] = b
    }
    // Parents precede children in BONE_PARENT's declaration order, so a single
    // pass wires the whole hierarchy.
    for (const name of Object.keys(BONE_PARENT) as BoneName[]) {
      const parent = BONE_PARENT[name]
      if (parent) bones[parent].add(bones[name])
    }
    bones.hips.updateMatrixWorld(true)
    scratchBones = bones
  }
  return scratchBones
}

function computeCompensatedHipsPositionTrack(
  times: readonly number[],
  phases: readonly number[],
  hipTarget: number,
  kneeTarget: number,
  ankleTarget: number,
): THREE.VectorKeyframeTrack {
  const bones = getScratchBones()
  const bindX = bones.hips.position.x
  const bindY = bones.hips.position.y
  const bindZ = bones.hips.position.z

  bones.thigh_L.quaternion.identity()
  bones.shin_L.quaternion.identity()
  bones.foot_L.quaternion.identity()
  bones.hips.updateMatrixWorld(true)
  const p = new THREE.Vector3()
  bones.foot_L.getWorldPosition(p)
  const standingAnkleY = p.y

  const values: number[] = []
  const xAxis = AXIS_VECTORS.x
  for (const phase of phases) {
    bones.thigh_L.quaternion.setFromAxisAngle(xAxis, hipTarget * phase)
    bones.shin_L.quaternion.setFromAxisAngle(xAxis, kneeTarget * phase)
    bones.foot_L.quaternion.setFromAxisAngle(xAxis, ankleTarget * phase)
    bones.hips.updateMatrixWorld(true)
    bones.foot_L.getWorldPosition(p)
    const dy = standingAnkleY - p.y
    values.push(bindX, bindY + dy, bindZ)
  }

  // Leave the scratch skeleton neutral for any subsequent solve.
  bones.thigh_L.quaternion.identity()
  bones.shin_L.quaternion.identity()
  bones.foot_L.quaternion.identity()

  return new THREE.VectorKeyframeTrack('hips.position', times as number[], values)
}

function buildLegCompoundClip(movement: MovementDef, opts: LegCompoundOptions): THREE.AnimationClip {
  const hipTarget = flexionExtremeAngle('hip', 'L') * opts.hipFraction
  const kneeTarget = flexionExtremeAngle('knee', 'L') * opts.kneeFraction
  const ankleTarget = opts.includeAnkle ? flexionExtremeAngle('ankle', 'L') : 0
  const spineTarget = flexionExtremeAngle('spine', 'C') * opts.spineLeanFraction

  const drives: BoneDrive[] = []
  for (const side of ['L', 'R'] as const) {
    drives.push({ bone: jointBone('hip', side), axis: 'x', target: hipTarget })
    drives.push({ bone: jointBone('knee', side), axis: 'x', target: kneeTarget })
    if (opts.includeAnkle) drives.push({ bone: jointBone('ankle', side), axis: 'x', target: ankleTarget })
  }
  drives.push({ bone: jointBone('spine', 'C'), axis: 'x', target: spineTarget })

  const times = sampleTimes(CLIP_DURATION, SAMPLE_COUNT)
  const phases = times.map((t) => phaseAt(t / CLIP_DURATION))

  const tracks: THREE.KeyframeTrack[] = drives.map((d) => buildQuaternionTrack(d, times, phases))
  tracks.push(computeCompensatedHipsPositionTrack(times, phases, hipTarget, kneeTarget, ankleTarget))

  return new THREE.AnimationClip(movement.key, CLIP_DURATION, tracks)
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/**
 * A shrug lifts the shoulders and leaves the arms hanging.
 *
 * That needs saying because it isn't what rotating the girdle does on its own:
 * the arm is the girdle's child, so elevating the girdle carries the whole arm
 * up and out with it, and the figure ends up shaped like a scarecrow instead of
 * someone shrugging. A real shoulder joint absorbs that rotation — you shrug and
 * your arms stay by your sides — so the clip counter-rotates the humerus by
 * exactly what the girdle gained.
 *
 * Bilateral by hand: buildSingleMotionClip drives one DEFAULT_SIDE, and a
 * one-shouldered shrug is not a shrug.
 */
function buildShrugClip(movement: MovementDef): THREE.AnimationClip {
  const times = sampleTimes(CLIP_DURATION, SAMPLE_COUNT)
  const phases = times.map((t) => phaseAt(t / CLIP_DURATION))
  const tracks: THREE.KeyframeTrack[] = []

  for (const side of ['L', 'R'] as const) {
    const { axis, sign } = jointActionAxis('scapula', 'elevation', side)
    const rom = jointRom('scapula', side, axis)
    if (!rom) throw new Error(`generatedClips: no ROM for scapula/${axis}`)
    const lift = sign === 1 ? rom.max : rom.min

    tracks.push(buildQuaternionTrack({ bone: jointBone('scapula', side), axis, target: lift }, times, phases))
    // The arm gives back what the girdle took. Same axis, opposite sign, so
    // the humerus ends up hanging exactly where it started.
    tracks.push(buildQuaternionTrack({ bone: jointBone('shoulder', side), axis, target: -lift }, times, phases))
  }
  return new THREE.AnimationClip(movement.key, CLIP_DURATION, tracks)
}

function buildClipForMovement(movement: MovementDef): THREE.AnimationClip {
  switch (movement.key) {
    case 'shoulder_shrug':
      return buildShrugClip(movement)
    case 'squat':
      // Deep-ish squat: full ankle dorsiflexion (its ROM is tiny anyway),
      // hip/knee to 85% of ROM (a hard "ATG" squat sits right at the ROM
      // wall, which reads as an anatomical edge case rather than a typical
      // squat) plus a real forward trunk lean.
      return buildLegCompoundClip(movement, { hipFraction: 0.85, kneeFraction: 0.85, includeAnkle: true, spineLeanFraction: 0.35 })
    case 'sit_to_stand':
      // Chair height rather than full squat depth, no explicit ankle
      // motion (movements.ts's motion list for this key doesn't include
      // the ankle — tibialis anterior is a synergist here, not a prime
      // mover of a large ankle excursion), slightly less trunk lean.
      return buildLegCompoundClip(movement, { hipFraction: 0.72, kneeFraction: 0.72, includeAnkle: false, spineLeanFraction: 0.22 })
    default:
      return buildSingleMotionClip(movement)
  }
}

function buildAllClips(): Map<string, THREE.AnimationClip> {
  const map = new Map<string, THREE.AnimationClip>()
  for (const movement of MOVEMENTS) {
    map.set(movement.key, buildClipForMovement(movement))
  }
  return map
}

/** movement.key -> generated AnimationClip. Built once at module load
 * (pure function of MOVEMENTS + joints.ts, no external state). */
export const GENERATED_CLIPS: ReadonlyMap<string, THREE.AnimationClip> = buildAllClips()

export function getPlaceholderClip(key: string): THREE.AnimationClip | undefined {
  return GENERATED_CLIPS.get(key)
}
