import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { batchStudy, cushionGeometry, surfaceGeometry } from './studyGeometry'

describe('locally modeled study geometry', () => {
  it('bakes furniture world transforms without moving its visible bounds', () => {
    const scene = new THREE.Scene(), furniture = new THREE.Group(), book = new THREE.Group()
    const material = new THREE.MeshStandardMaterial(), geometry = new THREE.BoxGeometry(.8, .2, .5)
    furniture.position.set(-3, .6, 1); furniture.rotation.y = Math.PI / 2; furniture.scale.setScalar(.8)
    for (const x of [-.7, .7]) {
      const part = new THREE.Mesh(geometry, material); part.position.x = x; part.castShadow = part.receiveShadow = true; furniture.add(part)
    }
    scene.add(furniture, book)
    const before = new THREE.Box3().setFromObject(furniture)
    batchStudy(scene, book)
    const after = new THREE.Box3().setFromObject(scene)
    expect(after.min.distanceTo(before.min)).toBeLessThan(1e-6)
    expect(after.max.distanceTo(before.max)).toBeLessThan(1e-6)
    const batches = scene.children.filter(o => o instanceof THREE.Mesh) as THREE.Mesh[]
    expect(batches).toHaveLength(1)
    expect(batches[0].castShadow && batches[0].receiveShadow).toBe(true)
  })

  it('keeps the hinged moving book and instanced floor independent of static batches', () => {
    const scene = new THREE.Scene(), book = new THREE.Group(), lid = new THREE.Group()
    const paper = new THREE.Mesh(new THREE.BoxGeometry(.7, 1, .1), new THREE.MeshStandardMaterial())
    const cover = new THREE.Mesh(new THREE.BoxGeometry(.75, 1.1, .02), paper.material)
    const floor = new THREE.InstancedMesh(new THREE.BoxGeometry(1, .04, 1), paper.material, 2)
    const desk = new THREE.Mesh(new THREE.BoxGeometry(2, .1, 1), paper.material)
    const coverGeometry = cover.geometry
    lid.add(cover); book.add(paper, lid); scene.add(book, floor, desk)
    batchStudy(scene, book)
    expect(cover.parent).toBe(lid); expect(lid.parent).toBe(book); expect(paper.parent).toBe(book)
    expect(cover.geometry).toBe(coverGeometry); expect(floor.parent).toBe(scene)
    lid.rotation.y = -.9; book.position.set(2, 1, -2); scene.updateMatrixWorld(true)
    expect(cover.getWorldPosition(new THREE.Vector3()).toArray()).toEqual([2, 1, -2])
  })

  it('builds convex upholstery and folded surfaces with finite vertices and normals', () => {
    const cushion = cushionGeometry(1.08, .205, .88, .036)
    cushion.computeBoundingBox()
    expect(cushion.boundingBox!.max.y).toBeGreaterThan(.205 / 2 + .02)
    const cloth = surfaceGeometry(18, 22, (u, v) => new THREE.Vector3(u, 3 - v * 3, Math.cos(u * Math.PI * 10) * .045))
    for (const g of [cushion, cloth]) for (const name of ['position', 'normal', 'uv']) {
      expect(Array.from(g.getAttribute(name).array).every(Number.isFinite)).toBe(true)
    }
  })

  it('leaves asynchronous asset slots replaceable instead of baking their fallback into the room', () => {
    const scene = new THREE.Scene(), book = new THREE.Group(), slot = new THREE.Group()
    const material = new THREE.MeshStandardMaterial()
    const fallback = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 1), material)
    const wall = new THREE.Mesh(new THREE.BoxGeometry(8, 4, .1), material)
    slot.position.x = -3; slot.add(fallback); scene.add(slot, wall, book)
    batchStudy(scene, book, [slot])
    expect(fallback.parent).toBe(slot)
    slot.clear()
    const remaining = new THREE.Box3().setFromObject(scene)
    expect(remaining.min.x).toBeCloseTo(-4)
    expect(remaining.max.z).toBeCloseTo(.05)
    expect(scene.children.filter(o => o instanceof THREE.Mesh)).toHaveLength(1)
  })
})
