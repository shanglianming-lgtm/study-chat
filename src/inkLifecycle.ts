export type InkGlyph = {
  text: string
  x: number
  y: number
  activatedAt: number | null
}
export type InkPoint = { x: number; y: number }
const clamp = (n: number) => Math.max(0, Math.min(1, n))
export function smoothstep(a: number, b: number, value: number) {
  const p = clamp((value - a) / (b - a))
  return p * p * (3 - 2 * p)
}
export function inkLife(activatedAt: number | null, now: number) {
  if (activatedAt === null) return { phase: 0, alpha: 0, y: 6, scale: 1.2, color: '#FFF8DC', glow: 0 }
  const t = Math.max(0, (now - activatedAt) / 1000)
  if (t < .35) {
    const p = smoothstep(0, .35, t)
    return { phase: 1, alpha: p, y: 6 * (1 - p), scale: 1.2 - .2 * p,
      color: '#FFF8DC', glow: Math.sin(p * Math.PI) }
  }
  if (t < 1.2) {
    const p = smoothstep(.35, 1.2, t)
    const from = [255, 215, 0], to = [42, 27, 18]
    const color = '#' + from.map((v, i) => Math.round(v + (to[i] - v) * p).toString(16).padStart(2, '0')).join('')
    return { phase: 2, alpha: 1, y: 0, scale: 1, color, glow: (1 - p) ** 2 }
  }
  return { phase: 3, alpha: 1, y: 0, scale: 1, color: '#2A1B12', glow: 0 }
}

/** A swept distance field prevents a late animation frame from skipping ink.
 * Every glyph records its own first encounter, never a global reveal delay. */
export function wakeInk<T extends InkGlyph>(glyphs: T[], previous: InkPoint, hand: InkPoint, radius: number, now: number) {
  const dx = hand.x - previous.x, dy = hand.y - previous.y, length = dx * dx + dy * dy
  let changed = false
  for (const glyph of glyphs) {
    if (glyph.activatedAt !== null) continue
    const f = length ? clamp(((glyph.x - previous.x) * dx + (glyph.y - previous.y) * dy) / length) : 0
    if (Math.hypot(glyph.x - previous.x - f * dx, glyph.y - previous.y - f * dy) < radius) {
      glyph.activatedAt = now
      changed = true
    }
  }
  return changed
}

/** Preserve the unchanged prefix across actual streamed DOM replacements. */
export function carryInk<T extends InkGlyph>(previous: T[], next: T[]) {
  for (let i = 0; i < Math.min(previous.length, next.length); i++) {
    if (previous[i].text !== next[i].text) break
    next[i].activatedAt = previous[i].activatedAt
  }
  return next
}
