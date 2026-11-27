import { expect, it } from 'vitest'
import { carryInk, inkLife, wakeInk, type InkGlyph } from './inkLifecycle'

const glyph = (text: string, x: number, y = 0): InkGlyph => ({ text, x, y, activatedAt: null })
it('uses the specified white-gold, cooling and fully dry mathematical stages', () => {
  expect(inkLife(null, 9000).alpha).toBe(0)
  expect(inkLife(1000, 1000)).toMatchObject({ phase: 1, alpha: 0, y: 6, scale: 1.2 })
  expect(inkLife(1000, 1175)).toMatchObject({ alpha: .5, y: 3, color: '#FFF8DC', glow: 1 })
  expect(inkLife(1000, 1175).scale).toBeCloseTo(1.1)
  expect(inkLife(1000, 1350)).toMatchObject({ phase: 2, color: '#ffd700', glow: 1 })
  expect(['#947909', '#957909']).toContain(inkLife(1000, 1775).color)
  expect(inkLife(1000, 1775).glow).toBeCloseTo(.25)
  expect(inkLife(1000, 2200)).toMatchObject({ phase: 3, color: '#2A1B12', glow: 0, alpha: 1 })
})
it('only wakes swept nearby glyphs, once, including a missed frame and a same-column different row', () => {
  const ink = [glyph('a', 0), glyph('b', 10), glyph('c', 20), glyph('d', 10, 30)]
  wakeInk(ink, { x: -2, y: 0 }, { x: 0, y: 0 }, 2, 100)
  expect(ink.map(g => g.activatedAt)).toEqual([100, null, null, null])
  wakeInk(ink, { x: 0, y: 0 }, { x: 22, y: 0 }, 2, 250)
  expect(ink.map(g => g.activatedAt)).toEqual([100, 250, 250, null])
})
it('keeps streamed prefix timestamps but never pre-activates appended or replaced graphemes', () => {
  const previous = [glyph('é', 0), glyph('👩‍🚀', 10)]
  previous[0].activatedAt = 10
  const next = carryInk(previous, [glyph('é', 0), glyph('👩‍🚀', 12), glyph('新', 24)])
  expect(next.map(g => g.activatedAt)).toEqual([10, null, null])
  expect(carryInk(previous, [glyph('x', 0)])[0].activatedAt).toBeNull()
})
