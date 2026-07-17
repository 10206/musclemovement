// Build the app's rigged anatomy GLB from the BodyParts3D / Z-Anatomy source.
//
// Input : <src>/anatomy.glb, <src>/skeleton.glb  (see tools/fetch-source.sh)
// Output: public/models/anatomy.glb              (one rigged, merged file)
//
// What it does:
//   1. Re-space the source (Z-up, millimetres) into the app's space
//      (Y-up, metres, +Z anterior, +X = the figure's own left), grounded at y=0.
//   2. Derive joint centres from the real skeleton geometry — no hand-placed
//      bones — and build the 19-bone rig the app already codes against.
//   3. Skin every muscle using tools/anatomy-map.mjs's anatomical rules.
//   4. Merge muscles into ONE SkinnedMesh carrying `aMuscleId`, and bones into
//      a second one carrying `aBoneId` (ARCHITECTURE.md §1.1: one draw call).
//   5. Emit a single GLB with the skin, both meshes, and the shared skeleton.
//
// Run: node tools/build-anatomy.mjs <src-dir>

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MeshoptSimplifier } from 'meshoptimizer'
import { extractMeshes, readGlb, writeGlb } from './lib/glb.mjs'
import { BONE_EXCLUDE, BONE_RULES, BONE_SIMPLIFY, CONTEXT_GROUPS, JOINT_BLEND, MUSCLE_SOURCES, expandSide } from './anatomy-map.mjs'
import { MUSCLES } from '../src/anatomy/muscles.ts'

await MeshoptSimplifier.ready

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(HERE, '../public/models/anatomy.glb')

const srcDir = process.argv[2]
if (!srcDir) {
  console.error('usage: node tools/build-anatomy.mjs <src-dir>')
  process.exit(1)
}

// ---------------------------------------------------------------------------
// 1. Source -> app space
// ---------------------------------------------------------------------------
// Source is Z-up, millimetres, with +X = the figure's left and -Y = anterior
// (verified in tools/analyze-source.mjs: rectus abdominis sits at y=-193 and
// latissimus dorsi at y=-23; left/right rectus femoris mirror at x=+-107).
//
// The app is Y-up, metres, +Z anterior, +X = the figure's left.
//
// That is exactly a -90 degree rotation about X: (x, y, z) -> (x, z, -y).
// Determinant +1, so it is a real rotation and NOT a mirror. This matters:
// the obvious-looking "left = -X" mapping the placeholder used has
// determinant -1, which would silently flip the model's chirality and give
// the left arm a right arm's shape.
const toApp = (x, y, z) => [x / 1000, z / 1000, -y / 1000]

function loadTransformed(file) {
  const meshes = extractMeshes(readGlb(`${srcDir}/${file}`))
  for (const m of meshes) {
    const p = m.position
    for (let i = 0; i < p.length; i += 3) {
      const [X, Y, Z] = toApp(p[i], p[i + 1], p[i + 2])
      p[i] = X; p[i + 1] = Y; p[i + 2] = Z
    }
    if (m.normal) {
      const n = m.normal
      for (let i = 0; i < n.length; i += 3) {
        const [X, Y, Z] = toApp(n[i], n[i + 1], n[i + 2])
        // Rotation only: direction transforms the same way, no rescale needed.
        n[i] = X * 1000; n[i + 1] = Y * 1000; n[i + 2] = Z * 1000
      }
    }
  }
  return meshes
}

const anatomy = loadTransformed('anatomy.glb')
const skeleton = loadTransformed('skeleton.glb')
const anatomyByName = new Map(anatomy.map((m) => [m.name.toLowerCase(), m]))
const skeletonByName = new Map(skeleton.map((m) => [m.name.toLowerCase(), m]))

// Stand the figure on y=0 rather than wherever the scan's origin happened to be.
let groundY = Infinity
for (const m of [...anatomy, ...skeleton])
  for (let i = 1; i < m.position.length; i += 3) if (m.position[i] < groundY) groundY = m.position[i]
for (const m of [...anatomy, ...skeleton])
  for (let i = 1; i < m.position.length; i += 3) m.position[i] -= groundY
console.log(`[space] grounded by ${(-groundY).toFixed(3)}m`)

// ---------------------------------------------------------------------------
// 2. Rig, derived from the real bones
// ---------------------------------------------------------------------------

/** Centroid of the extreme `frac` of a bone along Y. Long bones stand roughly
 * vertical in this anatomical pose, so their Y extremes are the articular
 * ends. Segment lengths are asserted against adult norms below, which is what
 * actually catches a bad landmark. */
function endCentroid(mesh, top, frac = 0.06) {
  const ys = []
  for (let i = 1; i < mesh.position.length; i += 3) ys.push(mesh.position[i])
  ys.sort((a, b) => a - b)
  const cut = top ? ys[Math.floor(ys.length * (1 - frac))] : ys[Math.floor(ys.length * frac)]
  const c = [0, 0, 0]
  let n = 0
  for (let i = 0; i < mesh.position.length; i += 3) {
    const y = mesh.position[i + 1]
    if (top ? y >= cut : y <= cut) { c[0] += mesh.position[i]; c[1] += y; c[2] += mesh.position[i + 2]; n++ }
  }
  return c.map((v) => v / n)
}

function centroid(mesh) {
  const c = [0, 0, 0]
  const n = mesh.position.length / 3
  for (let i = 0; i < mesh.position.length; i += 3) { c[0] += mesh.position[i]; c[1] += mesh.position[i + 1]; c[2] += mesh.position[i + 2] }
  return c.map((v) => v / n)
}

const bone = (name) => {
  const m = skeletonByName.get(name)
  if (!m) throw new Error(`skeleton is missing "${name}" — the source export changed`)
  return m
}

const pos = {}
for (const [S, X] of [['left', 'L'], ['right', 'R']]) {
  pos[`upperArm_${X}`] = endCentroid(bone(`${S} humerus`), true)
  pos[`forearm_${X}`] = endCentroid(bone(`${S} humerus`), false)
  pos[`hand_${X}`] = endCentroid(bone(`${S} radius`), false)
  pos[`thigh_${X}`] = endCentroid(bone(`${S} femur`), true)
  pos[`shin_${X}`] = endCentroid(bone(`${S} femur`), false)
  pos[`foot_${X}`] = endCentroid(bone(`${S} tibia`), false)
  // Clavicle's sternal (medial) end: the shoulder girdle's actual pivot.
  const cl = bone(`${S} clavicle`)
  let best = null
  for (let i = 0; i < cl.position.length; i += 3) {
    const p = [cl.position[i], cl.position[i + 1], cl.position[i + 2]]
    if (!best || Math.abs(p[0]) < Math.abs(best[0])) best = p
  }
  pos[`shoulder_${X}`] = best
}
pos.hips = centroid(bone('left hip bone')).map((v, i) => (v + centroid(bone('right hip bone'))[i]) / 2)
pos.spine = centroid(bone('third lumbar vertebra'))
pos.chest = centroid(bone('eighth thoracic vertebra'))
pos.neck = centroid(bone('seventh cervical vertebra'))
pos.head = centroid(bone('atlas'))

const PARENT = {
  hips: null, spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck',
  shoulder_L: 'chest', upperArm_L: 'shoulder_L', forearm_L: 'upperArm_L', hand_L: 'forearm_L',
  shoulder_R: 'chest', upperArm_R: 'shoulder_R', forearm_R: 'upperArm_R', hand_R: 'forearm_R',
  thigh_L: 'hips', shin_L: 'thigh_L', foot_L: 'shin_L',
  thigh_R: 'hips', shin_R: 'thigh_R', foot_R: 'shin_R',
}
const BONE_ORDER = Object.keys(PARENT)
const CHILD_OF = {}
for (const [b, p] of Object.entries(PARENT)) if (p && !CHILD_OF[p]) CHILD_OF[p] = b
// Prefer the anatomically continuing child for direction purposes.
CHILD_OF.chest = 'neck'
CHILD_OF.hips = 'spine'

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
console.log('[rig] segment lengths (m):')
for (const [a, b, lo, hi] of [
  ['upperArm_L', 'forearm_L', 0.26, 0.38], ['forearm_L', 'hand_L', 0.21, 0.30],
  ['thigh_L', 'shin_L', 0.36, 0.48], ['shin_L', 'foot_L', 0.33, 0.45],
]) {
  const d = dist(pos[a], pos[b])
  const ok = d >= lo && d <= hi
  console.log(`   ${(a + ' -> ' + b).padEnd(24)} ${d.toFixed(3)}  ${ok ? 'ok' : `OUT OF RANGE (${lo}-${hi})`}`)
  if (!ok) throw new Error(`derived rig is anatomically wrong: ${a}->${b} = ${d.toFixed(3)}m`)
}

// ---------------------------------------------------------------------------
// 3. Skinning
// ---------------------------------------------------------------------------

/** Bone whose ORIGIN is the given anatomical joint — the same contract
 * src/anatomy/joints.ts uses (a joint is actuated by rotating its distal bone,
 * and our bones sit at their joint). */
const jointBone = (joint, X) =>
  ({ shoulder: `upperArm_${X}`, elbow: `forearm_${X}`, wrist: `hand_${X}`, hip: `thigh_${X}`, knee: `shin_${X}`, ankle: `foot_${X}`, spine: 'spine' })[joint]

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const norm = (v) => { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l] }
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const smoothstep = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t) }

/**
 * Direction the blend runs, pointing from the proximal bone toward the distal
 * one, anchored at the joint.
 */
function blendAxis(jb, A, B) {
  if (dist(pos[B], pos[jb]) > 1e-6) return norm(sub(pos[B], pos[jb]))
  const child = CHILD_OF[B]
  if (child) return norm(sub(pos[child], pos[B]))
  return norm(sub(pos[B], pos[A])) // leaf (foot): continue the limb's direction
}

// ---------------------------------------------------------------------------
// Two blend rules, because "which bone does this vertex follow?" is a
// different question depending on how the two bones sit in space.
// ---------------------------------------------------------------------------
//
// ALONG (elbow, knee, wrist, ankle): the two bones are collinear segments of
//   one limb, so "how far past the joint is this vertex, measured down the
//   limb" is unambiguous and exactly right. Distance can't answer it — the
//   brachialis belly sits only ~5cm from the forearm bone but belongs to the
//   humerus.
//
// NEAR (shoulder, hip, spine): the proximal bone is in the torso and the
//   distal one is a limb, pointing off in another direction entirely. The
//   ALONG rule breaks badly here, because a muscle anchored on the torso runs
//   down the TORSO, not down the limb — every vertex of latissimus dorsi, all
//   the way to the lumbar spine, is "below the shoulder" and so read as
//   distal. Measured: 100% of the lat was bound rigidly to the humerus, 898 of
//   its vertices more than 15cm from the bone they followed, so raising the
//   arm peeled the whole sheet off the back and swung it round to the front.
//   What actually decides it is proximity to the limb: only the tendon reaches
//   the humerus, and the belly never does.
const TORSO_BONES = new Set(['hips', 'spine', 'chest', 'neck', 'shoulder_L', 'shoulder_R'])

/** How near a limb bone a vertex must be to follow it fully, and how far to
 * ignore it entirely. Between the two it blends, which is what lets pec major
 * stretch from a fixed sternum to a moving humerus. */
const NEAR_FULL = 0.025
const NEAR_NONE = 0.1

/** The line segment a bone physically occupies. */
function boneSegment(name) {
  const child = CHILD_OF[name]
  if (child) return [pos[name], pos[child]]
  // Leaf bones have no child to point at, so give them an anatomical one —
  // otherwise they collapse to a point and every distance to them is measured
  // from the joint, not from the body part.
  const dir = LEAF_TAIL[name]
  if (!dir) return [pos[name], pos[name]]
  return [pos[name], [pos[name][0] + dir[0], pos[name][1] + dir[1], pos[name][2] + dir[2]]]
}

const LEAF_TAIL = {}
for (const X of ['L', 'R']) {
  // The hand continues the forearm's line.
  const d = norm(sub(pos[`hand_${X}`], pos[`forearm_${X}`]))
  LEAF_TAIL[`hand_${X}`] = [d[0] * 0.09, d[1] * 0.09, d[2] * 0.09]
  // The foot points anterior (+Z), NOT down the shin.
  LEAF_TAIL[`foot_${X}`] = [0, 0, 0.12]
}
LEAF_TAIL.head = [0, 0.15, 0]

function segmentPointDistance(p, [a, b]) {
  const ab = sub(b, a)
  const len2 = dot(ab, ab)
  if (len2 < 1e-9) return dist(p, a)
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / len2))
  return dist(p, [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t])
}

/** Weights for one vertex under a rig rule. Returns [[boneName, weight], ...]. */
function weightsFor(rule, X, v) {
  if (rule.rigid) return [[expandSide(rule.rigid, X), 1]]
  const A = expandSide(rule.span[0], X)
  const B = expandSide(rule.span[1], X)

  let wB
  // NEAR only for torso -> LIMB. A torso-to-torso span (the abdominals, the
  // erector spinae) is collinear up the trunk, so it wants ALONG just like a
  // limb does — NEAR would strand the lumbar end 0.3m from the bone it follows.
  if (TORSO_BONES.has(A) && !TORSO_BONES.has(B)) {
    // NEAR: follow the limb only as far as you actually reach it.
    wB = 1 - smoothstep(NEAR_FULL, NEAR_NONE, segmentPointDistance(v, boneSegment(B)))
  } else {
    // ALONG: follow the distal bone once you're past the joint.
    const jb = jointBone(rule.joint, X)
    wB = smoothstep(-JOINT_BLEND, JOINT_BLEND, dot(sub(v, pos[jb]), blendAxis(jb, A, B)))
  }

  if (wB <= 0.001) return [[A, 1]]
  if (wB >= 0.999) return [[B, 1]]
  return [[A, 1 - wB], [B, wB]]
}

// ---------------------------------------------------------------------------
// 4. Merge
// ---------------------------------------------------------------------------

const boneIndex = Object.fromEntries(BONE_ORDER.map((b, i) => [b, i]))

function buildLayer(entries, idAttrName) {
  const position = [], normal = [], joints = [], weights = [], ids = [], index = []
  let base = 0
  let dropped = 0

  for (const e of entries) {
    for (const mesh of e.meshes) {
      const vcount = mesh.position.length / 3
      for (let i = 0; i < vcount; i++) {
        const v = [mesh.position[i * 3], mesh.position[i * 3 + 1], mesh.position[i * 3 + 2]]
        position.push(v[0], v[1], v[2])
        if (mesh.normal) normal.push(mesh.normal[i * 3], mesh.normal[i * 3 + 1], mesh.normal[i * 3 + 2])
        else normal.push(0, 1, 0)

        const w = e.weights(v)
        const j4 = [0, 0, 0, 0], w4 = [0, 0, 0, 0]
        w.slice(0, 4).forEach(([b, wt], k) => { j4[k] = boneIndex[b]; w4[k] = wt })
        const sum = w4.reduce((a, b) => a + b, 0) || 1
        joints.push(...j4)
        weights.push(w4[0] / sum, w4[1] / sum, w4[2] / sum, w4[3] / sum)
        // Every vertex of a face must carry the same id (no `flat` in GLSL,
        // and ARCHITECTURE.md 1.2 depends on it). Merging without welding
        // keeps that true by construction.
        ids.push(e.id)
      }
      const src = mesh.index ?? Array.from({ length: vcount }, (_, i) => i)
      for (const i of src) index.push(base + i)
      base += vcount
    }
  }
  if (dropped) console.log(`   dropped ${dropped}`)
  return { position, normal, joints, weights, ids, index, idAttrName }
}

/**
 * Collapse a mesh down to `maxTris` with meshoptimizer.
 *
 * Only ever applied to bone meshes, and only to ONE mesh at a time — never
 * across the merged layer. Collapsing an edge that spans two structures would
 * blend their `aBoneId`/`aMuscleId` and interpolate skin weights between
 * unrelated bones, which is exactly the corruption ARCHITECTURE.md 1.2's
 * "don't weld" rule exists to prevent.
 */
function simplifyMesh(mesh, maxTris) {
  const index = mesh.index ? new Uint32Array(mesh.index) : new Uint32Array(mesh.position.length / 3).map((_, i) => i)
  const triCount = index.length / 3
  if (triCount <= maxTris) return mesh

  const [dstIndex, error] = MeshoptSimplifier.simplify(
    index, mesh.position, 3, maxTris * 3, 0.02,
    ['LockBorder'], // bones are closed shells; keeping any border edges stable is free insurance
  )
  // meshoptimizer leaves unreferenced vertices behind; compact them so the
  // merged buffer doesn't carry dead weight.
  const remap = new Int32Array(mesh.position.length / 3).fill(-1)
  const position = [], normal = []
  const out = new Uint32Array(dstIndex.length)
  for (let i = 0; i < dstIndex.length; i++) {
    const v = dstIndex[i]
    if (remap[v] < 0) {
      remap[v] = position.length / 3
      position.push(mesh.position[v * 3], mesh.position[v * 3 + 1], mesh.position[v * 3 + 2])
      if (mesh.normal) normal.push(mesh.normal[v * 3], mesh.normal[v * 3 + 1], mesh.normal[v * 3 + 2])
    }
    out[i] = remap[v]
  }
  return {
    name: mesh.name,
    position: new Float32Array(position),
    normal: mesh.normal ? new Float32Array(normal) : null,
    index: Array.from(out),
    _error: error,
  }
}

// -- muscles
const muscleEntries = []
const missing = []
for (const muscle of MUSCLES) {
  const spec = MUSCLE_SOURCES[muscle.key]
  if (!spec) { missing.push(`${muscle.key} (no mapping)`); continue }
  // Registry 'C' muscles (rectus abdominis) are single entries, but the source
  // ships them per side — pull both in under the one id.
  const sides = muscle.side === 'C' ? ['L', 'R'] : [muscle.side]
  const meshes = []
  let rigSide = muscle.side === 'C' ? 'L' : muscle.side
  for (const X of sides) {
    for (const pattern of spec.sources) {
      const name = expandSide(pattern, X).toLowerCase()
      const m = anatomyByName.get(name)
      if (!m) { missing.push(`${muscle.key}: "${name}"`); continue }
      meshes.push(m)
    }
  }
  if (!meshes.length) continue
  muscleEntries.push({
    id: muscle.id,
    meshes,
    // For a 'C' muscle the span bones are centre bones anyway (hips/chest), so
    // the side used to expand the rule is irrelevant.
    weights: (v) => weightsFor(spec.rig, rigSide, v),
  })
}
if (missing.length) {
  console.error('\n[muscles] MISSING SOURCES:')
  for (const m of missing) console.error('   ' + m)
  throw new Error(`${missing.length} muscle source(s) unresolved`)
}
console.log(`[muscles] ${muscleEntries.length} registry entries from ${new Set(muscleEntries.flatMap((e) => e.meshes)).size} source meshes`)

// -- context muscles: everything else that holds the silhouette, id 0 -------
const usedSources = new Set(muscleEntries.flatMap((e) => e.meshes.map((m) => m.name)))
const contextEntries = []
let ctxSkipped = 0, ctxUnclaimed = 0, ctxBefore = 0, ctxAfter = 0
for (const mesh of anatomy) {
  if (usedSources.has(mesh.name)) continue
  const n = mesh.name.toLowerCase()
  const group = CONTEXT_GROUPS.find((g) => g.match.test(n))
  if (!group) { ctxUnclaimed++; continue }
  if (group.skip) { ctxSkipped++; continue }

  // Side comes from geometry, not from the name. BodyParts3D genuinely has
  // "left flexor pollicis brevis" sitting on the RIGHT hand (and vice versa) —
  // its sibling "superficial head of left flexor pollicis brevis" is on the
  // left, so the label really is swapped upstream, not misread here. Trusting
  // the name binds that muscle to the opposite arm and it flies off when the
  // elbow bends. The centroid can't be wrong: in app space the figure's left
  // is +X, full stop.
  const c = centroid(mesh)
  const X = c[0] >= 0 ? 'L' : 'R'
  if ((/\bleft\b/.test(n) && X === 'R') || (/\bright\b/.test(n) && X === 'L')) {
    console.warn(`[context] "${mesh.name}" is labelled ${/\bleft\b/.test(n) ? 'left' : 'right'} but sits at x=${c[0].toFixed(3)} — trusting geometry, binding to ${X}`)
  }
  ctxBefore += mesh.index.length / 3
  const simplified = simplifyMesh(mesh, group.maxTris)
  ctxAfter += simplified.index.length / 3
  contextEntries.push({ id: 0, meshes: [simplified], weights: (v) => weightsFor(group.rig, X, v) })
}
console.log(`[context] ${contextEntries.length} meshes kept, ${ctxSkipped} deep/invisible skipped, ${ctxUnclaimed} unclaimed`)
console.log(`[context] simplified ${Math.round(ctxBefore).toLocaleString()} -> ${Math.round(ctxAfter).toLocaleString()} tris`)
muscleEntries.push(...contextEntries)


// -- bones
const boneEntries = []
const unmatched = []
let excluded = 0
let bonesBefore = 0, bonesAfter = 0
for (const mesh of skeleton) {
  const n = mesh.name.toLowerCase()
  if (BONE_EXCLUDE.some((re) => re.test(n))) { excluded++; continue }

  const side = /\bleft\b/.test(n) ? 'L' : /\bright\b/.test(n) ? 'R' : null
  let target = null
  for (const [re, rule] of BONE_RULES) {
    if (re.test(n)) { target = rule.includes('_X') ? (side ? rule.replace('_X', `_${side}`) : null) : rule; break }
  }
  if (!target || !(target in boneIndex)) { unmatched.push(mesh.name); continue }

  const cap = BONE_SIMPLIFY.find(([re]) => re.test(n))?.[1]
  bonesBefore += mesh.index.length / 3
  const finalMesh = cap ? simplifyMesh(mesh, cap) : mesh
  bonesAfter += finalMesh.index.length / 3

  boneEntries.push({ id: boneIndex[target] + 1, meshes: [finalMesh], weights: () => [[target, 1]] })
}
console.log(`[bones] kept ${boneEntries.length}, excluded ${excluded}, unmatched ${unmatched.length}`)
console.log(`[bones] simplified ${Math.round(bonesBefore).toLocaleString()} -> ${Math.round(bonesAfter).toLocaleString()} tris (${(100 - 100 * bonesAfter / bonesBefore).toFixed(0)}% off)`)
if (unmatched.length) console.log('   unmatched: ' + unmatched.slice(0, 8).join(' | '))

// ---------------------------------------------------------------------------
// Sanity: a muscle must actually live near the bones it was bound to.
// ---------------------------------------------------------------------------
// Anatomical names are a treacherous way to sort limbs — "flexor digitorum
// longus" is in the calf, "flexor digitorum profundus" is in the forearm. A
// mis-scoped regex binds a calf muscle to the humerus, which looks fine at
// bind pose and only reveals itself when a joint moves and the muscle sails
// off across the screen.
//
// Geometry doesn't lie: whatever a muscle is called, it has to be within arm's
// reach of the bone that moves it. So assert it, and fail the build rather
// than ship a flying muscle.
const SANITY_RADIUS = 0.28 // metres from the bone segment; generous, catches only real errors

function segmentDistance(p, a, b) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]]
  const len2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2
  const t = len2 ? Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / len2)) : 0
  const c = [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]
  return dist(p, c)
}

/** Distance from a point to a bone, treated as the segment from the bone to
 * its child (or just the bone's origin for a leaf). */
function boneDistance(p, name) {
  const child = CHILD_OF[name]
  return child ? segmentDistance(p, pos[name], pos[child]) : dist(p, pos[name])
}

{
  const offenders = []
  for (const entry of muscleEntries) {
    for (const mesh of entry.meshes) {
      const c = centroid(mesh)
      // Which bones does this entry's rule actually bind to? Ask the rule.
      const bones = new Set(entry.weights(c).map(([b]) => b))
      // Sample the extremes too: a long muscle's centroid can sit near the
      // right bone while its ends are bound to the wrong one.
      for (const probe of [c, mesh.position.slice(0, 3), mesh.position.slice(-3)]) {
        for (const [b] of entry.weights([...probe])) bones.add(b)
      }
      const nearest = Math.min(...[...bones].map((b) => boneDistance(c, b)))
      if (nearest > SANITY_RADIUS) offenders.push(`${mesh.name} -> ${[...bones].join('+')} (${nearest.toFixed(2)}m away)`)
    }
  }
  if (offenders.length) {
    console.error(`\n[sanity] ${offenders.length} muscle(s) bound to a bone they are nowhere near:`)
    for (const o of offenders) console.error('   ' + o)
    throw new Error('mis-scoped rig rule — see tools/anatomy-map.mjs')
  }
  console.log(`[sanity] all ${muscleEntries.length} muscles sit within ${SANITY_RADIUS}m of the bones they follow`)
}

const muscleLayer = buildLayer(muscleEntries, 'aMuscleId')
const boneLayer = buildLayer(boneEntries, 'aBoneId')

const triCount = (l) => l.index.length / 3
console.log(`[merge] muscles: ${muscleEntries.length} entries, ${(muscleLayer.position.length / 3).toLocaleString()} verts, ${triCount(muscleLayer).toLocaleString()} tris`)
console.log(`[merge] bones:   ${boneEntries.length} entries, ${(boneLayer.position.length / 3).toLocaleString()} verts, ${triCount(boneLayer).toLocaleString()} tris`)

// ---------------------------------------------------------------------------
// 5. Emit GLB
// ---------------------------------------------------------------------------

const json = { asset: { version: '2.0', generator: 'musclemovement/tools/build-anatomy.mjs' }, scene: 0, scenes: [{ nodes: [] }], nodes: [], meshes: [], accessors: [], bufferViews: [], buffers: [], skins: [] }
const chunks = []
let byteOffset = 0

function pushAccessor(array, type, componentType, target) {
  const buf = Buffer.from(array.buffer, array.byteOffset, array.byteLength)
  const padded = buf.length % 4 ? Buffer.concat([buf, Buffer.alloc(4 - (buf.length % 4))]) : buf
  chunks.push(padded)
  const bv = json.bufferViews.length
  json.bufferViews.push({ buffer: 0, byteOffset, byteLength: buf.length, ...(target ? { target } : {}) })
  byteOffset += padded.length

  const n = { SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16 }[type]
  const acc = { bufferView: bv, componentType, count: array.length / n, type }
  if (type === 'VEC3' && componentType === 5126) {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < array.length; i += 3) for (let c = 0; c < 3; c++) {
      if (array[i + c] < lo[c]) lo[c] = array[i + c]
      if (array[i + c] > hi[c]) hi[c] = array[i + c]
    }
    acc.min = lo; acc.max = hi // required by spec for POSITION
  }
  json.accessors.push(acc)
  return json.accessors.length - 1
}

// bone nodes (local translation = world - parent world; bind pose has no rotation)
const nodeOfBone = {}
BONE_ORDER.forEach((b, i) => { nodeOfBone[b] = i })
BONE_ORDER.forEach((b) => {
  const p = PARENT[b]
  const t = p ? sub(pos[b], pos[p]) : pos[b]
  json.nodes.push({ name: b, translation: t, children: BONE_ORDER.filter((c) => PARENT[c] === b).map((c) => nodeOfBone[c]) })
})

// inverse bind matrices: bind pose is translation-only, so the inverse is just
// the negated world translation.
const ibm = new Float32Array(BONE_ORDER.length * 16)
BONE_ORDER.forEach((b, i) => {
  const m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -pos[b][0], -pos[b][1], -pos[b][2], 1]
  ibm.set(m, i * 16)
})
json.skins.push({ joints: BONE_ORDER.map((b) => nodeOfBone[b]), inverseBindMatrices: pushAccessor(ibm, 'MAT4', 5126), skeleton: nodeOfBone.hips })

// glTF's baseColorFactor is LINEAR, not sRGB. Writing the sRGB value straight
// in renders roughly (218,145,137) — a washed-out pink — where #b0483f should
// be a deep brick red. The app normally swaps in its own MeshStandardMaterial
// anyway, but this is the material anything else (a glTF viewer, a debugging
// session on anatomy.raw.glb) will see, so it should be right on its own.
const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const hexToLinear = (hex) => [1, 3, 5].map((i) => srgbToLinear(parseInt(hex.slice(i, i + 2), 16) / 255))

json.materials = [
  { name: 'muscle', pbrMetallicRoughness: { baseColorFactor: [...hexToLinear('#b0483f'), 1], metallicFactor: 0, roughnessFactor: 0.62 } },
  { name: 'bone', pbrMetallicRoughness: { baseColorFactor: [...hexToLinear('#e8e3d8'), 1], metallicFactor: 0, roughnessFactor: 0.5 } },
]

function addLayer(layer, name, material) {
  const attributes = {
    POSITION: pushAccessor(new Float32Array(layer.position), 'VEC3', 5126, 34962),
    NORMAL: pushAccessor(new Float32Array(layer.normal), 'VEC3', 5126, 34962),
    JOINTS_0: pushAccessor(new Uint8Array(layer.joints), 'VEC4', 5121, 34962),
    WEIGHTS_0: pushAccessor(new Float32Array(layer.weights), 'VEC4', 5126, 34962),
    [`_${layer.idAttrName.toUpperCase()}`]: pushAccessor(new Float32Array(layer.ids), 'SCALAR', 5126, 34962),
  }
  const indices = pushAccessor(new Uint32Array(layer.index), 'SCALAR', 5125, 34963)
  json.meshes.push({ name, primitives: [{ attributes, indices, material, mode: 4 }] })
  const node = json.nodes.length
  json.nodes.push({ name, mesh: json.meshes.length - 1, skin: 0 })
  json.scenes[0].nodes.push(node)
  return node
}

addLayer(muscleLayer, 'muscleMesh', 0)
addLayer(boneLayer, 'boneMesh', 1)
json.scenes[0].nodes.push(nodeOfBone.hips)

json.buffers.push({ byteLength: byteOffset })
mkdirSync(dirname(OUT), { recursive: true })
writeGlb(OUT, json, chunks)
console.log(`\n[out] ${OUT}  ${(Buffer.concat(chunks).length / 1e6).toFixed(1)}MB bin`)

// ---------------------------------------------------------------------------
// 6. Emit the rest pose as source
// ---------------------------------------------------------------------------
// playback/placeholderClips.ts needs the rig's proportions to solve where the
// pelvis has to drop so a squat keeps its feet on the floor. It used to get
// them by building the placeholder mannequin — which meant the clips were
// computed against a 0.40m thigh while the model shipped a 0.455m one, so the
// grounding was quietly solving the wrong body. Emitting the real numbers from
// the same run that writes the GLB makes the model the single source of truth.
const rest = `// GENERATED by tools/build-anatomy.mjs — do not edit.
//
// The rig's bind pose, in the same app space as the model: metres, Y-up,
// +Z anterior, +X the figure's left, feet on y=0. Rebuild with:
//   npm run build:anatomy

import type { BoneName } from '../scene/rig'

/** Bone -> parent, null for the root. */
export const BONE_PARENT: Record<BoneName, BoneName | null> = {
${BONE_ORDER.map((b) => `  ${b}: ${PARENT[b] ? `'${PARENT[b]}'` : 'null'},`).join('\n')}
}

/** Bone -> WORLD position at bind pose. */
export const BONE_REST: Record<BoneName, readonly [number, number, number]> = {
${BONE_ORDER.map((b) => `  ${b}: [${pos[b].map((v) => v.toFixed(5)).join(', ')}],`).join('\n')}
}

/** Bone -> translation relative to its parent, i.e. what the glTF node holds. */
export const BONE_LOCAL: Record<BoneName, readonly [number, number, number]> = {
${BONE_ORDER.map((b) => {
  const p = PARENT[b]
  const t = p ? sub(pos[b], pos[p]) : pos[b]
  return `  ${b}: [${t.map((v) => v.toFixed(5)).join(', ')}],`
}).join('\n')}
}
`
const restPath = resolve(HERE, '../src/anatomy/rigRest.ts')
writeFileSync(restPath, rest)
console.log(`[out] ${restPath}`)
