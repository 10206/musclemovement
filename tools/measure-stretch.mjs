// Measure how much each muscle actually deforms when a joint moves.
//
// Eyeballing a pose tells you a muscle looks wrong; it doesn't tell you which
// rule made it wrong or whether a fix helped. This poses the shipped rig
// exactly as the app does, skins every vertex, and reports per-muscle stretch —
// so "latissimus dorsi looks like a flying squirrel" becomes a number that a
// change can be measured against.
//
// The metric is stretch ratio: sample vertex pairs inside one muscle and
// compare their posed distance to their rest distance. A rigidly-bound muscle
// scores 1.00 by construction. Real tissue reaches maybe 1.3-1.5x. Anything
// past ~2x is not a muscle stretching, it's linear blend skinning tearing a
// membrane between two bones that moved apart.
//
// Run: node tools/measure-stretch.mjs [movement-key ...]

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NodeIO } from '@gltf-transform/core'
import { EXTMeshoptCompression } from '@gltf-transform/extensions'
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer'
import { MUSCLES } from '../src/anatomy/muscles.ts'
import { MOVEMENTS } from '../src/anatomy/movements.ts'
import { jointActionAxis, jointBone, jointRom } from '../src/anatomy/joints.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
await MeshoptDecoder.ready
await MeshoptEncoder.ready

const io = new NodeIO()
  .registerExtensions([EXTMeshoptCompression])
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder })
const doc = await io.read(resolve(HERE, '../public/models/anatomy.glb'))

// -- rig ------------------------------------------------------------------
const skin = doc.getRoot().listSkins()[0]
const joints = skin.listJoints()
const nameOf = joints.map((j) => j.getName())
const idx = Object.fromEntries(nameOf.map((n, i) => [n, i]))
const parent = new Array(joints.length).fill(-1)
for (let i = 0; i < joints.length; i++) for (const c of joints[i].listChildren()) parent[joints.indexOf(c)] = i
const local = joints.map((j) => j.getTranslation())
const ibm = skin.getInverseBindMatrices().getArray()

const mul = (a, b) => {
  const o = new Array(16)
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]
  return o
}
const trs = (t, q) => {
  const [x, y, z, w] = q
  const x2 = x + x, y2 = y + y, z2 = z + z
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2
  const wx = w * x2, wy = w * y2, wz = w * z2
  return [1 - (yy + zz), xy + wz, xz - wy, 0, xy - wz, 1 - (xx + zz), yz + wx, 0, xz + wy, yz - wx, 1 - (xx + yy), 0, t[0], t[1], t[2], 1]
}
const axisQuat = (axis, a) => {
  const s = Math.sin(a / 2), c = Math.cos(a / 2)
  return axis === 'x' ? [s, 0, 0, c] : axis === 'y' ? [0, s, 0, c] : [0, 0, s, c]
}
const apply = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
]

/** Skinning matrices for a pose given as { boneName: {axis, angle} }. */
function skinMatrices(pose) {
  const worldOf = []
  for (let i = 0; i < joints.length; i++) {
    const r = pose[nameOf[i]]
    const m = trs(local[i], r ? axisQuat(r.axis, r.angle) : [0, 0, 0, 1])
    worldOf[i] = parent[i] < 0 ? m : mul(worldOf[parent[i]], m)
  }
  return worldOf.map((w, i) => mul(w, Array.from(ibm.slice(i * 16, i * 16 + 16))))
}

// -- geometry -------------------------------------------------------------
const prim = doc.getRoot().listMeshes().find((m) => m.getName() === 'muscleMesh').listPrimitives()[0]
const POS = prim.getAttribute('POSITION').getArray()
const JNT = prim.getAttribute('JOINTS_0').getArray()
const WGT = prim.getAttribute('WEIGHTS_0').getArray()
const IDS = prim.getAttribute('_AMUSCLEID').getArray()

const byMuscle = new Map()
for (let v = 0; v < POS.length / 3; v++) {
  const id = IDS[v]
  if (!id) continue
  if (!byMuscle.has(id)) byMuscle.set(id, [])
  byMuscle.get(id).push(v)
}

const skinVertex = (v, mats) => {
  const out = [0, 0, 0]
  const p = [POS[v * 3], POS[v * 3 + 1], POS[v * 3 + 2]]
  for (let k = 0; k < 4; k++) {
    const w = WGT[v * 4 + k]
    if (!w) continue
    const q = apply(mats[JNT[v * 4 + k]], p)
    out[0] += w * q[0]; out[1] += w * q[1]; out[2] += w * q[2]
  }
  return out
}
const d3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

/** Pose a movement at its full ROM, the worst case the app can produce. */
function poseFor(movement, side) {
  const pose = {}
  for (const m of movement.motions) {
    const s = m.joint === 'spine' ? 'C' : side
    let ax
    try { ax = jointActionAxis(m.joint, m.action, s) } catch { continue }
    const rom = jointRom(m.joint, s, ax.axis)
    if (!rom) continue
    pose[jointBone(m.joint, s)] = { axis: ax.axis, angle: ax.sign > 0 ? rom.max : rom.min }
  }
  return pose
}

const wanted = process.argv.slice(2)
const movements = wanted.length ? MOVEMENTS.filter((m) => wanted.includes(m.key)) : MOVEMENTS

console.log('stretch = posed distance / rest distance, worst vertex pair in the muscle')
console.log('  1.0 = rigid   ~1.3-1.5 = plausible tissue   >2 = a membrane, not a muscle\n')

let worstOverall = []
for (const movement of movements) {
  const side = movement.laterality === 'bilateral' ? 'L' : 'L'
  const pose = poseFor(movement, side)
  if (!Object.keys(pose).length) continue
  const mats = skinMatrices(pose)

  const rows = []
  for (const [id, verts] of byMuscle) {
    const muscle = MUSCLES.find((m) => m.id === id)
    if (!muscle) continue
    // Sample pairs — full O(n^2) over 5k verts per muscle is pointless.
    const step = Math.max(1, Math.floor(verts.length / 90))
    const sample = verts.filter((_, i) => i % step === 0).slice(0, 90)
    let worst = 1, moved = 0
    const posed = sample.map((v) => skinVertex(v, mats))
    for (let i = 0; i < sample.length; i++) {
      const rest = [POS[sample[i] * 3], POS[sample[i] * 3 + 1], POS[sample[i] * 3 + 2]]
      moved = Math.max(moved, d3(rest, posed[i]))
      for (let j = i + 1; j < sample.length; j++) {
        const r0 = d3(rest, [POS[sample[j] * 3], POS[sample[j] * 3 + 1], POS[sample[j] * 3 + 2]])
        if (r0 < 0.02) continue // tiny rest gaps make the ratio explode meaninglessly
        worst = Math.max(worst, d3(posed[i], posed[j]) / r0)
      }
    }
    if (worst > 1.02 || moved > 0.02) rows.push({ key: `${muscle.key}_${muscle.side}`, worst, moved })
  }

  rows.sort((a, b) => b.worst - a.worst)
  const bad = rows.filter((r) => r.worst > 1.6)
  console.log(`${movement.key}  (${movement.ko})`)
  if (!rows.length) console.log('   (nothing moves)')
  for (const r of rows.slice(0, 5)) {
    const flag = r.worst > 2 ? ' <-- MEMBRANE' : r.worst > 1.6 ? ' <-- suspect' : ''
    console.log(`   ${r.key.padEnd(34)} stretch ${r.worst.toFixed(2)}x   max vertex travel ${(r.moved * 100).toFixed(0)}cm${flag}`)
  }
  if (bad.length) worstOverall.push(...bad.map((b) => ({ ...b, movement: movement.key })))
  console.log('')
}

if (worstOverall.length) {
  console.log('=== muscles stretching implausibly (>1.6x):')
  for (const w of worstOverall.sort((a, b) => b.worst - a.worst).slice(0, 12))
    console.log(`   ${w.worst.toFixed(2)}x  ${w.key}  during ${w.movement}`)
  process.exitCode = 1
} else {
  console.log('=== no muscle stretches past 1.6x')
}
