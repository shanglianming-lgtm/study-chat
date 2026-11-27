import * as THREE from 'three'
import { expect, it } from 'vitest'
import { createPageBrush } from './pageBrush'
import { INK_SPELL } from './inkSpell'
import type { PageSide } from './deskReading'

it.each(['left', 'right'] as const)('keeps the %s cue in the outer margin, parallel and clear of ink, without a downward jab', (side: PageSide) => {
  const paper = new THREE.Matrix4().compose(new THREE.Vector3(2, 1, -3),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(-1.2, .16, .08)), new THREE.Vector3(1, 1, 1))
  const inverse = paper.clone().invert()
  const rig = { worldPoint: (_: PageSide, u: number, v: number, lift: number, out: THREE.Vector3) =>
    out.set(u * .146, -v * .222, lift).applyMatrix4(paper) }
  const tip = new THREE.Vector3(0, 0, -.095), palm = new THREE.Vector3(0, 0, -.03)
  const hand = new THREE.Group()
  hand.scale.setScalar(.76)
  const sample = createPageBrush(tip)
  const pageNormal = new THREE.Vector3(0, 0, 1).transformDirection(paper)
  const tips: THREE.Vector3[] = []
  for (let ms = 20; ms < INK_SPELL.gesture; ms += 20) {
    const opacity = sample(hand, rig, side, .4, ms)
    hand.updateMatrix()
    const onPaper = tip.clone().applyMatrix4(hand.matrix).applyMatrix4(inverse)
    const palmOnPaper = palm.clone().applyMatrix4(hand.matrix).applyMatrix4(inverse)
    const u = onPaper.x / .146
    // Mirror at the outer edge, never between the source and its overlay.
    if (side === 'right') {
      expect(u).toBeGreaterThan(.95)
      expect(palmOnPaper.x).toBeGreaterThan(.146)
    } else {
      expect(u).toBeLessThan(.05)
      expect(palmOnPaper.x).toBeLessThan(0)
    }
    expect(new THREE.Vector3(0, 1, 0).applyQuaternion(hand.quaternion).dot(pageNormal)).toBeGreaterThan(.995)
    expect(onPaper.z).toBeGreaterThanOrEqual(.022 - 1e-10)
    if (tips.length) {
      expect(onPaper.z).toBeGreaterThanOrEqual(tips.at(-1)!.z - 1e-10)
      expect(onPaper.y).toBeGreaterThan(tips.at(-1)!.y)
    }
    expect(opacity).toBeGreaterThanOrEqual(0)
    expect(opacity).toBeLessThanOrEqual(1)
    tips.push(onPaper)
  }
  // The hand is gone while the book finishes gathering its own floating ink.
  expect(sample(hand, rig, side, .4, 0)).toBe(0)
  expect(sample(hand, rig, side, .4, INK_SPELL.gesture)).toBe(0)
  expect(INK_SPELL.gesture).toBeLessThan(INK_SPELL.duration)
})
