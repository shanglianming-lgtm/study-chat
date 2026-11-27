import * as THREE from 'three'
import { expect, it } from 'vitest'
import { handViewport } from './handViewport'

it.each([[-.7, -.3, -2], [.6, .4, -2.5], [0, 0, -1]])('crops transparent area without shifting projected skin (%s,%s,%s)', (x, y, z) => {
  const camera = new THREE.PerspectiveCamera(58, 1280 / 841, .01, 20)
  camera.updateMatrixWorld()
  const box = new THREE.Box3(new THREE.Vector3(-.08, -.05, -.2), new THREE.Vector3(.08, .05, .3))
  const world = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(.2, .4, .5)), new THREE.Vector3(.76, .76, .76))
  const rect = handViewport(box, world, camera, 1280, 841)!
  expect(rect.width * rect.height).toBeLessThan(1280 * 841 / 3)
  const crop = camera.clone()
  crop.setViewOffset(1280, 841, rect.x, rect.y, rect.width, rect.height)
  for (const point of [box.min, box.max, box.getCenter(new THREE.Vector3())]) {
    const full = point.clone().applyMatrix4(world).project(camera)
    const local = point.clone().applyMatrix4(world).project(crop)
    expect((local.x + 1) * rect.width / 2 + rect.x).toBeCloseTo((full.x + 1) * 1280 / 2, 8)
    expect((1 - local.y) * rect.height / 2 + rect.y).toBeCloseTo((1 - full.y) * 841 / 2, 8)
  }
})

it('clips the crop to the window but keeps near-plane intersections conservative', () => {
  const camera = new THREE.PerspectiveCamera(60, 1, .1, 20)
  camera.updateMatrixWorld()
  const box = new THREE.Box3(new THREE.Vector3(-.2, -.2, -.2), new THREE.Vector3(.2, .2, .2))
  expect(handViewport(box, new THREE.Matrix4().makeTranslation(0, 0, -.15), camera, 800, 800)).toEqual({ x: 0, y: 0, width: 800, height: 800 })
  expect(handViewport(box, new THREE.Matrix4().makeTranslation(10, 0, -2), camera, 800, 800)).toBeNull()
  const edge = handViewport(box, new THREE.Matrix4().makeTranslation(1, 0, -2), camera, 800, 800)!
  expect(edge.x + edge.width).toBeLessThanOrEqual(800)
})
