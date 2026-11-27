// @vitest-environment jsdom
import * as THREE from 'three'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { bookInk } from './spatialInk'
import type { DeskReading } from './deskReading'

const cleanups: (() => void)[] = []
beforeEach(() => {
  vi.stubGlobal('Highlight', class extends Set<Range> { priority = 0; constructor(...ranges: Range[]) { super(ranges) } })
  vi.stubGlobal('CSS', { highlights: new Map() })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    setTransform() {}, clearRect() {}, save() {}, restore() {}, translate() {}, scale() {}, fillText() {},
    measureText: () => ({ fontBoundingBoxAscent: 14 }), beginPath() {}, arc() {}, fill() {},
  } as never)
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true,
    value(this: Range) { return new DOMRect(40 + this.startOffset * 10, 40, 10, 20) } })
})
afterEach(() => {
  cleanups.splice(0).forEach(dispose => dispose())
  bookInk.stop()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete (Range.prototype as { getBoundingClientRect?: unknown }).getBoundingClientRect
  document.body.replaceChildren()
})
function fixture() {
  document.body.innerHTML = '<article class="paper"><div id="source" style="font:16px serif">ab<span class="ink-citation" data-ref="1">[1]</span></div></article>'
  const paper = document.querySelector<HTMLElement>('.paper')!, host = document.querySelector<HTMLElement>('#source')!
  Object.defineProperties(paper, { offsetWidth: { value: 400 }, offsetHeight: { value: 600 } })
  vi.spyOn(paper, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 400, 600))
  const citation = host.querySelector('.ink-citation'), html = host.innerHTML
  cleanups.push(bookInk.register(host, 'right', { animate: true }))
  const rig = { pagePoint: (_side: string, world: THREE.Vector3, out: THREE.Vector3) => out.copy(world) } as DeskReading
  return { host, citation, html, rig }
}
it('keeps original markup and citation identity while untriggered glyph ranges are hidden separately', () => {
  const { host, citation, html } = fixture()
  expect(bookInk.inspect()[0].glyphs.map(g => g.activatedAt)).toEqual([null, null])
  expect(host.innerHTML).toBe(html)
  expect(host.querySelector('.ink-citation')).toBe(citation)
  const pending = CSS.highlights.get('book-ink-pending')!
  expect(pending.size).toBe(2)
  for (const range of pending) expect((range.startContainer as Text).parentElement!.closest('.ink-citation')).toBeNull()
})
it('uses actual world bone positions rather than the requested sweep position to trigger ink', () => {
  const { rig } = fixture()
  const far = new THREE.Vector3(.95, .95, .02), now = performance.now()
  const pose = () => ({ tip: far, palm: far })
  bookInk.frame(now, rig, pose)
  bookInk.frame(now + 200, rig, pose)
  expect(bookInk.inspect()[0].glyphs.every(g => g.activatedAt === null)).toBe(true)
})
it('keeps activated prefix timestamps when real streamed DOM text appends, with new glyphs pending', async () => {
  const { host, rig } = fixture(), now = performance.now()
  const pose = (_side: string, u: number, v: number) => ({ tip: new THREE.Vector3(u, v, .02), palm: new THREE.Vector3(u, v, .03) })
  bookInk.frame(now, rig, pose)
  bookInk.frame(now + 200, rig, pose)
  const time = bookInk.inspect()[0].glyphs[0].activatedAt
  const prefix = bookInk.inspect()[0].glyphs.map(g => g.activatedAt)
  expect(time).not.toBeNull()
  host.append(document.createTextNode('新'))
  await Promise.resolve()
  expect(bookInk.inspect()[0].glyphs.map(g => g.activatedAt)).toEqual([...prefix, null])
})
it('settles immediately without a hand or embers for reduced motion', () => {
  const { rig } = fixture()
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  const pose = vi.fn()
  expect(bookInk.frame(performance.now(), rig, pose)).toBeNull()
  expect(pose).not.toHaveBeenCalled()
  expect(bookInk.inspect()[0].glyphs.every(g => g.phase === 3)).toBe(true)
})
