import { Matrix4, Vector3 } from 'three'

export const LEAF_SEGMENTS = 12
export const LEAF_PERSPECTIVE = 1800

type Point = { x: number; y: number }

/** Project the nominal, joined sheet edges, not each face's antialias bleed. */
export function leafOutline(width: number, height: number, hostWidth: number, forward: boolean,
  root: ArrayLike<number>, bends: ArrayLike<number>[], segmentWidth = width / bends.length) {
  const top: Point[] = [], bottom: Point[] = []
  const place = (x: number, originX: number, transform: ArrayLike<number>) => new Matrix4()
    .makeTranslation(x + originX, height / 2, 0)
    .multiply(new Matrix4().fromArray(transform))
    .multiply(new Matrix4().makeTranslation(-originX, -height / 2, 0))
  const matrix = place(forward ? hostWidth - width : 0, forward ? 0 : width, root)
  const project = (x: number, y: number) => {
    const point = new Vector3(x, y, 0).applyMatrix4(matrix)
    const scale = LEAF_PERSPECTIVE / (LEAF_PERSPECTIVE - point.z)
    return { x: hostWidth / 2 + (point.x - hostWidth / 2) * scale,
      y: height / 2 + (point.y - height / 2) * scale }
  }
  bends.forEach((bend, index) => {
    const left = index ? (forward ? segmentWidth : -segmentWidth) : (forward ? 0 : width - segmentWidth)
    matrix.multiply(place(left, forward ? 0 : segmentWidth, bend))
    if (!index) {
      top.push(project(forward ? 0 : segmentWidth, 0))
      bottom.push(project(forward ? 0 : segmentWidth, height))
    }
    top.push(project(forward ? segmentWidth : 0, 0))
    bottom.push(project(forward ? segmentWidth : 0, height))
  })
  return [...top, ...bottom.reverse()]
}
