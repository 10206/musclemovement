// React glue for the muscle-highlight LUT (ARCHITECTURE.md §1.3).
//
// Owns a HighlightLUT, drives its per-frame fade in useFrame, and picks
// uniform vs. perMuscle mode from the live camera distance that CameraRig
// already tracks — reusing that mechanism (useCameraDistance) rather than
// building a second distance readout.

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useCameraDistance } from '../scene/CameraRig'
import type { ResolvedActivation } from '../anatomy/movements'
import { HighlightLUT, type HighlightMode } from './HighlightLUT'

/**
 * Hysteresis thresholds (meters, camera-to-orbit-target distance) for the
 * automatic uniform/perMuscle switch. Two distinct enter/exit distances —
 * rather than one shared threshold — mean holding the camera near the
 * boundary can't flicker the mode every frame; the camera has to cross the
 * *other* threshold before it flips back.
 *
 * CameraRig constrains distance to [0.5, 5.5] with a default of 2.6, sized
 * for a ~1.8m figure. These sit inside that range, biased so the default
 * view reads as "uniform" (basic/whole-figure) and only a deliberate
 * zoom-in crosses into "perMuscle".
 */
const PER_MUSCLE_ENTER_DISTANCE = 1.3
const UNIFORM_EXIT_DISTANCE = 1.7

export interface UseHighlightResult {
  /** Pass `lut.texture` into `createMuscleMaterial`'s uniform. */
  lut: HighlightLUT
  /**
   * Highlight this set of muscles (replaces, does not merge with, any
   * previous set). `modeOverride` pins uniform/perMuscle explicitly, which
   * is mainly for debugging/verification from the console; normal callers
   * (movement playback, IK drag) should omit it and let the hook pick the
   * mode from camera distance, per ARCHITECTURE.md §1.3.
   */
  setActivations: (activations: readonly ResolvedActivation[], modeOverride?: HighlightMode) => void
  /** Fade everything back to unhighlighted. */
  clear: () => void
}

/** Cheap, order-independent fingerprint of an (activations, mode) pair, used
 * to skip re-deriving LUT targets on frames where nothing actually changed. */
function signatureOf(activations: readonly ResolvedActivation[], mode: HighlightMode): string {
  if (activations.length === 0) return `${mode}:`
  // Sort by id so the signature (and thus the skip check) doesn't depend on
  // the order resolveMovement happened to produce this call.
  const parts = activations
    .map((a) => `${a.muscle.id}${a.role[0]}`)
    .sort()
    .join(',')
  return `${mode}:${parts}`
}

export function useHighlight(): UseHighlightResult {
  const lut = useMemo(() => new HighlightLUT(), [])
  const distanceRef = useCameraDistance()

  const zoomModeRef = useRef<HighlightMode>('uniform')
  const activationsRef = useRef<readonly ResolvedActivation[]>([])
  const overrideRef = useRef<HighlightMode | undefined>(undefined)
  const appliedSignatureRef = useRef<string>('uniform:')

  useEffect(() => () => lut.dispose(), [lut])

  const setActivations = useCallback(
    (activations: readonly ResolvedActivation[], modeOverride?: HighlightMode) => {
      activationsRef.current = activations
      overrideRef.current = modeOverride
    },
    [],
  )

  const clear = useCallback(() => {
    activationsRef.current = []
    overrideRef.current = undefined
  }, [])

  useFrame((_state, delta) => {
    const distance = distanceRef.current
    if (zoomModeRef.current === 'uniform' && distance <= PER_MUSCLE_ENTER_DISTANCE) {
      zoomModeRef.current = 'perMuscle'
    } else if (zoomModeRef.current === 'perMuscle' && distance >= UNIFORM_EXIT_DISTANCE) {
      zoomModeRef.current = 'uniform'
    }

    const effectiveMode = overrideRef.current ?? zoomModeRef.current
    const activations = activationsRef.current
    const signature = signatureOf(activations, effectiveMode)
    if (signature !== appliedSignatureRef.current) {
      lut.setActivations(activations, effectiveMode)
      appliedSignatureRef.current = signature
    }

    lut.update(delta)
  })

  return { lut, setActivations, clear }
}
