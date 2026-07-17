// Rig mapping layer — the seam between anatomy (movements.ts) and the
// concrete skeleton (public/models/anatomy.glb, built by tools/build-anatomy.mjs
// from BodyParts3D / Z-Anatomy).
//
// movements.ts knows *that* "shoulder flexion" happens. This file knows
// *how* that looks on the actual bones: which bone to rotate, which local
// axis, which sign, and how far it's allowed to go. If the rig is ever
// rebuilt or replaced, ONLY this file needs recalibrating — re-run
// `node tools/calibrate-joints.mjs`, which performs exactly the procedure
// described below against whatever rig is currently shipped.
//
// ---------------------------------------------------------------------------
// HOW THE SIGNS WERE DERIVED (read this before touching any number below)
// ---------------------------------------------------------------------------
// The rig's bind pose is translation-only — build-anatomy.mjs writes bone
// nodes with a `translation` and no rotation. So at bind pose each bone's
// LOCAL axes are exactly the WORLD axes, which makes empirical verification
// tractable: rotate a bone by a *known* signed angle about a *known* axis and
// read which way its child actually moves in world space.
//
// App space: +X = the figure's own LEFT, +Y = up, +Z = anterior (the figure
// faces the camera). Note this is a real rotation of the source data, not a
// mirror — see build-anatomy.mjs, which explains why the naive "left = -X"
// mapping has determinant -1 and would flip the model's chirality.
//
// Procedure (tools/calibrate-joints.mjs, re-runnable):
//   1. Rebuild the bone graph from the shipped GLB itself, not from a copy of
//      the numbers — the file is the source of truth.
//   2. For each joint's driving bone (e.g. `forearm_L` for the elbow), watch
//      its child (`hand_L`).
//   3. Rotate by +20deg AND -20deg, both measured explicitly rather than
//      inferring one by negating the other: the up/down component of the
//      delta is even in the angle (a cos term) and does NOT flip sign, while
//      the anterior/posterior and medial/lateral components do. Conflating
//      them misclassifies the axis.
//   4. Read the child's world-space delta and classify it anatomically.
//
// Measured results (angle -> world delta of the child):
//
//   SHOULDER  upperArm_L/R, watch forearm_X
//     x  +20deg -> Z:-0.101 (posterior)   -20deg -> Z:+0.102 (anterior)
//     => flexion (raising the arm forward) is NEGATIVE x, both sides.
//     z  L: +20deg -> X:+0.099 = away from midline = ABDUCTION
//        R: +20deg -> X:+0.104 = toward midline   = ADDUCTION
//     => shoulder_L abduction is POSITIVE z, shoulder_R NEGATIVE z.
//
//   ELBOW  forearm_L/R, watch hand_X
//     x  +20deg -> Z:-0.080 (posterior)   -20deg -> Z:+0.075 (anterior)
//     => flexion (a bicep curl swings the forearm anterior) is NEGATIVE x.
//
//   HIP  thigh_L/R, watch shin_X
//     x  +20deg -> Z:-0.155 (posterior)   -20deg -> Z:+0.156 (anterior)
//     => flexion is NEGATIVE x. Mirrors the shoulder exactly, but measured
//        independently rather than assumed.
//     z  L: +20deg -> X:+0.157 = ABDUCTION;  R: +20deg -> X:+0.154 = ADDUCTION
//
//   KNEE  shin_L/R, watch foot_X
//     x  +20deg -> Z:-0.128 (posterior)   -20deg -> Z:+0.128 (anterior)
//     => KEY DIFFERENCE FROM THE ELBOW: at bind pose the shin hangs straight
//        down, which IS full extension — same as the elbow. But a knee only
//        bends one way, BACKWARD (the heel swings up behind you), which is
//        the posterior direction. So knee flexion is POSITIVE x, the opposite
//        convention from the elbow. Assuming one global convention here is
//        exactly the "knee that hyperextends forward" failure mode.
//
//   SPINE  spine, watch chest
//     x  +20deg -> Z:+0.071 (anterior) = forward bend = FLEXION
//     => spine flexion is POSITIVE x — opposite to the limbs, purely because
//        the marker sits above the joint rather than below it.
//
//   ANKLE  foot_L/R (a leaf bone, so calibrate-joints.mjs skips it)
//     The foot mesh extends anteriorly (+Z) from the ankle, so a +x rotation
//     carries the toes toward -Y (down) = PLANTARFLEXION. Dorsiflexion — the
//     direction the ankle travels during a squat descent, per movements.ts's
//     squat entry — is therefore NEGATIVE x.
//
//   MIRRORING RULE, and the one thing that changed when the real anatomy
//   replaced the placeholder mannequin: sagittal-plane actions
//   (flexion/extension) are NOT mirrored — both sides share a sign, because
//   the sagittal plane is unchanged by swapping left and right. Coronal-plane
//   actions (abduction/adduction) ARE mirrored, and their signs INVERTED
//   versus the old placeholder rig, which had put the figure's left at -X.
//   Nothing else moved. This is why the calibration is a measurement and not
//   an argument: "only the mirrored ones flip" is easy to say afterwards and
//   easy to get backwards in advance, and a wrong sign here doesn't crash —
//   it just quietly highlights the wrong muscles.
//
//   y-axis (all joints tested): near-zero, directionally unclean — that's
//   axial (internal/external) rotation, which no `JointAction` in movements.ts
//   models. So no joint below has a `y` mapping; looking one up throws
//   (see `jointActionAxis`).
//
// Every ROM number the user specified verbatim (elbow, shoulder flexion/
// abduction, knee, hip flexion/extension, spine flexion) is tagged
// "spec". Numbers this file had to fill in because a `JointAction` used in
// movements.ts needed *some* bound but the user didn't hand one over
// (shoulder extension, shoulder/hip adduction, ankle dorsi/plantarflexion,
// spine extension) are tagged "clinical estimate" with the source range —
// conservative, standard textbook ROM (Kendall / Neumann / AAOS), not a
// guess made up for convenience.
// ---------------------------------------------------------------------------

import type { JointAction, JointName } from './movements'
import type { BoneName } from '../scene/rig'

export type Side = 'L' | 'R' | 'C'
export type Axis = 'x' | 'y' | 'z'

export interface AxisSign {
  axis: Axis
  sign: 1 | -1
}

/** A rotation clamp in RADIANS, in the same raw local-quaternion-angle space
 * that `jointActionAxis`'s sign convention operates in (i.e. `min`/`max` are
 * signed raw angles about `axis`, not unsigned "degrees of flexion"). This is
 * deliberate: it's exactly the box-constraint shape `THREE.CCDIKSolver`
 * bone constraints and clip generation both want directly, with no
 * reinterpretation step. */
export interface RomRange {
  axis: Axis
  min: number
  max: number
}

const deg = (d: number): number => (d * Math.PI) / 180

// ---------------------------------------------------------------------------
// 1. (JointName, side) -> concrete bone name
// ---------------------------------------------------------------------------

/** Which bone a joint's rotation is actuated on. Matches the task's worked
 * examples exactly: the joint is where two segments meet, but the rig has no
 * separate "joint" node — the DISTAL bone is what rotates to bend the joint
 * (e.g. 'elbow' bends by rotating `forearm_L`, not `upperArm_L`). */
export function jointBone(joint: JointName, side: Side): BoneName {
  switch (joint) {
    case 'shoulder':
      return `upperArm_${assertLR(joint, side)}` as BoneName
    case 'elbow':
      return `forearm_${assertLR(joint, side)}` as BoneName
    case 'hip':
      return `thigh_${assertLR(joint, side)}` as BoneName
    case 'knee':
      return `shin_${assertLR(joint, side)}` as BoneName
    case 'ankle':
      return `foot_${assertLR(joint, side)}` as BoneName
    case 'spine':
      return 'spine'
    default:
      throw new Error(`jointBone: unhandled joint "${joint satisfies never}"`)
  }
}

function assertLR(joint: JointName, side: Side): 'L' | 'R' {
  if (side !== 'L' && side !== 'R') {
    throw new Error(`jointBone: joint "${joint}" is a paired limb joint and needs side 'L' or 'R', got '${side}'`)
  }
  return side
}

// ---------------------------------------------------------------------------
// 2. (JointName, JointAction, side) -> {axis, sign}
// ---------------------------------------------------------------------------
// Keyed by `${joint}:${action}:${side}`. Built from the empirically-measured
// table in the header comment. Flexion/extension (sagittal plane) share one
// sign between L and R; abduction/adduction (coronal plane, relative to the
// body midline) flip sign between L and R — see the mirroring notes above.
// `spine` has no side (center joint) and is stored under 'C'.

const AXIS_TABLE: Record<string, AxisSign> = {}

function setAxis(joint: JointName, action: JointAction, side: Side, axis: Axis, sign: 1 | -1): void {
  AXIS_TABLE[`${joint}:${action}:${side}`] = { axis, sign }
}
/** Register a (joint, action) whose sign is NOT mirrored between sides
 * (every flexion/extension pair in this rig — verified independently for
 * each joint above, not assumed). */
function setUnmirrored(joint: JointName, action: JointAction, axis: Axis, sign: 1 | -1): void {
  setAxis(joint, action, 'L', axis, sign)
  setAxis(joint, action, 'R', axis, sign)
}
/** Register a mirrored (joint, action) pair: L gets `signL`, R gets the
 * negation. Used only for abduction/adduction. */
function setMirrored(joint: JointName, action: JointAction, axis: Axis, signL: 1 | -1): void {
  setAxis(joint, action, 'L', axis, signL)
  setAxis(joint, action, 'R', axis, signL === 1 ? -1 : 1)
}

// -- shoulder --
setUnmirrored('shoulder', 'flexion', 'x', -1)
setUnmirrored('shoulder', 'extension', 'x', 1)
setMirrored('shoulder', 'abduction', 'z', 1) // L: +z, R: -z
setMirrored('shoulder', 'adduction', 'z', -1) // L: -z, R: +z (opposite of abduction, both sides)

// -- elbow (hinge: flexion anterior, sign -1; extension is just the reverse
// traversal of the same DOF, so its (axis,sign) is the measured -20deg
// direction negated — which for a pure hinge is also the empirically
// measured +20deg direction, so this is a direct measurement, not a guess) --
setUnmirrored('elbow', 'flexion', 'x', -1)
setUnmirrored('elbow', 'extension', 'x', 1)

// -- hip --
setUnmirrored('hip', 'flexion', 'x', -1)
setUnmirrored('hip', 'extension', 'x', 1)
setMirrored('hip', 'abduction', 'z', 1)
setMirrored('hip', 'adduction', 'z', -1)

// -- knee (hinge: flexion is POSTERIOR, i.e. sign +1 — opposite convention
// from elbow; see header comment) --
setUnmirrored('knee', 'flexion', 'x', 1)
setUnmirrored('knee', 'extension', 'x', -1)

// -- ankle (only 'flexion' i.e. dorsiflexion is used by movements.ts today,
// via squat; extension/plantarflexion mapped too for completeness since the
// IK phase may want it later) --
setUnmirrored('ankle', 'flexion', 'x', -1)
setUnmirrored('ankle', 'extension', 'x', 1)

// -- spine (center joint; sign convention is FLIPPED from every limb above —
// positive x is flexion here, see header comment) --
setAxis('spine', 'flexion', 'C', 'x', 1)
setAxis('spine', 'extension', 'C', 'x', -1)

export function jointActionAxis(joint: JointName, action: JointAction, side: Side): AxisSign {
  const key = `${joint}:${action}:${side}`
  const entry = AXIS_TABLE[key]
  if (!entry) {
    throw new Error(
      `jointActionAxis: no mapping for joint="${joint}" action="${action}" side="${side}". ` +
        `This combination isn't anatomically modeled (or hasn't been calibrated yet) — ` +
        `add it to joints.ts deliberately rather than guessing a fallback.`,
    )
  }
  return entry
}

// ---------------------------------------------------------------------------
// 3. Range of motion — single source of truth, consumed by clip generation
//    (placeholderClips.ts) AND, later, the IK phase's CCDIKSolver
//    constraints. Values are clinically realistic, adult, healthy-ROM
//    ballpark figures — deliberately conservative (an app that shows
//    anatomy should never demonstrate an impossible pose).
// ---------------------------------------------------------------------------
//
// "spec" = degree value given verbatim by the user's requirements.
// "clinical estimate" = not specified by the user; this file needed *a*
// bound anyway (either because movements.ts references the action, or to
// give CCDIKSolver a real box rather than +/-Infinity), so a standard
// textbook adult ROM figure was used (Kendall's Muscles: Testing and
// Function / Neumann's Kinesiology / AAOS ranges are mutually consistent to
// within a few degrees for all of these).

const ROM_DEG = {
  // spec: "elbow flexion 0-145deg and no hyperextension"
  elbow: { flexionMax: 145, extensionMax: 0 },
  // spec: "shoulder flexion 0-180"; extension not specified -> clinical estimate ~60deg
  // spec: "shoulder abduction 0-180"; adduction not specified -> clinical estimate ~30deg
  //   (from the A-pose the arm is already close to the torso, so true
  //   frontal-plane adduction past neutral is small)
  // GLENOHUMERAL ONLY — this is the single most important number in the file.
  //
  // "Shoulder abduction 0-180" is a real clinical figure, but it is the TOTAL
  // arc, and only about 120 of it happens at the glenohumeral joint. The rest
  // comes from the scapula rotating upward on the ribcage, roughly 2 degrees
  // of humerus per 1 of scapula (scapulohumeral rhythm).
  //
  // This rig has no scapular degree of freedom, so driving the humerus a full
  // 180 with the shoulder blade nailed in place models a motion the body
  // cannot perform — and that is exactly what tore latissimus dorsi off the
  // back and stretched it 7x into a membrane between the flank and the raised
  // arm. The muscles that would have supplied the missing 60 are already named
  // as synergists in movements.ts (serratus anterior, trapezius); the data was
  // right and this number was lying.
  //
  // Capping here is not a workaround, it's the correct glenohumeral limit. The
  // arm reaching only ~120 instead of vertical is honest: that IS how far it
  // goes without the shoulder blade.
  shoulder: { flexionMax: 120, extensionMax: 60, abductionMax: 120, adductionMax: 30 },
  // spec: "hip flexion 0-120", "hip extension 0-20"; ab/adduction not
  // specified -> clinical estimates (~45 / ~30deg)
  hip: { flexionMax: 120, extensionMax: 20, abductionMax: 45, adductionMax: 30 },
  // spec: "knee flexion 0-135 with no hyperextension"
  knee: { flexionMax: 135, extensionMax: 0 },
  // not specified by the user at all -> clinical estimate (dorsiflexion
  // ~20deg, plantarflexion ~50deg — the tight end here is real: ankle
  // dorsiflexion is the most restricted "flexion" of any joint in this file)
  ankle: { flexionMax: 20, extensionMax: 50 },
  // spec: "spine flexion 0-60"; extension not specified -> clinical estimate
  // ~25deg (thoracolumbar extension)
  spine: { flexionMax: 60, extensionMax: 25 },
} as const

const ROM_TABLE: Record<string, RomRange> = {}

function setRom(joint: JointName, side: Side, axis: Axis, min: number, max: number): void {
  ROM_TABLE[`${joint}:${side}:${axis}`] = { axis, min, max }
}

for (const side of ['L', 'R'] as const) {
  // shoulder: x = flex(-)/ext(+), z = abduct/adduct (mirrored)
  setRom('shoulder', side, 'x', -deg(ROM_DEG.shoulder.flexionMax), deg(ROM_DEG.shoulder.extensionMax))
  const shoulderAbd = jointActionAxis('shoulder', 'abduction', side)
  setRom(
    'shoulder',
    side,
    'z',
    shoulderAbd.sign === -1 ? -deg(ROM_DEG.shoulder.abductionMax) : -deg(ROM_DEG.shoulder.adductionMax),
    shoulderAbd.sign === -1 ? deg(ROM_DEG.shoulder.adductionMax) : deg(ROM_DEG.shoulder.abductionMax),
  )

  // elbow: x = flex(-) only, clamped at 0 (no hyperextension)
  setRom('elbow', side, 'x', -deg(ROM_DEG.elbow.flexionMax), deg(ROM_DEG.elbow.extensionMax))

  // hip: x = flex(-)/ext(+), z = abduct/adduct (mirrored)
  setRom('hip', side, 'x', -deg(ROM_DEG.hip.flexionMax), deg(ROM_DEG.hip.extensionMax))
  const hipAbd = jointActionAxis('hip', 'abduction', side)
  setRom(
    'hip',
    side,
    'z',
    hipAbd.sign === -1 ? -deg(ROM_DEG.hip.abductionMax) : -deg(ROM_DEG.hip.adductionMax),
    hipAbd.sign === -1 ? deg(ROM_DEG.hip.adductionMax) : deg(ROM_DEG.hip.abductionMax),
  )

  // knee: x = flex(+) only, clamped at 0 (no hyperextension)
  setRom('knee', side, 'x', -deg(ROM_DEG.knee.extensionMax), deg(ROM_DEG.knee.flexionMax))

  // ankle: x = dorsiflex(-)/plantarflex(+)
  setRom('ankle', side, 'x', -deg(ROM_DEG.ankle.flexionMax), deg(ROM_DEG.ankle.extensionMax))
}

// spine: center joint, x = flex(+)/ext(-)
setRom('spine', 'C', 'x', -deg(ROM_DEG.spine.extensionMax), deg(ROM_DEG.spine.flexionMax))

/** Look up the rotation clamp for a joint+side+axis. Returns undefined for
 * axes that aren't constrained for that joint (e.g. 'y' — no joint in this
 * file models axial rotation). Callers that need a hard guarantee (IK) should
 * treat `undefined` as "don't allow any rotation on this axis", not as
 * "unlimited" — silently allowing free rotation on an unmodeled axis is
 * exactly the kind of non-human pose this file exists to prevent. */
export function jointRom(joint: JointName, side: Side, axis: Axis): RomRange | undefined {
  return ROM_TABLE[`${joint}:${side}:${axis}`]
}

/** All ROM entries, for consumers (IK phase, debug UI) that want to iterate
 * rather than look up one at a time. */
export const JOINT_ROM: readonly { joint: JointName; side: Side; rom: RomRange }[] = Object.entries(
  ROM_TABLE,
).map(([key, rom]) => {
  const [joint, side] = key.split(':')
  return { joint: joint as JointName, side: side as Side, rom }
})

/** Clamp a raw local-rotation angle (radians, already in the `jointActionAxis`
 * sign convention) to this joint's humanly-possible range. Both clip
 * generation and the future IK phase should route every angle through this
 * before applying it to a bone — it's the one place "humanly possible" is
 * enforced. */
export function clampToRom(joint: JointName, side: Side, axis: Axis, angle: number): number {
  const rom = jointRom(joint, side, axis)
  if (!rom) return 0
  return Math.min(rom.max, Math.max(rom.min, angle))
}
