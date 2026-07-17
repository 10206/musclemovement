// Minimal glTF/GLB reader + writer for the asset pipeline.
//
// We don't use three.js's GLTFLoader here: it targets the browser (Blob/URL,
// ImageBitmap) and we only need plain indexed triangle geometry with node
// names. Parsing the container directly is ~100 lines, has no DOM
// dependency, and keeps the pipeline debuggable — every failure is in code
// we can read.

import { readFileSync, writeFileSync } from 'node:fs'

const GLB_MAGIC = 0x46546c67
const CHUNK_JSON = 0x4e4f534a
const CHUNK_BIN = 0x004e4942

const COMPONENT = {
  5120: { array: Int8Array, size: 1 },
  5121: { array: Uint8Array, size: 1 },
  5122: { array: Int16Array, size: 2 },
  5123: { array: Uint16Array, size: 2 },
  5125: { array: Uint32Array, size: 4 },
  5126: { array: Float32Array, size: 4 },
}
const NUM_COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }

export function readGlb(path) {
  const buf = readFileSync(path)
  const magic = buf.readUInt32LE(0)
  if (magic !== GLB_MAGIC) throw new Error(`${path}: not a GLB`)
  const total = buf.readUInt32LE(8)

  let off = 12
  let json = null
  let bin = null
  while (off < total) {
    const len = buf.readUInt32LE(off)
    const type = buf.readUInt32LE(off + 4)
    const start = off + 8
    if (type === CHUNK_JSON) json = JSON.parse(buf.subarray(start, start + len).toString('utf8'))
    else if (type === CHUNK_BIN) bin = buf.subarray(start, start + len)
    off = start + len
    if (off % 4 !== 0) off += 4 - (off % 4) // chunks are 4-byte aligned
  }
  if (!json) throw new Error(`${path}: no JSON chunk`)
  return { json, bin }
}

/** Read an accessor into a plain typed array, honouring byteStride. */
export function readAccessor({ json, bin }, index) {
  const acc = json.accessors[index]
  const comp = COMPONENT[acc.componentType]
  const n = NUM_COMPONENTS[acc.type]
  const out = new comp.array(acc.count * n)

  if (acc.bufferView === undefined) return out // spec: undefined bufferView = all zeros

  const view = json.bufferViews[acc.bufferView]
  const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0)
  const stride = view.byteStride ?? comp.size * n

  for (let i = 0; i < acc.count; i++) {
    const at = base + i * stride
    for (let c = 0; c < n; c++) {
      const b = at + c * comp.size
      out[i * n + c] =
        comp.array === Float32Array
          ? bin.readFloatLE(b)
          : comp.array === Uint32Array
            ? bin.readUInt32LE(b)
            : comp.array === Uint16Array
              ? bin.readUInt16LE(b)
              : comp.array === Int16Array
                ? bin.readInt16LE(b)
                : comp.array === Int8Array
                  ? bin.readInt8(b)
                  : bin.readUInt8(b)
    }
  }
  return out
}

/**
 * Every named node that carries a mesh, flattened to world space.
 *
 * These source files put one anatomical structure per node with no nesting
 * and (verified) identity transforms, but we compose the node's TRS anyway
 * rather than trusting that — a silently ignored transform would misplace a
 * muscle by centimetres and look like a rigging bug later.
 */
export function extractMeshes(glb) {
  const { json } = glb
  const out = []
  const nodes = json.nodes ?? []

  const walk = (nodeIndex, parentMatrix) => {
    const node = nodes[nodeIndex]
    const local = nodeMatrix(node)
    const world = mul(parentMatrix, local)

    if (node.mesh !== undefined) {
      const mesh = json.meshes[node.mesh]
      for (const prim of mesh.primitives) {
        if (prim.mode !== undefined && prim.mode !== 4) continue // triangles only
        const pos = readAccessor(glb, prim.attributes.POSITION)
        const nrm = prim.attributes.NORMAL !== undefined ? readAccessor(glb, prim.attributes.NORMAL) : null
        const idx = prim.indices !== undefined ? readAccessor(glb, prim.indices) : null
        out.push({
          name: node.name ?? mesh.name ?? `node_${nodeIndex}`,
          position: applyMatrixToPositions(pos, world),
          normal: nrm ? applyMatrixToNormals(nrm, world) : null,
          index: idx ? Array.from(idx) : null,
        })
      }
    }
    for (const child of node.children ?? []) walk(child, world)
  }

  const roots = json.scenes?.[json.scene ?? 0]?.nodes ?? nodes.map((_, i) => i)
  for (const r of roots) walk(r, identity())
  return out
}

// -- tiny 4x4 matrix helpers (column-major, glTF convention) ---------------

export function identity() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
}

function nodeMatrix(node) {
  if (node.matrix) return node.matrix.slice()
  const t = node.translation ?? [0, 0, 0]
  const r = node.rotation ?? [0, 0, 0, 1]
  const s = node.scale ?? [1, 1, 1]
  const [x, y, z, w] = r
  const x2 = x + x, y2 = y + y, z2 = z + z
  const xx = x * x2, xy = x * y2, xz = x * z2
  const yy = y * y2, yz = y * z2, zz = z * z2
  const wx = w * x2, wy = w * y2, wz = w * z2
  return [
    (1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0,
    (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
    (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ]
}

function mul(a, b) {
  const o = new Array(16)
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      o[c * 4 + r] =
        a[0 * 4 + r] * b[c * 4 + 0] +
        a[1 * 4 + r] * b[c * 4 + 1] +
        a[2 * 4 + r] * b[c * 4 + 2] +
        a[3 * 4 + r] * b[c * 4 + 3]
  return o
}

function applyMatrixToPositions(src, m) {
  const out = new Float32Array(src.length)
  for (let i = 0; i < src.length; i += 3) {
    const x = src[i], y = src[i + 1], z = src[i + 2]
    out[i] = m[0] * x + m[4] * y + m[8] * z + m[12]
    out[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13]
    out[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14]
  }
  return out
}

function applyMatrixToNormals(src, m) {
  // No non-uniform scale in these files, so the upper 3x3 is fine without an
  // inverse-transpose; renormalise anyway to stay safe.
  const out = new Float32Array(src.length)
  for (let i = 0; i < src.length; i += 3) {
    const x = src[i], y = src[i + 1], z = src[i + 2]
    let nx = m[0] * x + m[4] * y + m[8] * z
    let ny = m[1] * x + m[5] * y + m[9] * z
    let nz = m[2] * x + m[6] * y + m[10] * z
    const len = Math.hypot(nx, ny, nz) || 1
    out[i] = nx / len; out[i + 1] = ny / len; out[i + 2] = nz / len
  }
  return out
}

// -- writer ----------------------------------------------------------------

export function writeGlb(path, json, binChunks) {
  const bin = Buffer.concat(binChunks)
  const binPadded = pad(bin, 0)
  const jsonBuf = pad(Buffer.from(JSON.stringify(json), 'utf8'), 0x20)

  const header = Buffer.alloc(12)
  header.writeUInt32LE(GLB_MAGIC, 0)
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + binPadded.length, 8)

  const jsonHeader = Buffer.alloc(8)
  jsonHeader.writeUInt32LE(jsonBuf.length, 0)
  jsonHeader.writeUInt32LE(CHUNK_JSON, 4)

  const binHeader = Buffer.alloc(8)
  binHeader.writeUInt32LE(binPadded.length, 0)
  binHeader.writeUInt32LE(CHUNK_BIN, 4)

  writeFileSync(path, Buffer.concat([header, jsonHeader, jsonBuf, binHeader, binPadded]))
}

function pad(buf, fill) {
  const rem = buf.length % 4
  if (rem === 0) return buf
  return Buffer.concat([buf, Buffer.alloc(4 - rem, fill)])
}
