// Loads the real anatomy rig (public/models/anatomy.glb) and adapts it to the
// same `Mannequin` shape the placeholder mannequin exposed — so playback,
// IK dragging, highlighting and picking all keep working untouched. This is
// the P6 seam ARCHITECTURE.md promised: only the geometry source changes.
//
// The file is built by tools/build-anatomy.mjs from BodyParts3D (CC BY-SA
// 2.1 JP) and Z-Anatomy (CC BY-SA 4.0). See README for attribution.

import { useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import type { BoneName, Mannequin } from './rig'

/** The rig plus the glTF scene root that must be mounted for it to deform. */
export interface AnatomyModel extends Mannequin {
  scene: THREE.Object3D
}

const MODEL_URL = `${import.meta.env.BASE_URL}models/anatomy.glb`

/**
 * three.js renames unknown glTF attributes to lowercase (`_AMUSCLEID` ->
 * `_amuscleid`), but the highlight shader is written against `aMuscleId`.
 * Rename rather than rewrite the shader: the attribute name is an artifact of
 * glTF's naming rules, not a design decision worth propagating.
 */
function renameAttribute(geometry: THREE.BufferGeometry, from: string, to: string): void {
  const attr = geometry.getAttribute(from)
  if (!attr || geometry.getAttribute(to)) return
  geometry.setAttribute(to, attr)
  geometry.deleteAttribute(from)
}

export function useAnatomyModel(): AnatomyModel {
  // useDraco=false: nothing is Draco-encoded, and drei would otherwise pull a
  // decoder off a CDN — which a GitHub Pages PWA can neither cache offline nor
  // load under a strict CSP. Meshopt's decoder is bundled, so it stays on.
  const gltf = useGLTF(MODEL_URL, false, true)

  return useMemo(() => {
    const scene = gltf.scene
    const muscleMesh = scene.getObjectByName('muscleMesh') as THREE.SkinnedMesh
    const boneMesh = scene.getObjectByName('boneMesh') as THREE.SkinnedMesh
    if (!muscleMesh?.isSkinnedMesh || !boneMesh?.isSkinnedMesh) {
      throw new Error('anatomy.glb: expected skinned "muscleMesh" and "boneMesh" — rebuild with tools/build-anatomy.mjs')
    }

    renameAttribute(muscleMesh.geometry, '_amuscleid', 'aMuscleId')
    renameAttribute(boneMesh.geometry, '_aboneid', 'aBoneId')

    // A SkinnedMesh's bounding volume is computed at bind pose and never
    // recomputed as bones move, so culling can clip a raised arm right out of
    // the frame.
    muscleMesh.frustumCulled = false
    boneMesh.frustumCulled = false

    const skeleton = muscleMesh.skeleton
    const bonesByName = Object.fromEntries(skeleton.bones.map((b) => [b.name, b])) as Record<BoneName, THREE.Bone>

    return { scene, skeleton, muscleMesh, boneMesh, bonesByName }
  }, [gltf])
}

useGLTF.preload(MODEL_URL)
