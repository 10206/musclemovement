// Scapulohumeral rhythm: the shoulder girdle follows the arm.
//
// The glenohumeral joint supplies about 120 degrees of arm elevation and no
// more (joints.ts explains why that number is not negotiable). The rest of the
// arc — the difference between "arm out sideways" and "arm straight up" — is
// the shoulder blade rotating upward on the ribcage, at roughly 1 degree of
// scapula per 2 of humerus, after a setting phase where the humerus moves
// alone.
//
// So this is not an animation trick to get the arm higher: it IS the missing
// half of the joint. It's applied as a rig constraint rather than baked into
// clips so that a hand-dragged arm obeys it too.
//
// Frame order: must run AFTER the mixer and the IK solver, since it reads the
// humerus they just wrote and writes the girdle above it. See the contract in
// playback/useClips.ts.

import * as THREE from 'three'
import type { Mannequin } from '../scene/rig'
import { jointActionAxis, jointRom } from '../anatomy/joints'

const DEG = Math.PI / 180

/** Below this much humerus elevation the scapula doesn't rotate at all — the
 * real setting phase, and also what stops a resting arm making the shoulder
 * creep upward. */
const SETTING_PHASE = 30 * DEG

/** Scapula degrees per degree of humerus past the setting phase. The classic
 * figure is 1:2, which with the glenohumeral cap at 120 yields 120 + 60 = 180
 * total — exactly where a real arm ends up. */
const RHYTHM = 0.5

/** Cap on upward rotation. 60 is what the rhythm needs to complete a 180
 * degree arc on top of the glenohumeral 120. */
const MAX_UPWARD = 60 * DEG

/**
 * How much of the rotation-induced shoulder travel to keep.
 *
 * Our girdle is one bone pivoting at the sternoclavicular joint, ~15cm medial
 * to the shoulder. Rotating it 60 degrees therefore swings the shoulder bodily
 * up by ~13cm — and it looked exactly as bad as that sounds: the arm reached
 * vertical but the shoulder climbed up beside the ear.
 *
 * A real scapula rotates far more than it translates; it swivels on the
 * ribcage, so the glenoid only rises a few cm through a full elevation. We get
 * the same separation by rotating for the arm's sake and then translating the
 * girdle back down, keeping only a fraction of the travel. The arm still ends
 * up vertical, because its DIRECTION comes from the rotation, which we keep.
 */
const TRAVEL_KEPT = 0.3

interface SideRig {
  girdle: THREE.Bone
  arm: THREE.Bone
  /** Local offset of the arm's child — the arm's own direction vector. */
  armAxis: THREE.Vector3
  /** That direction at bind pose, i.e. with the arm hanging. */
  rest: THREE.Vector3
  /** The arm's offset from the girdle: the lever the girdle's rotation swings. */
  shoulderOffset: THREE.Vector3
  /** The girdle's own bind translation, to restore each frame. */
  girdleRest: THREE.Vector3
  /** Which sign of z rotation lifts this side's shoulder (measured; mirrored). */
  liftSign: number
  romMin: number
  romMax: number
}

const scratch = new THREE.Vector3()
const travel = new THREE.Vector3()
const spin = new THREE.Quaternion()
const Z_AXIS = new THREE.Vector3(0, 0, 1)

/**
 * Build the rhythm constraint. Reads the bind pose, so call it while the rig
 * is still at rest.
 *
 * Returns null if the rig has no girdle bones — callers should treat that as
 * "no rhythm", not an error.
 */
export function createShoulderRhythm(mannequin: Mannequin): (() => void) | null {
  const sides: SideRig[] = []

  for (const X of ['L', 'R'] as const) {
    const girdle = mannequin.bonesByName[`shoulder_${X}`]
    const arm = mannequin.bonesByName[`upperArm_${X}`]
    const forearm = mannequin.bonesByName[`forearm_${X}`]
    if (!girdle || !arm || !forearm) return null

    // The arm's direction is the offset to its child. That offset is a
    // constant of the rig; what changes is the arm's own rotation.
    const armAxis = forearm.position.clone().normalize()
    const elevation = jointActionAxis('scapula', 'elevation', X)
    const rom = jointRom('scapula', X, elevation.axis)

    sides.push({
      girdle,
      arm,
      armAxis,
      rest: armAxis.clone(),
      shoulderOffset: arm.position.clone(),
      girdleRest: girdle.position.clone(),
      liftSign: elevation.sign,
      romMin: rom?.min ?? 0,
      romMax: rom?.max ?? 0,
    })
  }

  return () => {
    for (const s of sides) {
      // How far the arm has been raised from hanging — in whatever plane it
      // went. Plane-agnostic on purpose: upward rotation helps a forward reach
      // exactly as much as a sideways one.
      scratch.copy(s.armAxis).applyQuaternion(s.arm.quaternion)
      const elevated = s.rest.angleTo(scratch)
      const upward = Math.min(MAX_UPWARD, Math.max(0, (elevated - SETTING_PHASE) * RHYTHM))

      // ADD to whatever the girdle already holds: a shrug clip writes this same
      // bone, and the two should compose (shrug while raising the arm) rather
      // than overwrite each other.
      const asked = THREE.MathUtils.clamp(s.girdle.rotation.z, s.romMin, s.romMax)
      s.girdle.rotation.z = asked + s.liftSign * upward

      // Cancel most of the travel this rotation would drag the shoulder
      // through — see TRAVEL_KEPT. Only the rhythm's share is compensated: a
      // shrug is supposed to lift the shoulder, so `asked` keeps its travel.
      spin.setFromAxisAngle(Z_AXIS, s.liftSign * upward)
      travel.copy(s.shoulderOffset).applyQuaternion(spin).sub(s.shoulderOffset)
      s.girdle.position.copy(s.girdleRest).addScaledVector(travel, -(1 - TRAVEL_KEPT))

      s.girdle.updateMatrixWorld(true)
    }
  }
}
