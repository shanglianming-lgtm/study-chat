// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { maintainReadingPosition } from './readingPosition'

afterEach(() => vi.unstubAllGlobals())

it('keeps following across delayed scroll events and respects scrolling back into the chapter', () => {
  let resize!: () => void
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback }
    observe() {}
    disconnect() {}
  })
  const pane = document.createElement('div')
  const text = pane.appendChild(document.createElement('div'))
  const turn = text.appendChild(document.createElement('section'))
  let height = 410
  let turnStart = 0
  Object.defineProperties(pane, {
    scrollHeight: { get: () => height },
    clientHeight: { value: 180 },
  })
  Object.defineProperties(turn, {
    offsetTop: { get: () => turnStart },
    offsetHeight: { value: 510 },
  })
  const stop = maintainReadingPosition(pane, text)
  expect(pane.scrollTop).toBe(230)
  height += 32
  pane.dispatchEvent(new Event('scroll'))
  resize()
  expect(pane.scrollTop).toBe(262)

  pane.scrollTop = 65
  height += 90
  resize() // A wheel gesture may precede the next scroll event.
  expect(pane.scrollTop).toBe(65)
  turnStart += 18
  resize()
  expect(pane.scrollTop).toBe(83)

  pane.scrollTop = height - pane.clientHeight
  pane.dispatchEvent(new Event('scroll'))
  height += 22
  resize()
  expect(pane.scrollTop).toBe(height - pane.clientHeight)
  stop()
})
