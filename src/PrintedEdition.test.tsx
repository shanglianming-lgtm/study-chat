// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import PrintedEdition from './PrintedEdition'
import { initialLibrary } from './library'
import { editVolume } from './shelfStore'

vi.mock('./shelfStore', () => ({ editVolume: vi.fn() }))
vi.mock('./Correspondence', () => ({ default: () => null }))
vi.mock('./paperStock', () => ({ paperStock: () => undefined }))
vi.mock('./flatSheet', () => ({ flatSheet: () => () => {} }))
vi.mock('./book', async importOriginal => ({
  ...await importOriginal<typeof import('./book')>(),
  // jsdom has no text layout; leave the actual navigation and pointer handling intact.
  paginate: () => Array.from({ length: 6 }, (_, i) => ({
    sectionId: 'page-' + i, title: 'Page ' + i, html: '<p>Page ' + i + '</p>', offset: 0,
  })),
}))

let host: HTMLDivElement, root: Root, spread: HTMLDivElement
let now: number, nextFrame: number
let frames: Map<number, FrameRequestCallback>

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  Object.defineProperty(document, 'fonts', { configurable: true, value: {
    ready: Promise.resolve(), addEventListener() {}, removeEventListener() {},
  } })
  now = nextFrame = 0
  frames = new Map()
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback)
    return nextFrame
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 320, 480))
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  const library = initialLibrary()
  await act(async () => root.render(<PrintedEdition deskRig={null} single
    book={library.books[0]} library={library} gest={() => {}} onManage={() => {}} active />))
  spread = host.querySelector('.spread')!
  const held = new Set<number>()
  Object.assign(spread, {
    setPointerCapture: (id: number) => held.add(id),
    hasPointerCapture: (id: number) => held.has(id),
    releasePointerCapture: (id: number) => held.delete(id),
  })
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

function edge(direction = 'forward') {
  return host.querySelector<HTMLButtonElement>('.leaf-edge.' + direction)!
}
async function pointer(target: Element, type: string, x: number, y = 100, pointerType = 'mouse') {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y,
    button: 0, buttons: type === 'pointerdown' || type === 'pointermove' ? 1 : 0 })
  Object.assign(event, { pointerId: 1, pointerType, isPrimary: true })
  await act(async () => { target.dispatchEvent(event) })
}
async function settle() {
  for (let i = 0; frames.size && i < 180; i++) {
    const pending = [...frames.values()]
    frames.clear()
    now += 1000 / 60
    await act(async () => { pending.forEach(callback => callback(now)) })
  }
  expect(frames.size).toBe(0)
}
function page() { return host.querySelector('.paper')?.getAttribute('data-section') }

it.each(['mouse', 'touch'])('turns once for a %s tap with slight drift, in either direction', async pointerType => {
  await pointer(edge(), 'pointerdown', 320, 100, pointerType)
  await pointer(spread, 'pointerup', 316, 102, pointerType)
  // A browser click follows pointerup; it must not trigger a second turn.
  await act(async () => { spread.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })) })
  await settle()
  expect(page()).toBe('page-1')
  expect(editVolume).toHaveBeenCalledTimes(1)
  await pointer(edge('backward'), 'pointerdown', 0, 100, pointerType)
  await pointer(spread, 'pointerup', 0, 100, pointerType)
  await settle()
  expect(page()).toBe('page-0')
  expect(editVolume).toHaveBeenCalledTimes(2)
})

it.each([
  ['a cancelled pointer', [], 'pointercancel', 320, 100],
  ['an incomplete pull', [[280, 100]], 'pointerup', 280, 100],
  ['a pull brought back to its origin', [[20, 100], [320, 100]], 'pointerup', 320, 100],
  ['a vertical drag', [[320, 180]], 'pointerup', 320, 180],
] as const)('does not mistake %s for a tap', async (_, moves, release, x, y) => {
  await pointer(edge(), 'pointerdown', 320)
  for (const [mx, my] of moves) await pointer(spread, 'pointermove', mx, my)
  await pointer(spread, release, x, y)
  await settle()
  expect(page()).toBe('page-0')
  expect(editVolume).not.toHaveBeenCalled()
})

it('still commits a completed pull', async () => {
  await pointer(edge(), 'pointerdown', 320)
  await pointer(spread, 'pointermove', 20)
  await pointer(spread, 'pointerup', 20)
  await settle()
  expect(page()).toBe('page-1')
  expect(editVolume).toHaveBeenCalledTimes(1)
})

it('keeps keyboard button activation working with reduced motion', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  await act(async () => { edge().dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 })) })
  await settle()
  expect(page()).toBe('page-1')
  expect(editVolume).toHaveBeenCalledTimes(1)
})
