import { describe, expect, it } from 'vitest'
import { createCursorGaze } from './cursorGaze'
import { sampleRegisterFlight } from './registerFlight'
import * as THREE from 'three'

describe('free look and the bookcase', () => {
  it('settles into a small glance within the room and leaves the central aiming area steady', () => {
    const gaze = createCursorGaze()
    gaze.aim(0.08, -0.05)
    const center = gaze.update(1 / 60)
    expect(center.glanceChanged).toBe(false)
    expect(Math.abs(center.turn) + Math.abs(center.tilt)).toBe(0)
    gaze.aim(0.55, 0.55)
    gaze.update(1 / 60)
    const first = gaze.yaw
    expect(first).toBeLessThan(0)
    expect(Math.abs(first)).toBeLessThan(0.005)
    for (let i = 0; i < 120; i++) gaze.update(1 / 60)
    expect(gaze.yaw).toBeCloseTo(-Math.PI / 40, 5)
    expect(gaze.pitch).toBeCloseTo(Math.PI / 72, 5)
    const resting = gaze.update(1 / 60)
    expect(Math.abs(resting.turn) + Math.abs(resting.tilt)).toBe(0)
    gaze.aim(0, 0)
    for (let i = 0; i < 120; i++) gaze.update(1 / 60)
    expect(gaze.update(1 / 60).glanceChanged).toBe(false)
    expect(gaze.yaw).toBeCloseTo(0, 8)
  })
  it.each([-1, 1])('keeps turning past a full circle with a stationary pointer at edge %i', side => {
    function pan(fps: number) {
      const gaze = createCursorGaze()
      let heading = 0
      gaze.aim(side, 0)
      for (let i = 0; i < 8 * fps; i++) heading += gaze.update(1 / fps).turn
      expect(heading * -side).toBeGreaterThan(2 * Math.PI)
      const atFullSpeed = THREE.MathUtils.radToDeg(gaze.update(1 / fps).turn * fps)
      expect(atFullSpeed).toBeCloseTo(-side * 54)
      gaze.aim(0, 0)
      for (let i = 0; i < 2 * fps; i++) heading += gaze.update(1 / fps).turn
      expect(Math.abs(gaze.update(1 / fps).turn)).toBe(0)
      expect(heading * -side).toBeGreaterThan(2 * Math.PI)
      return heading
    }
    expect(pan(30)).toBeCloseTo(pan(60), 3)
  })
  it('lets the top and bottom edges tilt independently and clears momentum on interruption', () => {
    for (const direction of [-1, 1]) {
      const gaze = createCursorGaze()
      gaze.aim(0, direction)
      let pitch = 0
      for (let i = 0; i < 240; i++) {
        const step = gaze.update(1 / 60)
        expect(Math.abs(step.turn)).toBe(0)
        pitch += step.tilt
      }
      expect(pitch * direction).toBeGreaterThan(Math.PI / 2)
      expect(THREE.MathUtils.radToDeg(gaze.update(1 / 60).tilt * 60)).toBeCloseTo(direction * 32)
      gaze.reset()
      const stopped = gaze.update(1 / 60)
      expect(Math.abs(stopped.tilt) + Math.abs(stopped.turn)).toBe(0)
      expect(stopped.glanceChanged).toBe(false)
    }
  })
  it('moves the reader straight out before turning and returns to exactly the same dock', () => {
    const reader = new THREE.Object3D()
    const dock = new THREE.Vector3(-1, 1.9, -2.97), desk = new THREE.Vector3(2.3, 1, -2.6)
    const start = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),.12)
    const flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),-Math.PI/2)
    for (const phase of [.05,.17,.36]) {
      sampleRegisterFlight(reader,dock,start,desk,flat,phase)
      expect(reader.position.x).toBe(dock.x)
      expect(reader.quaternion.angleTo(start)).toBeLessThan(1e-6)
    }
    expect(reader.position.z - dock.z).toBeGreaterThan(.40)
    sampleRegisterFlight(reader,dock,start,desk,flat,1)
    expect(reader.position.distanceTo(desk)).toBeLessThan(1e-8)
    sampleRegisterFlight(reader,dock,start,desk,flat,0)
    expect(reader.position.equals(dock)).toBe(true)
  })
})
