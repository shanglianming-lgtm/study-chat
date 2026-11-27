// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { initialLibrary, type Library } from './library'
import { addBook, chooseBook, editVolume, flushShelf, useShelf } from './shelfStore'

const storage = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }))
vi.mock('./library', async (original) => ({
  ...await original<typeof import('./library')>(),
  loadShelf: storage.load,
  storeShelf: storage.save,
}))

it('binds one new volume, preserves its neighbours and reuses the shelf while a draft changes', async () => {
  const initial = initialLibrary()
  let saved!: Library
  storage.load.mockResolvedValue({ value: initial, revision: 3 })
  storage.save.mockImplementation(async (state: Library, revision: number) => {
    saved = structuredClone(state)
    return revision + 1
  })
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  let shelf!: ReturnType<typeof useShelf>
  function Shelf() {
    shelf = useShelf()
    return null
  }
  const root = createRoot(document.createElement('div'))
  try {
    expect(addBook('before loading')).toBeUndefined()
    await act(async () => root.render(<Shelf />))
    expect(addBook('  ')).toBeUndefined()
    let id!: string
    await act(async () => { id = addBook('  秋夜  ')! })
    expect(shelf.state.selected).toBe(id)
    expect(shelf.catalog).toEqual([
      { id: initial.selected, name: initial.books[0].name },
      { id, name: '秋夜' },
    ])
    const catalog = shelf.catalog
    await act(async () => editVolume(id, { draft: '月色' }))
    expect(shelf.catalog).toBe(catalog)
    await flushShelf()
    expect(saved.selected).toBe(id)
    expect(saved.books[1]).toMatchObject({ id, name: '秋夜', draft: '月色', effort: 'default', turns: [] })
    expect(saved.books[0]).toEqual(initial.books[0])
    await act(async () => chooseBook(initial.selected))
    expect(shelf.catalog).toBe(catalog)
    expect(shelf.state.selected).toBe(initial.selected)
    await flushShelf()
  } finally {
    await act(async () => root.unmount())
    vi.unstubAllGlobals()
  }
})
