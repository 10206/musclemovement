// Muscle-highlight LUT — ARCHITECTURE.md §1.1/§1.3.
//
// A 256x1 RGBA8 DataTexture, one texel per possible `aMuscleId` (0 is
// reserved/"none" and is always left transparent). muscleMaterial.ts samples
// this per-fragment: `texel.rgb` is the highlight color, `texel.a` is the
// highlight intensity (0 = not highlighted, so an all-zero LUT is a no-op).
//
// Changing which muscles are highlighted is *only* ever a write into this
// texture — never a geometry or material rebuild — which is what keeps the
// whole merged muscle mesh at a single draw call while still supporting
// arbitrary per-muscle color.

import * as THREE from 'three'
import type { ResolvedActivation, Role } from '../anatomy/movements'

export type HighlightMode = 'uniform' | 'perMuscle'

/** Must match the `/ 256.0` divisor baked into muscleMaterial.ts's shader. */
const LUT_SIZE = 256

/** `#e5484d`-family accent used for every involved muscle when the camera is
 * far (ARCHITECTURE.md §1.3, "기본 거리"). */
const UNIFORM_ACCENT = new THREE.Color('#e5484d')

/** prime = full strength, synergist = noticeably dimmer, antagonist = faint
 * — the antagonist's low intensity is layered on top of a distinct cool hue
 * (below) so "lengthening, not working" reads as a different kind of
 * highlight, not just a duller version of the same one. */
const ROLE_INTENSITY: Record<Role, number> = {
  prime: 1.0,
  synergist: 0.55,
  antagonist: 0.25,
}

// -- perMuscle palette -------------------------------------------------------
//
// Golden-ratio hue stepping gives a sequence of hues that stays maximally
// spread out no matter how many are drawn from it (unlike `id / count`, which
// only spreads evenly for a *known, fixed* count) — important here because
// which/how-many muscles are simultaneously highlighted varies per movement.
// Keying the hue off the muscle's stable numeric `id` (not off its position
// in the current activation list) is what makes the assignment stable: the
// same muscle always gets the same color, regardless of what else is lit up
// or in what order this frame's activations were resolved.
const GOLDEN_RATIO_CONJUGATE = 0.6180339887498949

const PALETTE_SATURATION = 0.68
const PALETTE_LIGHTNESS = 0.52

// Antagonists always render in this cool (blue/cyan) hue band, never the
// warm palette above — that's the "distinct cool hue" ARCHITECTURE.md §1.3
// calls for. Each antagonist muscle still gets its own hue *within* the
// band (same golden-ratio trick, narrowed) so two simultaneous antagonists
// in perMuscle mode remain distinguishable from each other too.
const ANTAGONIST_HUE_MIN = 0.53 // ~191deg
const ANTAGONIST_HUE_MAX = 0.64 // ~230deg
const ANTAGONIST_SATURATION = 0.55
const ANTAGONIST_LIGHTNESS = 0.5

function fract(x: number): number {
  return x - Math.floor(x)
}

/** Warm palette hue for a prime/synergist muscle in perMuscle mode. Pushed
 * out of the antagonist's reserved cool band so the two vocabularies never
 * collide by coincidence. */
function paletteHue(muscleId: number): number {
  const hue = fract(muscleId * GOLDEN_RATIO_CONJUGATE)
  if (hue >= ANTAGONIST_HUE_MIN && hue <= ANTAGONIST_HUE_MAX) {
    return fract(hue + (ANTAGONIST_HUE_MAX - ANTAGONIST_HUE_MIN) + 0.05)
  }
  return hue
}

function antagonistHue(muscleId: number): number {
  const span = ANTAGONIST_HUE_MAX - ANTAGONIST_HUE_MIN
  return ANTAGONIST_HUE_MIN + fract(muscleId * GOLDEN_RATIO_CONJUGATE) * span
}

const scratchColor = new THREE.Color()

function colorFor(muscleId: number, role: Role, mode: HighlightMode): THREE.Color {
  if (role === 'antagonist') {
    return scratchColor.setHSL(antagonistHue(muscleId), ANTAGONIST_SATURATION, ANTAGONIST_LIGHTNESS)
  }
  if (mode === 'uniform') {
    return scratchColor.copy(UNIFORM_ACCENT)
  }
  return scratchColor.setHSL(paletteHue(muscleId), PALETTE_SATURATION, PALETTE_LIGHTNESS)
}

/** How quickly `current` chases `target`, in the exponential-decay sense
 * (bigger = snappier). ~0.12s to settle reads as a fade, not a pop, without
 * feeling laggy when a user is scrubbing/dragging quickly. */
const LERP_RATE = 1 / 0.12

/** Below this per-channel delta (out of 0..1) we snap instead of continuing
 * to lerp forever, so `update()` can stop touching the texture once settled. */
const SETTLE_EPSILON = 1 / 512

export class HighlightLUT {
  readonly texture: THREE.DataTexture

  /** Both arrays are RGBA-interleaved, length LUT_SIZE*4, values in 0..1. */
  private readonly current: Float32Array
  private readonly target: Float32Array
  private readonly data: Uint8Array

  constructor() {
    this.data = new Uint8Array(LUT_SIZE * 4)
    this.current = new Float32Array(LUT_SIZE * 4)
    this.target = new Float32Array(LUT_SIZE * 4)

    const texture = new THREE.DataTexture(this.data, LUT_SIZE, 1, THREE.RGBAFormat, THREE.UnsignedByteType)
    // Nearest + no mipmaps: this is a lookup table, not an image. Any
    // filtering would blend one muscle's id into its neighbor's color.
    texture.magFilter = THREE.NearestFilter
    texture.minFilter = THREE.NearestFilter
    texture.generateMipmaps = false
    texture.wrapS = THREE.ClampToEdgeWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping
    texture.colorSpace = THREE.NoColorSpace
    texture.needsUpdate = true
    this.texture = texture
  }

  /**
   * Set which muscles are highlighted, replacing any previous state (this is
   * not additive — muscles absent from `activations` fade back to
   * transparent). `mode` picks the color rule from ARCHITECTURE.md §1.3;
   * callers that want the automatic camera-distance-driven choice should go
   * through `useHighlight` rather than calling this directly.
   */
  setActivations(activations: readonly ResolvedActivation[], mode: HighlightMode): void {
    this.target.fill(0)
    for (const { muscle, role } of activations) {
      const id = muscle.id
      // id 0 ("none") and anything outside the LUT's range is silently
      // dropped rather than throwing — see resolveMovement's doc comment on
      // degrading quietly for unmodeled data.
      if (!Number.isInteger(id) || id <= 0 || id >= LUT_SIZE) continue
      const color = colorFor(id, role, mode)
      const base = id * 4
      this.target[base] = color.r
      this.target[base + 1] = color.g
      this.target[base + 2] = color.b
      this.target[base + 3] = ROLE_INTENSITY[role]
    }
  }

  /** Fade everything back to unhighlighted. */
  clear(): void {
    this.target.fill(0)
  }

  /**
   * Advance `current` toward `target` and, if anything moved, re-upload the
   * texture. Call once per frame (see useHighlight.ts). Framerate-independent
   * exponential smoothing so a dropped frame doesn't change the perceived
   * fade speed.
   */
  update(delta: number): void {
    const t = 1 - Math.exp(-delta * LERP_RATE)
    let changed = false

    for (let i = 0; i < this.current.length; i++) {
      const c = this.current[i]
      const target = this.target[i]
      const diff = target - c
      if (Math.abs(diff) <= SETTLE_EPSILON) {
        if (c !== target) {
          this.current[i] = target
          changed = true
        }
        continue
      }
      this.current[i] = c + diff * t
      changed = true
    }

    if (!changed) return

    for (let i = 0; i < this.current.length; i++) {
      this.data[i] = Math.round(THREE.MathUtils.clamp(this.current[i], 0, 1) * 255)
    }
    this.texture.needsUpdate = true
  }

  dispose(): void {
    this.texture.dispose()
  }
}
