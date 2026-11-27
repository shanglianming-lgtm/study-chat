import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { bookPose, createBookFollower, createShelfFlight, shelfFlightTiming } from './bookFlight'
import { createBookMagic } from './bookMagic'

const right = new Vector3(1, 0, 0), outward = new Vector3(0, 0, 1)

describe('the enchanted folio', () => {
  it('lets the front board settle and the last dust drift away when the hand stops', () => {
    const follow = createBookFollower(), hand = bookPose(), pose = bookPose()
    const magic = createBookMagic()
    follow.reset(hand)
    for (let i = 0; i < 30; i++) {
      hand.center.x += 0.032
      follow.update(hand, right, 1 / 60, false, pose)
      magic.update(pose, 1 / 60, true, false, 700)
    }
    expect(follow.boardLift).toBeGreaterThan(0)
    expect(magic.drifting).toBe(true)
    for (let i = 0; i < 180; i++) {
      follow.update(hand, right, 1 / 60, false, pose)
      magic.update(pose, 1 / 60, true, false, 700)
    }
    expect(follow.boardLift).toBe(0)
    expect(follow.moving).toBe(false)
    expect(magic.dust.visible).toBe(false)
    magic.dispose()
  })
  it('waits for the gesture, clears the slot spine-first, then banks and brakes over the palm', () => {
    const dock = bookPose(), hand = bookPose(), pose = bookPose(), fly = createShelfFlight()
    hand.center.set(0.65, -0.1, 3.2)
    hand.rotation.setFromAxisAngle(right, 1)
    const sample = (phase: number) => fly(dock, hand, outward, right, shelfFlightTiming(phase), pose)
    sample(0.08)
    expect(shelfFlightTiming(0.08).reach).toBeGreaterThan(0)
    expect(pose.center.length()).toBe(0)
    sample(0.26)
    expect(pose.center.z).toBeGreaterThan(0.14)
    expect(pose.center.x).toBe(0)
    expect(pose.rotation.angleTo(dock.rotation)).toBe(0)
    const distances: number[] = []
    for (let i = 0; i <= 10; i++) {
      sample(i / 10)
      distances.push(pose.center.z)
    }
    expect(distances[6] - distances[5]).toBeGreaterThan(3 * (distances[10] - distances[9]))
    expect(pose.center.distanceTo(hand.center)).toBeLessThan(1e-8)
    expect(pose.rotation.angleTo(hand.rotation)).toBeLessThan(1e-6)
    sample(0)
    expect(pose.center.distanceTo(dock.center)).toBe(0)
  })

  it('accelerates after the hand, brakes on approach and settles at the same point at different frame rates', () => {
    for (const fps of [24, 60, 120]) {
      const follow = createBookFollower(), hand = bookPose(), pose = bookPose()
      follow.reset(hand)
      hand.center.x = 0.065
      const speeds: number[] = []
      let previous = 0
      for (let i = 0; i < fps; i++) {
        follow.update(hand, right, 1 / fps, false, pose)
        speeds.push((pose.center.x - previous) * fps)
        previous = pose.center.x
        expect(previous).toBeLessThanOrEqual(hand.center.x)
      }
      expect(speeds[0]).toBeLessThan(speeds[Math.round(fps * 0.08)])
      expect(speeds[Math.round(fps * 0.42)]).toBeLessThan(speeds[Math.round(fps * 0.15)])
      expect(pose.center.distanceTo(hand.center)).toBeLessThan(0.00002)
    }
  })

  it('keeps sharp turns in reach and clears residual velocity on a handoff or reduced-motion switch', () => {
    const follow = createBookFollower(), hand = bookPose(), pose = bookPose()
    follow.reset(hand)
    hand.center.set(-0.7, 0, -0.5)
    hand.rotation.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI)
    follow.update(hand, right, 1 / 30, false, pose)
    expect(pose.center.distanceTo(hand.center)).toBeLessThanOrEqual(0.151)
    expect(pose.center.distanceTo(hand.center)).toBeGreaterThan(0.06)
    follow.update(hand, right, 1 / 30, true, pose)
    expect(pose.center.distanceTo(hand.center)).toBe(0)
    expect(pose.rotation.angleTo(hand.rotation)).toBeLessThan(1e-6)
    hand.center.set(2, 1, 3)
    follow.reset(hand)
    follow.update(hand, right, 1 / 60, false, pose)
    expect(pose.center.distanceTo(hand.center)).toBe(0)
  })
})
