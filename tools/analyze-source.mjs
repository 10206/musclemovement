// Inspect the downloaded BodyExplorer anatomy/skeleton GLBs before building
// anything from them: coordinate system, scale, triangle budget, and whether
// the muscles our registry names actually exist in there.
//
// Run: node tools/analyze-source.mjs <src-dir>

import { extractMeshes, readGlb } from './lib/glb.mjs'

const srcDir = process.argv[2]
if (!srcDir) {
  console.error('usage: node tools/analyze-source.mjs <src-dir>')
  process.exit(1)
}

function bounds(meshes) {
  const lo = [Infinity, Infinity, Infinity]
  const hi = [-Infinity, -Infinity, -Infinity]
  for (const m of meshes) {
    for (let i = 0; i < m.position.length; i += 3) {
      for (let c = 0; c < 3; c++) {
        const v = m.position[i + c]
        if (v < lo[c]) lo[c] = v
        if (v > hi[c]) hi[c] = v
      }
    }
  }
  return { lo, hi, size: hi.map((h, i) => h - lo[i]) }
}

function tris(meshes) {
  return meshes.reduce((n, m) => n + (m.index ? m.index.length / 3 : m.position.length / 9), 0)
}

for (const file of ['anatomy', 'skeleton']) {
  const glb = readGlb(`${srcDir}/${file}.glb`)
  const meshes = extractMeshes(glb)
  const b = bounds(meshes)
  const f = (a) => a.map((v) => v.toFixed(3)).join(', ')
  console.log(`\n=== ${file}.glb`)
  console.log(`  meshes: ${meshes.length}  triangles: ${Math.round(tris(meshes)).toLocaleString()}`)
  console.log(`  min:  [${f(b.lo)}]`)
  console.log(`  max:  [${f(b.hi)}]`)
  console.log(`  size: [${f(b.size)}]  (longest axis = ${['X', 'Y', 'Z'][b.size.indexOf(Math.max(...b.size))]})`)
  const per = meshes.map((m) => (m.index ? m.index.length / 3 : m.position.length / 9))
  per.sort((a, b2) => b2 - a)
  console.log(`  tris/mesh: max ${per[0]}  median ${per[Math.floor(per.length / 2)]}  min ${per.at(-1)}`)
}

// Which of OUR muscles exist in the source, and under what name?
const REGISTRY_KEYS = [
  'deltoid_anterior', 'deltoid_medius', 'deltoid_posterior', 'supraspinatus',
  'pectoralis_major_clavicular', 'serratus_anterior', 'trapezius', 'latissimus_dorsi',
  'teres_major', 'coracobrachialis', 'biceps_brachii', 'brachialis', 'triceps_brachii',
  'brachioradialis', 'anconeus', 'rectus_abdominis', 'external_oblique', 'internal_oblique',
  'erector_spinae', 'iliopsoas', 'rectus_femoris', 'sartorius', 'tensor_fasciae_latae',
  'pectineus', 'gluteus_maximus', 'biceps_femoris', 'semitendinosus', 'semimembranosus',
  'adductor_magnus', 'vastus_lateralis', 'vastus_medialis', 'vastus_intermedius',
  'gracilis', 'gastrocnemius', 'soleus', 'tibialis_anterior', 'popliteus',
]

const glb = readGlb(`${srcDir}/anatomy.glb`)
const names = extractMeshes(glb).map((m) => m.name.toLowerCase())

console.log('\n=== registry coverage in anatomy.glb')
const missing = []
for (const key of REGISTRY_KEYS) {
  // 'deltoid_anterior' -> match nodes containing 'deltoid'; we refine the
  // head/part split by hand later, this is just a presence check.
  const stem = key.split('_')[0]
  const hits = names.filter((n) => n.includes(stem.replace(/([a-z])([A-Z])/g, '$1 $2')))
  if (hits.length === 0) missing.push(key)
  else console.log(`  ${key.padEnd(30)} ${hits.length} node(s)  e.g. "${hits[0]}"`)
}
console.log('\n  MISSING:', missing.length ? missing.join(', ') : '(none)')
