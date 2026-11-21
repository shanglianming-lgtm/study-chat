import { describe, expect, it } from 'vitest'
import { Matrix4 } from 'three'
import { LEAF_SEGMENTS, leafOutline, leafPose } from './leafGeometry'

const identity = () => new Matrix4().elements
const bends = (angle = 0) => Array.from({ length: LEAF_SEGMENTS }, (_, i) =>
  new Matrix4().makeRotationY(i ? angle : 0).elements)

describe('continuous turning-sheet silhouette', () => {
  it('keeps the animated paper and outline mirrored across both directions at every phase', () => {
    for (const progress of [0, .1, .3, .48, .7, .9, 1]) {
      const forward = leafPose(progress, true), backward = leafPose(progress, false)
      expect(forward.bends).toHaveLength(LEAF_SEGMENTS)
      const front = leafOutline(420, 500, 840, true, forward.root, forward.bends)
      const back = leafOutline(420, 500, 840, false, backward.root, backward.bends)
      front.forEach((point, i) => {
        expect(point.x + back[i].x).toBeCloseTo(840, 8)
        expect(point.y).toBeCloseTo(back[i].y, 8)
      })
    }
  })

  it('retains the flat endpoint and peak bend poses without depending on earlier clock samples', () => {
    for (const forward of [true, false]) {
      const start = leafPose(0, forward), end = leafPose(1, forward)
      expect(start.bends.every(bend => bend.every((value, i) => value === identity()[i]))).toBe(true)
      expect(end.bends).toEqual(start.bends)
      expect(start.root[14]).toBe(1)
      expect(end.root[0]).toBeCloseTo(-1, 8)
      const peak = leafPose(.48, forward)
      expect(Math.atan2(peak.bends.at(-1)![8], peak.bends.at(-1)![0]) * 180 / Math.PI)
        .toBeCloseTo((forward ? 1 : -1) * 108 / 17, 8)
      leafPose(.9, forward)
      expect(leafPose(.48, forward)).toEqual(peak)
    }
  })

  it('starts on the correct half of a spread without interior vertical edge steps', () => {
    for (const forward of [true, false]) {
      const points = leafOutline(420, 500, 840, forward, identity(), bends())
      expect(points).toHaveLength(2 * (LEAF_SEGMENTS + 1))
      const top = points.slice(0, LEAF_SEGMENTS + 1), bottom = points.slice(LEAF_SEGMENTS + 1)
      expect(top.every(p => p.y === 0)).toBe(true)
      expect(bottom.every(p => p.y === 500)).toBe(true)
      expect(Math.min(...points.map(p => p.x))).toBe(forward ? 420 : 0)
      expect(Math.max(...points.map(p => p.x))).toBe(forward ? 840 : 420)
    }
  })

  it('mirrors the complete curled contour for backward turns, including perspective', () => {
    const front = leafOutline(420, 500, 840, true, new Matrix4().makeRotationY(-1.7).elements, bends(.07))
    const back = leafOutline(420, 500, 840, false, new Matrix4().makeRotationY(1.7).elements, bends(-.07))
    front.forEach((point, index) => {
      expect(point.x + back[index].x).toBeCloseTo(840, 8)
      expect(point.y).toBeCloseTo(back[index].y, 8)
    })
  })

  it('finishes on the opposite half with finite edges throughout a turn', () => {
    for (const angle of [0, -.4, -1.5, -1.9, -Math.PI]) {
      const points = leafOutline(420, 500, 840, true, new Matrix4().makeRotationY(angle).elements, bends(angle === -Math.PI ? 0 : .05))
      expect(points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true)
      if (angle === -Math.PI) {
        expect(Math.min(...points.map(p => p.x))).toBeCloseTo(0, 8)
        expect(Math.max(...points.map(p => p.x))).toBeCloseTo(420, 8)
      }
    }
  })
})
