// Re-derive joints.ts's rotation axes and signs against the SHIPPED rig.
//
// This is the procedure joints.ts's header comment prescribes, re-run for P6.
// It is deliberately a measurement, not a derivation: the placeholder rig put
// the figure's left at -X while the real anatomy puts it at +X, and reasoning
// about what that does to a mirrored abduction sign is exactly the kind of
// step that is easy to get backwards and impossible to notice afterwards — a
// wrong sign doesn't crash, it just quietly highlights the wrong muscles.
//
// Method: the bind pose is translation-only (build-anatomy.mjs writes no
// rotations), so each bone's local axes equal the world axes at rest. Rotate
// one bone by a known signed angle about one axis, then read which way its
// child actually moved in world space.
//
// Run: node tools/calibrate-joints.mjs

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NodeIO } from '@gltf-transform/core'
import { EXTMeshoptCompression } from '@gltf-transform/extensions'
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer'

const HERE = dirname(fileURLToPath(import.meta.url))
await MeshoptDecoder.ready
await MeshoptEncoder.ready

const io = new NodeIO()
  .registerExtensions([EXTMeshoptCompression])
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder })
const doc = await io.read(resolve(HERE, '../public/models/anatomy.glb'))

// -- rebuild the bone graph from the file itself ---------------------------
const skin = doc.getRoot().listSkins()[0]
const joints = skin.listJoints()
const local = new Map() // name -> [x,y,z]
const parent = new Map()
for (const j of joints) {
  local.set(j.getName(), j.getTranslation())
  for (const c of j.listChildren()) parent.set(c.getName(), j.getName())
}
const names = joints.map((j) => j.getName())

const CHILD = {
  scapula: 'upperArm', // rotating shoulder_X (the girdle), watch upperArm_X
  shoulder: 'forearm', // rotating upperArm_X, watch forearm_X
  elbow: 'hand',
  hip: 'shin',
  knee: 'foot',
  spine: 'chest',
}
const DRIVER = { scapula: 'shoulder', shoulder: 'upperArm', elbow: 'forearm', hip: 'thigh', knee: 'shin', spine: 'spine' }

function worldOf(name, rot) {
  // Walk root -> name accumulating translation + the one test rotation.
  const chain = []
  for (let n = name; n; n = parent.get(n)) chain.unshift(n)
  let p = [0, 0, 0]
  let q = [0, 0, 0, 1]
  for (const n of chain) {
    const t = rotateVec(local.get(n), q)
    p = [p[0] + t[0], p[1] + t[1], p[2] + t[2]]
    if (rot && rot.bone === n) q = mulQuat(q, axisQuat(rot.axis, rot.angle))
  }
  return p
}

function axisQuat(axis, angle) {
  const h = angle / 2, s = Math.sin(h), c = Math.cos(h)
  return axis === 'x' ? [s, 0, 0, c] : axis === 'y' ? [0, s, 0, c] : [0, 0, s, c]
}
function mulQuat(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ]
}
function rotateVec(v, q) {
  const [x, y, z] = v, [qx, qy, qz, qw] = q
  const ix = qw * x + qy * z - qz * y
  const iy = qw * y + qz * x - qx * z
  const iz = qw * z + qx * y - qy * x
  const iw = -qx * x - qy * y - qz * z
  return [
    ix * qw + iw * -qx + iy * -qz - iz * -qy,
    iy * qw + iw * -qy + iz * -qx - ix * -qz,
    iz * qw + iw * -qz + ix * -qy - iy * -qx,
  ]
}

const DEG = Math.PI / 180
const fmt = (d) => `X:${d[0] >= 0 ? '+' : ''}${d[0].toFixed(3)} Y:${d[1] >= 0 ? '+' : ''}${d[1].toFixed(3)} Z:${d[2] >= 0 ? '+' : ''}${d[2].toFixed(3)}`

// App space: +X = figure's LEFT, +Y = up, +Z = anterior (front).
const describe = (d, side) => {
  const bits = []
  const lateralSign = side === 'L' ? 1 : -1 // "away from midline" is +X on the left, -X on the right
  if (Math.abs(d[2]) > 0.004) bits.push(d[2] > 0 ? 'anterior' : 'posterior')
  if (Math.abs(d[0]) > 0.004) bits.push(d[0] * lateralSign > 0 ? 'abduct(away from midline)' : 'adduct(toward midline)')
  if (Math.abs(d[1]) > 0.004) bits.push(d[1] > 0 ? 'up' : 'down')
  return bits.join(', ') || '(negligible)'
}

console.log('\nRig bind pose is translation-only, so local axes == world axes at rest.')
console.log('App space: +X = figure\'s LEFT, +Y = up, +Z = anterior.\n')

for (const joint of ['scapula', 'shoulder', 'elbow', 'hip', 'knee', 'spine']) {
  for (const side of joint === 'spine' ? ['C'] : ['L', 'R']) {
    const driver = joint === 'spine' ? 'spine' : `${DRIVER[joint]}_${side}`
    const child = joint === 'spine' ? 'chest' : `${CHILD[joint]}_${side}`
    if (!names.includes(driver) || !names.includes(child)) continue
    console.log(`-- ${joint}${side === 'C' ? '' : '_' + side}  (rotate ${driver}, watch ${child})`)
    for (const axis of ['x', 'z']) {
      const base = worldOf(child, null)
      const plus = worldOf(child, { bone: driver, axis, angle: 20 * DEG })
      const minus = worldOf(child, { bone: driver, axis, angle: -20 * DEG })
      const dP = plus.map((v, i) => v - base[i])
      const dM = minus.map((v, i) => v - base[i])
      if (Math.hypot(...dP) < 0.004) continue
      console.log(`   ${axis}  +20deg -> ${fmt(dP)}   = ${describe(dP, side)}`)
      console.log(`   ${axis}  -20deg -> ${fmt(dM)}   = ${describe(dM, side)}`)
    }
    console.log('')
  }
}
