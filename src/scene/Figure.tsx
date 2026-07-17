import { forwardRef, useEffect, useImperativeHandle, useMemo } from 'react'
import { useAnatomyModel, type AnatomyModel } from './useAnatomyModel'
import { createMuscleMaterial } from '../highlight/muscleMaterial'
import { useHighlight } from '../highlight/useHighlight'
import type { HighlightMode } from '../highlight/HighlightLUT'
import type { ResolvedActivation } from '../anatomy/movements'

export type FigureMode = 'muscle' | 'bone'

interface FigureProps {
  mode: FigureMode
  /**
   * Hands the rig to the parent once. Playback (useClips) and pose
   * interaction (PoseController) both need the live bones, and Figure is
   * where they're loaded — but neither belongs inside Figure, whose one
   * job is rendering the layers.
   */
  onReady?: (model: AnatomyModel) => void
}

/**
 * Imperative handle so App.tsx can drive muscle highlighting without Figure
 * needing to know anything about movements or playback state — it just owns
 * the LUT and exposes it. See highlight/useHighlight.ts for the
 * uniform/perMuscle rule; `mode` here is an optional *override* of that
 * automatic camera-distance choice, mainly useful for debugging.
 */
export interface FigureHandle {
  setActivations: (activations: readonly ResolvedActivation[], mode?: HighlightMode) => void
  clearHighlight: () => void
}

/**
 * Renders the anatomy figure and switches between its muscle and bone layers.
 *
 * Geometry is the real BodyParts3D/Z-Anatomy rig built by
 * tools/build-anatomy.mjs. The placeholder mannequin it replaced defined the
 * `Mannequin` contract (bone names, `aMuscleId` vertex attribute, one merged
 * skinned mesh per layer), and the real model was built to satisfy exactly
 * that contract — which is why nothing downstream of here changed.
 */
export const Figure = forwardRef<FigureHandle, FigureProps>(function Figure({ mode, onReady }, ref) {
  const highlight = useHighlight()
  const mannequin = useAnatomyModel()
  const { muscleMesh, boneMesh } = mannequin

  // useGLTF caches per URL and hands every consumer the same objects, so the
  // loaded material must not be mutated in place — swap in our own instead.
  // (The GLB's own material is a plain PBR one with no LUT plumbing; without
  // this swap the figure renders but no muscle can ever highlight.)
  const muscleMaterial = useMemo(
    () => createMuscleMaterial(highlight.lut, { color: '#b0483f', roughness: 0.62 }),
    [highlight.lut],
  )

  // Assigned during render, not in an effect: under StrictMode an effect
  // mounts, cleans up (disposing the material), then mounts again — leaving
  // the mesh holding a disposed material or the GLB's original, which showed
  // up as the figure rendering in a washed-out pink with highlighting dead.
  // Assignment is idempotent, so doing it inline is both simpler and correct.
  muscleMesh.material = muscleMaterial

  useEffect(() => () => muscleMaterial.dispose(), [muscleMaterial])

  useEffect(() => {
    onReady?.(mannequin)
  }, [mannequin, onReady])

  useImperativeHandle(
    ref,
    () => ({
      setActivations: highlight.setActivations,
      clearHighlight: highlight.clear,
    }),
    [highlight],
  )

  // Set visibility synchronously as well as in the effect below: an effect
  // only runs after commit, which would flash both layers together for one
  // frame on mount.
  muscleMesh.visible = mode === 'muscle'
  boneMesh.visible = mode === 'bone'
  useEffect(() => {
    muscleMesh.visible = mode === 'muscle'
    // Layers are mutually exclusive — bones stay hidden under the muscles.
    boneMesh.visible = mode === 'bone'
  }, [mode, muscleMesh, boneMesh])

  // The whole glTF scene is mounted, not just the two meshes: it also holds
  // the bone hierarchy, and a SkinnedMesh only deforms if its bones are in the
  // render graph — skinning reads their matrixWorld, which nothing updates for
  // an unmounted node.
  return <primitive object={mannequin.scene} />
})
