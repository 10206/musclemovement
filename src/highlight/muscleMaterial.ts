// Muscle highlight shader injection — ARCHITECTURE.md §1.2.
//
// `MeshStandardMaterial` is kept as-is (not replaced by a hand-rolled
// ShaderMaterial) so PBR lighting/shadows/tone-mapping all keep working for
// free. `onBeforeCompile` does the minimum-invasive injection described in
// the architecture doc: pipe `aMuscleId` through to the fragment stage, then
// use it to look up a color+intensity texel in the highlight LUT and fold
// that into both the surface color and the emissive term (the emissive
// contribution is what keeps a highlighted muscle legible under strong key
// lighting or against the app's pure-white background, where a diffuse-only
// tint can wash out).

import * as THREE from 'three'
import type { HighlightLUT } from './HighlightLUT'

export interface MuscleMaterialOptions {
  color?: THREE.ColorRepresentation
  roughness?: number
  metalness?: number
}

/**
 * Build the one material every muscle on the merged mesh shares. Which
 * color (if any) a given fragment renders as is entirely a function of its
 * `aMuscleId` and the current contents of `lut.texture` — never a material
 * swap — which is what keeps the whole muscle layer at a single draw call.
 */
export function createMuscleMaterial(
  lut: HighlightLUT,
  options: MuscleMaterialOptions = {},
): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: options.color ?? '#b0483f',
    roughness: options.roughness ?? 0.6,
    metalness: options.metalness ?? 0,
  })

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uHighlightLUT = { value: lut.texture }

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `attribute float aMuscleId;\nvarying float vMuscleId;\n#include <common>`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\nvMuscleId = aMuscleId;`,
      )

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `uniform sampler2D uHighlightLUT;\nvarying float vMuscleId;\n#include <common>`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          // +0.5 lands the sample exactly on texel floor(vMuscleId)'s
          // center rather than on the boundary between two texels, where
          // float rounding could go either way even under NearestFilter.
          // hl.a is highlight intensity: 0 (the default/no-activation LUT
          // state) makes both lines below a no-op, so an unhighlighted
          // figure renders with zero shader-visible difference from a
          // plain MeshStandardMaterial.
          vec4 hl = texture2D( uHighlightLUT, vec2( ( vMuscleId + 0.5 ) / 256.0, 0.5 ) );
          diffuseColor.rgb = mix( diffuseColor.rgb, hl.rgb, hl.a );
          totalEmissiveRadiance += hl.rgb * hl.a * 0.35;
        }`,
      )
  }

  // three.js's default program-cache key is derived from material
  // properties/defines and has no idea `onBeforeCompile` exists, so two
  // materials that differ only in what they inject (e.g. this one vs.
  // buildMannequin's plain bone material, which happens to share the same
  // color/roughness shape) can otherwise be handed the same compiled
  // program and silently lose the highlight injection. A stable, unique key
  // for this shader variant rules that out.
  material.customProgramCacheKey = () => 'muscleMaterial-highlightLUT-v1'

  return material
}
