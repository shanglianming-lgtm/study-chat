// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { inkFlight } from './inkFlight'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  delete (Element.prototype as { animate?: unknown }).animate
  delete (Range.prototype as { getBoundingClientRect?: unknown }).getBoundingClientRect
  document.body.replaceChildren()
})

function fixture(text: string, tag = 'p') {
  vi.useFakeTimers()
  const preference = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }
  vi.stubGlobal('matchMedia', () => preference)
  const cancel = vi.fn()
  const animate = vi.fn(() => ({ cancel }))
  Object.defineProperty(Element.prototype, 'animate', { configurable: true, value: animate })
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true, value: () => new DOMRect(20, 30, 10, 18),
  })
  const sheet = document.createElement('div')
  sheet.innerHTML = `<article class="paper"><${tag}></${tag}></article><div class="raised-words"></div>`
  document.body.append(sheet)
  Object.defineProperties(sheet, { clientWidth: { value: 360 }, clientHeight: { value: 550 } })
  vi.spyOn(sheet, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 360, 550))
  vi.spyOn(sheet.querySelector('.paper')!, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 360, 550))
  const source = sheet.querySelector<HTMLElement>('.paper > *')!
  source.style.font = '16px serif'
  source.innerHTML = text
  const panel = sheet.querySelector<HTMLElement>('.raised-words')!
  return { source, panel, sheet, preference, animate, cancel }
}

it('uses bounded inert echoes, leaving original text, graphemes and citation targets intact', () => {
  const { source, panel, sheet, animate, cancel } = fixture('é 👩‍🚀 <span class="ink-citation" data-ref="3">[3]</span>' + ' ink'.repeat(80))
  const original = source.innerHTML, citation = source.querySelector('.ink-citation')
  const stop = inkFlight(source, panel, 'right')
  const echoes = [...sheet.querySelectorAll('.ink-flight > span')]
  expect(echoes).toHaveLength(72)
  expect(echoes.slice(0, 2).map(e => e.textContent)).toEqual(['é', '👩‍🚀'])
  expect(sheet.querySelector<HTMLElement>('.ink-flight')!.inert).toBe(true)
  expect(sheet.querySelector('.ink-flight')!.getAttribute('aria-hidden')).toBe('true')
  expect(source.innerHTML).toBe(original)
  expect(source.querySelector('.ink-citation')).toBe(citation)
  expect(animate).toHaveBeenCalledTimes(72)
  stop()
  expect(sheet.querySelector('.ink-flight')).toBeNull()
  expect(cancel).toHaveBeenCalledTimes(72)
  expect(vi.getTimerCount()).toBe(0)
})

it('cleans up on a live reduced-motion change and skips subsequent decorative returns', () => {
  const { source, panel, sheet, preference, animate, cancel } = fixture('Quiet ink')
  inkFlight(source, panel, 'left')
  const change = preference.addEventListener.mock.calls[0][1] as () => void
  preference.matches = true
  change()
  expect(sheet.querySelector('.ink-flight')).toBeNull()
  expect(cancel).toHaveBeenCalledTimes(8)
  animate.mockClear()
  inkFlight(source, panel, 'left', true)
  expect(animate).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})

it('brushes native excerpt buttons without replacing or disabling their focus target', () => {
  const { source, panel, sheet } = fixture('Memory and profile', 'button')
  source.focus()
  const stop = inkFlight(source, panel, 'left')
  expect(sheet.querySelectorAll('.ink-flight > span')).toHaveLength(16)
  expect(sheet.querySelector('.ink-wake')).not.toBeNull()
  expect(document.activeElement).toBe(source)
  expect(source.inert).not.toBe(true)
  expect(source.textContent).toBe('Memory and profile')
  stop()
})
