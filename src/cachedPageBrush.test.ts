import * as THREE from 'three'
import { expect, it } from 'vitest'
import { palmAffine } from './cachedPageBrush'

it('keeps the palm exactly anchored while approximating perspective around it', () => {
  const m = new THREE.Matrix4().set(1.2, .1, 0, 300, .2, 1.5, 0, 200, 0, 0, 1, 0, .0002, .0001, 0, 1)
  const [x, y] = [120, 200], [a, b, c, d, tx, ty] = palmAffine(m, x, y)
  const project = (u: number, v: number) => new THREE.Vector3(u, v, 0).applyMatrix4(m)
  expect(a * x + c * y + tx).toBeCloseTo(project(x, y).x, 9)
  expect(b * x + d * y + ty).toBeCloseTo(project(x, y).y, 9)
  for (const [u, v] of [[x + 10, y], [x, y + 10]]) {
    expect(Math.abs(a * u + c * v + tx - project(u, v).x)).toBeLessThan(.05)
    expect(Math.abs(b * u + d * v + ty - project(u, v).y)).toBeLessThan(.05)
  }
})
