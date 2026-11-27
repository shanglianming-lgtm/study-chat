import * as THREE from 'three'
import { expect, it } from 'vitest'
import { createPageBrush } from './pageBrush'
import { INK_SPELL } from './inkSpell'
import type { PageSide } from './deskReading'

it.each([['left', 1], ['right', .76]] as const)('passes a relaxed %s palm laterally without diving a fingertip into the leaf', (side: PageSide, scale) => {
  const paper = new THREE.Matrix4().compose(new THREE.Vector3(2, 1, -3),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(-1.2, .16, .08)), new THREE.Vector3(1, 1, 1))
  const inverse = paper.clone().invert()
  const rig = { worldPoint: (_: PageSide, u: number, v: number, lift: number, out: THREE.Vector3) =>
    out.set(u * .146, -v * .222, lift).applyMatrix4(paper) }
  const palm = new THREE.Vector3(.012, 0, -.032), hand = new THREE.Group()
  hand.scale.setScalar(scale)
  const sample = createPageBrush(palm)
  const pageNormal = new THREE.Vector3(0, 0, 1).transformDirection(paper)
  const samples: THREE.Vector3[] = []
  for (let ms = INK_SPELL.contact; ms <= INK_SPELL.contact + INK_SPELL.brush; ms += 20) {
    sample(hand, rig, side, .5, .4, .5, ms)
    hand.updateMatrix()
    const onPaper = palm.clone().applyMatrix4(hand.matrix).applyMatrix4(inverse)
    // A broad, near-level palm passes over the paper; the smaller downstream
    // character hand uses the same palm anchor and clearance.
    expect(new THREE.Vector3(0, 1, 0).applyQuaternion(hand.quaternion).dot(pageNormal)).toBeGreaterThan(.998)
    expect(onPaper.z).toBeCloseTo(.009, 6)
    if (samples.length) expect(onPaper.x).toBeGreaterThan(samples.at(-1)!.x)
    samples.push(onPaper)
  }
  expect(samples.at(-1)!.x - samples[0].x).toBeCloseTo(.146 * .5, 6)
  expect(Math.max(...samples.map(p => p.y)) - Math.min(...samples.map(p => p.y))).toBeLessThan(.002)
  sample(hand, rig, side, .5, .4, .5, 1150)
  hand.updateMatrix()
  expect(palm.clone().applyMatrix4(hand.matrix).applyMatrix4(inverse).z).toBeGreaterThan(.03)
})

it.each([
  [.30355, .50802], [.43576, .72], [.46622, .69193], [.55985, .72], [.95, .22],
])('keeps the palm over the selected leaf through ink resolution (u=%s)', (u, width) => {
  const palm = new THREE.Vector3(.013, -.002, -.037), hand = new THREE.Group()
  hand.scale.setScalar(.76)
  const rig = { worldPoint: (_: PageSide, x: number, y: number, lift: number, out: THREE.Vector3) => out.set(x, -y, lift) }
  const sample = createPageBrush(palm)
  let previous = 0
  for (let ms = 0; ms < INK_SPELL.duration; ms += 20) {
    sample(hand, rig, 'right', u, .4, width, ms)
    hand.updateMatrix()
    const centre = palm.clone().applyMatrix4(hand.matrix)
    expect(centre.x).toBeGreaterThanOrEqual(.0999)
    expect(centre.x).toBeLessThan(.96)
    expect(centre.x).toBeGreaterThanOrEqual(previous - 1e-10)
    previous = centre.x
  }
})
