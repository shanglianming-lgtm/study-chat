import { Matrix4, Vector3 } from 'three'

export const LEAF_SEGMENTS = 12
export const LEAF_PERSPECTIVE = 1800

type Point = { x: number; y: number }

/** One eased timeline sample drives both the paper and its projected outline. */
export function leafPose(progress: number, forward: boolean, grip = 0.5) {
  const p = Math.max(0, Math.min(1, progress))
  const fold = p <= .48 ? p / .48 : (1 - p) / .52
  const angle = forward ? -Math.PI : Math.PI
  const rotation = p <= .48 ? angle * .46 * fold : angle * (1 - .54 * fold)
  const root = new Matrix4().makeRotationY(rotation)
    .multiply(new Matrix4().makeTranslation(0, 0, 1 + 15 * fold))
    .multiply(new Matrix4().makeRotationZ((forward ? -1 : 1) * (Math.PI / 120 + (grip - .5) * .085) * fold))
  const bends = Array.from({ length: LEAF_SEGMENTS }, (_, i) => new Matrix4()
    .makeRotationY(i ? (forward ? 1 : -1) * Math.PI * .3 *
      (1 + i / (LEAF_SEGMENTS - 1)) / (LEAF_SEGMENTS * 1.5 - 1) * fold : 0).elements)
  return { root: root.elements, bends }
}

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

// Map the four corners of a material strip exactly, including the difference in pull at head and foot.
export function stripProjection([a,b,c,d]: Point[], width: number, height: number) {
  const dx = a.x - b.x + c.x - d.x, dy = a.y - b.y + c.y - d.y
  const det = (b.x-c.x)*(d.y-c.y) - (d.x-c.x)*(b.y-c.y)
  const g = Math.abs(det) > 1e-8 ? (dx*(d.y-c.y) - dy*(d.x-c.x)) / det : 0
  const h = Math.abs(det) > 1e-8 ? (dy*(b.x-c.x) - dx*(b.y-c.y)) / det : 0
  const matrix = new Matrix4().set(
    (b.x*(1+g)-a.x)/width, (d.x*(1+h)-a.x)/height, 0, a.x,
    (b.y*(1+g)-a.y)/width, (d.y*(1+h)-a.y)/height, 0, a.y,
    0, 0, 1, 0, g/width, h/height, 0, 1)
  return 'matrix3d(' + matrix.elements.join(',') + ')'
}
