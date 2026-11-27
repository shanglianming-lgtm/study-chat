import { LEAF_SEGMENTS, leafOutline, leafPose, stripProjection } from './leafGeometry'

export type TurnFaces = { direction: number; front: HTMLElement; under?: HTMLElement }

export function flatSheet(host: HTMLElement, pending: TurnFaces, back: HTMLElement, single: boolean, grip: number) {
  const forward = pending.direction > 0
  const width = parseFloat(pending.front.style.width), height = parseFloat(pending.front.style.height)
  const hostWidth = host.clientWidth, slice = width / LEAF_SEGMENTS
  if (pending.under) {
    Object.assign(pending.under.style, { position: 'absolute', top: '0', left: forward ? '0' : (hostWidth - width) + 'px' })
    host.append(pending.under)
  }
  const shadow = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  shadow.classList.add('leaf-silhouette')
  const outline = document.createElementNS(shadow.namespaceURI!, 'path')
  shadow.append(outline)
  host.append(shadow)
  const strips = Array.from({ length: LEAF_SEGMENTS }, (_, i) => {
    const strip = document.createElement('div')
    strip.className = 'flat-turn-strip'
    strip.style.width = (slice + .45) + 'px'
    strip.style.height = height + 'px'
    const column = forward ? i : LEAF_SEGMENTS - 1 - i
    for (const [face, paper] of [['front', pending.front], ['back', back]] as const) {
      const holder = document.createElement('div')
      holder.className = 'sheet-' + face
      const ink = paper.cloneNode(true) as HTMLElement
      ink.style.position = 'absolute'
      ink.style.left = -(face === 'front' ? column : LEAF_SEGMENTS - 1 - column) * slice + 'px'
      ink.style.top = '0'
      holder.append(ink)
      strip.append(holder)
    }
    host.append(strip)
    return strip
  })
  return (progress: number) => {
    const { root, bends } = leafPose(progress, forward, grip)
    const points = leafOutline(width, height, single ? width : hostWidth, forward, root, bends, slice)
    outline.setAttribute('d', points.map((p,i) => (i ? 'L' : 'M') + p.x + ' ' + p.y).join('') + 'Z')
    strips.forEach((strip, i) => {
      const last = points.length - 1
      const a = points[i], b = points[i+1], c = points[last-i-1], d = points[last-i]
      const quad = forward ? [a,b,c,d] : [b,a,d,c]
      const [tl,tr,,bl] = quad
      strip.style.transform = stripProjection(quad, slice, height)
      strip.dataset.face = (tr.x-tl.x)*(bl.y-tl.y) > (tr.y-tl.y)*(bl.x-tl.x) ? 'front' : 'back'
      strip.style.setProperty('--roll-shade', String(Math.sin(Math.PI * progress) * (.065 + .12 * i / strips.length)))
    })
  }
}
