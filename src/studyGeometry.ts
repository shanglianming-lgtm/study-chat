import * as THREE from 'three'
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'

/** Gridded upholstery, not a beveled cuboid: convex faces meet soft corners. */
export function cushionGeometry(w: number, h: number, d: number, puff = .025) {
  const g = new THREE.BoxGeometry(w, h, d, 12, 6, 10)
  const p = g.getAttribute('position'), radius = Math.min(w, h, d) * .38
  const half = new THREE.Vector3(w / 2, h / 2, d / 2), v = new THREE.Vector3(), inner = new THREE.Vector3()
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i)
    inner.set(
      THREE.MathUtils.clamp(v.x, -half.x + radius, half.x - radius),
      THREE.MathUtils.clamp(v.y, -half.y + radius, half.y - radius),
      THREE.MathUtils.clamp(v.z, -half.z + radius, half.z - radius),
    )
    v.sub(inner).normalize().multiplyScalar(radius).add(inner)
    const x = v.x / half.x, y = v.y / half.y, z = v.z / half.z
    v.x += Math.sign(x) * puff * .35 * (1 - y * y) * (1 - z * z)
    v.y += Math.sign(y) * puff * (1 - x ** 4) * (1 - z ** 4)
    v.z += Math.sign(z) * puff * (1 - x ** 4) * (1 - y ** 4)
    p.setXYZ(i, v.x, v.y, v.z)
  }
  g.computeVertexNormals()
  // Box UV seams must not leave hard lighting seams in the soft upholstery.
  const normals = g.getAttribute('normal'), averages = new Map<string, THREE.Vector3>()
  const key = (i: number) => `${Math.round(p.getX(i) * 1e5)},${Math.round(p.getY(i) * 1e5)},${Math.round(p.getZ(i) * 1e5)}`
  for (let i = 0; i < p.count; i++) {
    const k = key(i), n = averages.get(k) ?? new THREE.Vector3()
    n.add(v.fromBufferAttribute(normals, i)); averages.set(k, n)
  }
  for (let i = 0; i < p.count; i++) { v.copy(averages.get(key(i))!).normalize(); normals.setXYZ(i, v.x, v.y, v.z) }
  return g
}

export function surfaceGeometry(uSteps: number, vSteps: number, point: (u: number, v: number) => THREE.Vector3) {
  const positions: number[] = [], uv: number[] = [], indices: number[] = []
  for (let j = 0; j <= vSteps; j++) for (let i = 0; i <= uSteps; i++) {
    const u = i / uSteps, v = j / vSteps, p = point(u, v)
    positions.push(p.x, p.y, p.z); uv.push(u, v)
  }
  for (let j = 0; j < vSteps; j++) for (let i = 0; i < uSteps; i++) {
    const a = j * (uSteps + 1) + i, b = a + 1, c = a + uSteps + 1, d = c + 1
    indices.push(a, c, b, b, c, d)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(indices); g.computeVertexNormals()
  return g
}

export function roundedLoop(w: number, h: number, r: number, plane: 'xy' | 'xz' = 'xy', offset = 0) {
  const s = new THREE.Shape(), x = w / 2, y = h / 2
  s.moveTo(-x + r, -y); s.lineTo(x - r, -y); s.quadraticCurveTo(x, -y, x, -y + r)
  s.lineTo(x, y - r); s.quadraticCurveTo(x, y, x - r, y)
  s.lineTo(-x + r, y); s.quadraticCurveTo(-x, y, -x, y - r)
  s.lineTo(-x, -y + r); s.quadraticCurveTo(-x, -y, -x + r, -y)
  const points = s.getPoints(5); points.pop()
  return new THREE.CatmullRomCurve3(points.map(p => plane === 'xy' ? new THREE.Vector3(p.x, p.y, offset) : new THREE.Vector3(p.x, offset, p.y)), true)
}

/** Bake static transforms and group by material: details needn't add draw calls. */
export function batchStudy(scene: THREE.Scene, movingBook: THREE.Object3D, assetSlots: THREE.Object3D[] = []) {
  scene.updateMatrixWorld(true)
  const groups = new Map<string, { material: THREE.Material; cast: boolean; receive: boolean; geometries: THREE.BufferGeometry[] }>()
  const originals = new Set<THREE.BufferGeometry>(), meshes: THREE.Mesh[] = []
  scene.traverse(o => {
    if (!(o instanceof THREE.Mesh) || o instanceof THREE.InstancedMesh || Array.isArray(o.material)) return
    for (let parent: THREE.Object3D | null = o; parent; parent = parent.parent) if (parent === movingBook || assetSlots.includes(parent)) return
    const key = `${o.material.uuid}/${o.castShadow}/${o.receiveShadow}`
    if (!groups.has(key)) groups.set(key, { material: o.material, cast: o.castShadow, receive: o.receiveShadow, geometries: [] })
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()
    g.applyMatrix4(o.matrixWorld)
    groups.get(key)!.geometries.push(g); originals.add(o.geometry); meshes.push(o)
  })
  const batches: THREE.Mesh[] = []
  for (const group of groups.values()) {
    const geometry = mergeGeometries(group.geometries, false)
    if (!geometry) throw new Error('Study geometry attributes do not match')
    // Restore vertex reuse after transform baking. Keep normal/UV/color seams;
    // non-indexed batches otherwise transform every shared triangle corner.
    const indexed = mergeVertices(geometry, 1e-6); geometry.dispose()
    const m = new THREE.Mesh(indexed, group.material)
    m.name = `Static study / ${group.material.name || group.material.type}`
    m.castShadow = group.cast; m.receiveShadow = group.receive; batches.push(m)
    group.geometries.forEach(g => g.dispose())
  }
  meshes.forEach(m => m.removeFromParent()); originals.forEach(g => g.dispose()); scene.add(...batches)
}
