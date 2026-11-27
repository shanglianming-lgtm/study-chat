import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { closingAngle, doorClearsPerson, doorSwing } from './studyDoor'
import { createStudyWalk } from './studyWalk'

const openFloor = () => true
describe('walking on the study floor', () => {
  it('accelerates and settles over the same distance at different render rates', () => {
    const simulation = (fps: number) => {
      const eye = new Vector3(), walk = createStudyWalk()
      const first = walk.advance(eye, 0, 1, 0, 1 / fps, openFloor)
      expect(first * fps).toBeLessThan(.12)
      for (let i = 1; i < fps; i++) walk.advance(eye, 0, 1, 0, 1 / fps, openFloor)
      const release = eye.z
      for (let i = 0; i < fps / 2; i++) walk.advance(eye, 0, 0, 0, 1 / fps, openFloor)
      expect(release - eye.z).toBeCloseTo(.1313, 3)
      expect(walk.advance(eye, 0, 0, 0, 1 / fps, openFloor)).toBe(0)
      return eye.z
    }
    expect(simulation(30)).toBeCloseTo(simulation(120), 5)
  })
  it('slides along a blocked axis and never counts steps against a solid object', () => {
    const eye = new Vector3(), walk = createStudyWalk()
    const wall = (_x: number, z: number) => z >= 0
    for (let i = 0; i < 60; i++) walk.advance(eye, 0, 1, 1, 1 / 60, wall)
    expect(eye.x).toBeGreaterThan(.65)
    expect(eye.z).toBe(0)
    walk.stop()
    expect(walk.advance(eye, 0, 1, 0, 1 / 60, wall)).toBe(0)
    expect(walk.advance(eye, 0, -1, 0, .05, openFloor)).toBeLessThan(0)
  })
})
describe('the self-closing door', () => {
  it('clears the arriving player throughout its swing and stops at the jamb', () => {
    expect(closingAngle(0)).toBe(doorSwing)
    let previous = doorSwing
    for (let i = 1; i <= 100; i++) {
      const angle = closingAngle(i / 100)
      expect(angle).toBeLessThan(previous)
      expect(doorClearsPerson(angle, .05, 2.04)).toBe(true)
      previous = angle
    }
    expect(previous).toBe(0)
    expect(closingAngle(3)).toBe(0)
    expect(doorClearsPerson(Math.PI / 4, 0, 2.89)).toBe(false)
    expect(doorClearsPerson(0, .05, 2.89)).toBe(true)
  })
})
