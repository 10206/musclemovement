// Compress the built anatomy GLB for delivery.
//
// The raw build is ~18MB. That is fine to HOLD (iOS Safari's WebGL ceiling is
// ~256MB and the decoded buffers are well under it) but not fine to DOWNLOAD
// on a phone. So this is a transfer problem, and the fix is a codec — not
// throwing away the muscle detail that is the point of the app.
//
// EXT_meshopt_compression is byte-exact: it re-encodes the buffers and the
// decoder reproduces the same values. Nothing is quantised away here, so the
// `aMuscleId` -> muscle mapping and the skin weights survive untouched.
//
// Deliberately NOT used:
//   weld()     - would merge vertices that sit on a seam between two muscles,
//                blending their aMuscleId and breaking per-muscle picking and
//                colouring (ARCHITECTURE.md 1.2).
//   simplify() - operates on the merged primitive, so it could collapse an
//                edge spanning two muscles. Bone simplification already
//                happened per-mesh in build-anatomy.mjs, where it is safe.
//   quantize() - would rescale the custom aMuscleId attribute.
//
// Run: node tools/compress-anatomy.mjs

import { copyFileSync, mkdirSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NodeIO } from '@gltf-transform/core'
import { EXTMeshoptCompression } from '@gltf-transform/extensions'
import { reorder } from '@gltf-transform/functions'
import { MeshoptEncoder } from 'meshoptimizer'

const HERE = dirname(fileURLToPath(import.meta.url))
const FILE = resolve(HERE, '../public/models/anatomy.glb')
// Kept OUTSIDE public/: anything under public/ is copied verbatim into dist/
// and swept into the service worker's precache, so a 28MB debug artefact
// would quietly triple what a phone downloads and stores offline.
const RAW = resolve(HERE, '../.artifacts/anatomy.raw.glb')

await MeshoptEncoder.ready

const io = new NodeIO().registerExtensions([EXTMeshoptCompression]).registerDependencies({ 'meshopt.encoder': MeshoptEncoder })

const before = statSync(FILE).size
mkdirSync(dirname(RAW), { recursive: true })
copyFileSync(FILE, RAW) // keep the uncompressed build for debugging

const doc = await io.read(FILE)

// Vertex-cache/fetch reorder. Pure permutation — no vertices are merged or
// removed — so it is safe for our id attribute, and it materially improves
// both GPU locality and how well meshopt compresses.
await doc.transform(reorder({ encoder: MeshoptEncoder, target: 'size' }))

doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE })

await io.write(FILE, doc)

const after = statSync(FILE).size
console.log(`[compress] ${(before / 1e6).toFixed(1)}MB -> ${(after / 1e6).toFixed(1)}MB  (${(100 - 100 * after / before).toFixed(0)}% off)`)
console.log(`[compress] uncompressed copy kept at ${RAW}`)
