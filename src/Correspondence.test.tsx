// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { initialLibrary } from './library'
import Correspondence from './Correspondence'
import { INK_SPELL } from './inkSpell'

vi.mock('./ManagementBook', () => ({ ModelOptions: () => null }))
vi.mock('./BookFrontMatter', () => ({ PaperField: () => null }))
vi.mock('./shelfStore', () => ({
  attachFiles: vi.fn(), canUndo: () => false, chooseModel: vi.fn(),
  downloadBlob: vi.fn(), editVolume: vi.fn(), eraseTurn: vi.fn(), report: vi.fn(),
  stop: vi.fn(), submit: vi.fn(), undoErase: vi.fn(), writing: () => false,
}))
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

it('retires a focused destructive menu immediately, while preserving its visual exit', async () => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  const library = initialLibrary(), book = library.books[0]
  book.turns = [{
    id: 'saved-turn', q: 'A heading?', a: 'First sentence. Last sentence.',
    state: 'done', model: book.main, effort: 'default', input: [], output: [], notes: [],
  }]
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<Correspondence library={library} book={book}
      gest={() => {}} single={false} side="right" turnPage={() => {}} turning={false}
      folio="1" scrollMark={{}} onManage={() => {}} />))
    const source = host.querySelector<HTMLElement>('.answer-lines [data-ink="actions"]')!
    await act(async () => source.click())
    const panel = host.querySelector<HTMLElement>('[role="dialog"]')!
    const erase = [...panel.querySelectorAll('button')].find(button => button.textContent === '删除')!
    erase.focus()
    expect(document.activeElement).toBe(erase)
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(panel.isConnected).toBe(true) // still visible only for the decorative settle
    expect(panel.inert).toBe(true)
    expect(document.activeElement).toBe(source)
    await act(async () => vi.advanceTimersByTime(INK_SPELL.settle + 100))
    expect(host.querySelector('[role="dialog"]')).toBeNull()
    expect(book.turns[0].id).toBe('saved-turn')
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
