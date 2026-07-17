// Verify the shipped anatomy GLB is actually usable by the app.
//
// The compression step reported pruning accessors, and a silently dropped
// JOINTS_0 or _AMUSCLEID would not fail the build — it would just render an
// unrigged, uncolourable model. So assert the contract explicitly.
//
// Run: node tools/verify-anatomy.mjs

import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NodeIO } from '@gltf-transform/core'
import { EXTMeshoptCompression } from '@gltf-transform/extensions'
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer'
import { MUSCLES } from '../src/anatomy/muscles.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
await MeshoptDecoder.ready
await MeshoptEncoder.ready

const io = new NodeIO()
  .registerExtensions([EXTMeshoptCompression])
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder })

const doc = await io.read(resolve(HERE, '../public/models/anatomy.glb'))
const root = doc.getRoot()

let failures = 0
const check = (ok, label, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`)
  if (!ok) failures++
}

console.log('\n=== structure')
const meshes = root.listMeshes()
check(meshes.length === 2, 'two meshes (muscle + bone)', meshes.map((m) => m.getName()).join(', '))

const skins = root.listSkins()
check(skins.length === 1, 'one skin')
const joints = skins[0]?.listJoints() ?? []
check(joints.length === 19, '19 joints', `${joints.length}: ${joints.map((j) => j.getName()).join(' ')}`)

const skinned = root.listNodes().filter((n) => n.getSkin())
check(skinned.length === 2, 'both meshes are skinned', skinned.map((n) => n.getName()).join(', '))

console.log('\n=== attributes')
for (const mesh of meshes) {
  const prim = mesh.listPrimitives()[0]
  const semantics = prim.listSemantics()
  const idAttr = mesh.getName() === 'muscleMesh' ? '_AMUSCLEID' : '_ABONEID'
  for (const req of ['POSITION', 'NORMAL', 'JOINTS_0', 'WEIGHTS_0', idAttr]) {
    check(semantics.includes(req), `${mesh.getName()}.${req}`)
  }
}

console.log('\n=== skin weights are sane')
for (const mesh of meshes) {
  const prim = mesh.listPrimitives()[0]
  const w = prim.getAttribute('WEIGHTS_0').getArray()
  const j = prim.getAttribute('JOINTS_0').getArray()
  let badSum = 0, badJoint = 0
  for (let i = 0; i < w.length; i += 4) {
    const s = w[i] + w[i + 1] + w[i + 2] + w[i + 3]
    if (Math.abs(s - 1) > 0.01) badSum++
  }
  for (let i = 0; i < j.length; i++) if (j[i] >= joints.length) badJoint++
  check(badSum === 0, `${mesh.getName()}: every vertex's weights sum to 1`, badSum ? `${badSum} bad` : '')
  check(badJoint === 0, `${mesh.getName()}: joint indices in range`, badJoint ? `${badJoint} bad` : '')
}

console.log('\n=== muscle ids')
const muscleMesh = meshes.find((m) => m.getName() === 'muscleMesh')
const prim = muscleMesh.listPrimitives()[0]
const ids = prim.getAttribute('_AMUSCLEID').getArray()
const present = new Set(ids)
const expected = new Set(MUSCLES.map((m) => m.id))
const missing = [...expected].filter((id) => !present.has(id))
const unknown = [...present].filter((id) => id !== 0 && !expected.has(id))
check(missing.length === 0, `all ${expected.size} registry muscles present in geometry`, missing.length ? `missing ids ${missing.join(',')}` : '')
check(unknown.length === 0, 'no unknown ids', unknown.length ? `${unknown.join(',')}` : '')

// Every triangle's 3 vertices must share one id, or the shader (which has no
// `flat` interpolation) renders a gradient between two muscles and picking
// returns whichever vertex the raycast happened to land nearest.
const idx = prim.getIndices().getArray()
let split = 0
for (let i = 0; i < idx.length; i += 3) {
  if (ids[idx[i]] !== ids[idx[i + 1]] || ids[idx[i]] !== ids[idx[i + 2]]) split++
}
check(split === 0, 'no triangle spans two muscle ids', split ? `${split} split triangles` : '')

console.log('\n=== skinning is identity at bind pose')
// The single most important invariant, and the one that fails silently: at
// bind pose every vertex must skin back to exactly where it started, because
// boneWorld_i * inverseBind_i == I for every bone. If the bone hierarchy's
// accumulated translations and the inverse bind matrices disagree even
// slightly, the model renders subtly (or spectacularly) deformed while every
// other check above still passes.
{
  const jointNodes = skins[0].listJoints()
  const ibmArr = skins[0].getInverseBindMatrices().getArray()

  // world translation of each joint, by walking the node tree
  const parentOf = new Map()
  for (const j of jointNodes) for (const c of j.listChildren()) parentOf.set(c, j)
  const worldOf = (node) => {
    let p = [0, 0, 0]
    for (let n = node; n; n = parentOf.get(n)) {
      const t = n.getTranslation()
      p = [p[0] + t[0], p[1] + t[1], p[2] + t[2]]
    }
    return p
  }
  const world = jointNodes.map(worldOf)

  let worst = 0
  for (let i = 0; i < jointNodes.length; i++) {
    // bind pose is translation-only, so boneWorld * IBM reduces to comparing
    // the IBM's translation against the negated world translation.
    const ibmT = [ibmArr[i * 16 + 12], ibmArr[i * 16 + 13], ibmArr[i * 16 + 14]]
    for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(world[i][c] + ibmT[c]))
  }
  check(worst < 1e-4, 'boneWorld * inverseBind == identity for every bone', `worst offset ${worst.toExponential(2)}m`)

  // And prove it end-to-end on real vertices: skin them with their own
  // weights and confirm they land back on their bind position.
  for (const mesh of meshes) {
    const prim = mesh.listPrimitives()[0]
    const pos = prim.getAttribute('POSITION').getArray()
    const jv = prim.getAttribute('JOINTS_0').getArray()
    const wv = prim.getAttribute('WEIGHTS_0').getArray()
    let maxDrift = 0
    const step = Math.max(1, Math.floor(pos.length / 3 / 5000))
    for (let v = 0; v < pos.length / 3; v += step) {
      const p = [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]]
      const out = [0, 0, 0]
      for (let k = 0; k < 4; k++) {
        const w = wv[v * 4 + k]
        if (!w) continue
        const b = jv[v * 4 + k]
        // (translate(world) * translate(-world)) * p  ==  p, per bone
        const ibmT = [ibmArr[b * 16 + 12], ibmArr[b * 16 + 13], ibmArr[b * 16 + 14]]
        for (let c = 0; c < 3; c++) out[c] += w * (p[c] + ibmT[c] + world[b][c])
      }
      maxDrift = Math.max(maxDrift, Math.hypot(out[0] - p[0], out[1] - p[1], out[2] - p[2]))
    }
    check(maxDrift < 1e-3, `${mesh.getName()}: vertices skin back onto bind pose`, `max drift ${(maxDrift * 1000).toFixed(3)}mm`)
  }
}

console.log('\n=== no vertex rigidly follows a bone it is nowhere near')
// The check that would have caught the latissimus dorsi bug and didn't.
//
// build-anatomy.mjs asserts this per-MUSCLE using each mesh's centroid, which
// is far too coarse: the lat's centroid sits within tolerance of the humerus
// even when all 2006 of its vertices are rigidly bound to it, so the whole
// sheet peeled off the back on abduction while every check stayed green.
//
// Skinning is per-vertex, so the check has to be too: if a vertex is ~fully
// weighted to a bone, it must be near enough to that bone that rotating it is
// physically sensible. Anything else IS a mis-scoped rig rule.
{
  const jointNodes = skins[0].listJoints()
  const parentOf = new Map()
  for (const j of jointNodes) for (const c of j.listChildren()) parentOf.set(c, j)
  const worldOf = (node) => {
    let p = [0, 0, 0]
    for (let n = node; n; n = parentOf.get(n)) {
      const t = n.getTranslation()
      p = [p[0] + t[0], p[1] + t[1], p[2] + t[2]]
    }
    return p
  }
  const world = jointNodes.map(worldOf)
  const childIdx = jointNodes.map((j) => {
    const c = j.listChildren()[0]
    return c ? jointNodes.indexOf(c) : -1
  })

  const segDist = (p, a, b) => {
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const l2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2
    const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1] + (p[2] - a[2]) * ab[2]) / l2)) : 0
    return Math.hypot(p[0] - (a[0] + ab[0] * t), p[1] - (a[1] + ab[1] * t), p[2] - (a[2] + ab[2] * t))
  }
  // How far may a muscle vertex sit from the bone it rigidly follows?
  //
  // A fixed number can't answer that: the ribcage is genuinely 0.22m from the
  // thoracic axis, while a humerus is a stick. So ask the skeleton — measure
  // how far the BONE LAYER's own geometry reaches from each bone, and allow
  // muscles a margin on top. A muscle wrapping its own body part passes; one
  // bound to a bone in a different limb doesn't, because no skeleton reaches
  // there either. The yardstick comes from the same file being checked.
  const MARGIN = 0.12

  const reachOf = (mesh) => {
    const p = mesh.listPrimitives()[0]
    const pos = p.getAttribute('POSITION').getArray()
    const jv = p.getAttribute('JOINTS_0').getArray()
    const wv = p.getAttribute('WEIGHTS_0').getArray()
    const out = new Map()
    for (let v = 0; v < pos.length / 3; v++) {
      for (let k = 0; k < 4; k++) {
        if (wv[v * 4 + k] < 0.9) continue
        const b = jv[v * 4 + k]
        const tail = childIdx[b] >= 0 ? world[childIdx[b]] : world[b]
        const d = segDist([pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]], world[b], tail)
        if (d > (out.get(b) ?? 0)) out.set(b, d)
      }
    }
    return out
  }
  const boneReach = reachOf(meshes.find((m) => m.getName() === 'boneMesh'))

  const prim = muscleMesh.listPrimitives()[0]
  const pos = prim.getAttribute('POSITION').getArray()
  const jv = prim.getAttribute('JOINTS_0').getArray()
  const wv = prim.getAttribute('WEIGHTS_0').getArray()
  const ids = prim.getAttribute('_AMUSCLEID').getArray()

  const worstByMuscle = new Map()
  for (let v = 0; v < pos.length / 3; v++) {
    const p = [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]]
    for (let k = 0; k < 4; k++) {
      if (wv[v * 4 + k] < 0.9) continue // only near-rigid bindings
      const b = jv[v * 4 + k]
      const tail = childIdx[b] >= 0 ? world[childIdx[b]] : world[b]
      const over = segDist(p, world[b], tail) - ((boneReach.get(b) ?? 0) + MARGIN)
      const id = ids[v]
      if (over > (worstByMuscle.get(id)?.over ?? -Infinity)) {
        worstByMuscle.set(id, { over, bone: jointNodes[b].getName(), d: segDist(p, world[b], tail) })
      }
    }
  }

  const offenders = [...worstByMuscle.entries()]
    .filter(([, w]) => w.over > 0)
    .sort((a, b) => b[1].over - a[1].over)
    .map(([id, w]) => {
      const name = MUSCLES.find((m) => m.id === id)?.key ?? (id === 0 ? 'context muscle' : `id ${id}`)
      return `${name} -> ${w.bone}: ${w.d.toFixed(2)}m, but the skeleton only reaches ${(boneReach.get(jointNodes.findIndex((j) => j.getName() === w.bone)) ?? 0).toFixed(2)}m there`
    })

  check(offenders.length === 0, `no muscle vertex reaches further from its bone than the skeleton does (+${MARGIN}m)`,
    offenders.length ? `\n      ${offenders.slice(0, 6).join('\n      ')}` : '')
}

console.log('\n=== geometry')
const pos = prim.getAttribute('POSITION')
const min = pos.getMinNormalized([]), max = pos.getMaxNormalized([])
const f = (a) => '[' + a.map((v) => v.toFixed(3)).join(', ') + ']'
console.log(`  muscle bounds min ${f(min)}  max ${f(max)}`)
check(Math.abs(min[1]) < 0.25, 'figure stands near y=0', `min y = ${min[1].toFixed(3)}`)
check(max[1] > 1.4 && max[1] < 2.0, 'human height', `max y = ${max[1].toFixed(3)}`)

console.log(failures ? `\n${failures} CHECK(S) FAILED\n` : '\nall checks passed\n')
process.exit(failures ? 1 : 0)
