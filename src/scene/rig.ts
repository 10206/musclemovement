// The rig contract: bone names and the shape every consumer codes against.
//
// This started life inside a procedurally-built placeholder mannequin, back
// when there was no real model. The placeholder is gone, but the contract it
// defined is what let the real BodyParts3D/Z-Anatomy rig drop in without
// touching playback, IK, highlighting or picking — tools/build-anatomy.mjs
// builds the GLB to satisfy exactly this, and the names below are load-bearing
// on both sides of that seam.

import type * as THREE from 'three'

/** Every bone in the rig. tools/build-anatomy.mjs emits exactly these names,
 * and src/anatomy/joints.ts maps anatomical joints onto them. */
export type BoneName =
  | 'hips'
  | 'spine'
  | 'chest'
  | 'neck'
  | 'head'
  | 'shoulder_L'
  | 'upperArm_L'
  | 'forearm_L'
  | 'hand_L'
  | 'shoulder_R'
  | 'upperArm_R'
  | 'forearm_R'
  | 'hand_R'
  | 'thigh_L'
  | 'shin_L'
  | 'foot_L'
  | 'thigh_R'
  | 'shin_R'
  | 'foot_R'

/**
 * The loaded figure.
 *
 * Both meshes are single merged SkinnedMeshes sharing one Skeleton — one draw
 * call each (ARCHITECTURE.md §1.1). `muscleMesh` carries the `aMuscleId`
 * vertex attribute that drives per-muscle colouring and picking; `boneMesh`
 * carries `aBoneId`.
 */
export interface Mannequin {
  skeleton: THREE.Skeleton
  muscleMesh: THREE.SkinnedMesh
  boneMesh: THREE.SkinnedMesh
  bonesByName: Record<BoneName, THREE.Bone>
}
