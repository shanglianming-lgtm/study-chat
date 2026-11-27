import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { initialLibrary, refFor, type LeafFile, type Source, type Turn } from './library'
import type { WireMessage } from './provider'

const { loadShelf, storeShelf, libraryFile } = vi.hoisted(() => ({
  loadShelf: vi.fn<() => Promise<{ value: ReturnType<typeof initialLibrary>; revision: number }>>(),
  storeShelf: vi.fn<(value: ReturnType<typeof initialLibrary>, revision: number) => Promise<number>>(),
  libraryFile: vi.fn<(id: string) => Promise<Blob | undefined>>(),
}))
vi.mock('./library', async (original) => ({
  ...await original<typeof import('./library')>(),
  loadShelf,
  storeShelf,
  libraryFile,
}))
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useSyncExternalStore: (subscribe: (notify: () => void) => () => void, snapshot: () => unknown) => {
    const unsubscribe = subscribe(() => {})
    unsubscribe()
    return snapshot()
  },
}))

const provider: Source = { id: 'test', name: 'Test', url: 'https://example.test/v1', models: ['sample'], useKey: false }
const attachment: LeafFile = { id: 'file-1', n: 1, name: 'note.txt', mime: 'text/plain', size: 3 }
const answer: Turn = {
  id: 'turn-1', q: 'First question', a: 'Previous answer', state: 'done',
  model: 'test:sample', effort: 'default', input: [], output: [attachment], notes: [],
}
const completion = (text: string) => Response.json({ choices: [{ message: { content: text }, finish_reason: 'stop' }] })

async function setup(draft: string, turns: Turn[] = [], pending: LeafFile[] = []) {
  const value = initialLibrary()
  value.providers.push(provider)
  const book = value.books[0], main = refFor(provider.id, provider.models[0])
  Object.assign(book, { draft, turns, pending, main, hasTitle: true, serial: 2 })
  book.allowed.push(main)
  loadShelf.mockResolvedValue({ value, revision: 0 })
  const shelf = await import('./shelfStore')
  shelf.useShelf()
  await vi.waitFor(() => expect(shelf.useShelf().ready).toBe(true))
  return { shelf, id: book.id }
}

beforeEach(() => {
  vi.resetModules()
  vi.resetAllMocks()
  storeShelf.mockImplementation(async (_, revision) => revision + 1)
})
afterEach(() => vi.unstubAllGlobals())

it('checkpoints the previous answer and files until a retry completes', async () => {
  const { shelf, id } = await setup('', [answer])
  let stream!: ReadableStreamDefaultController<Uint8Array>
  let read!: () => void
  const reading = new Promise<void>((resolve) => { read = resolve })
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      stream = controller
      controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Replacement"}}]}\n\n'))
    },
    pull() { read() },
  }, { highWaterMark: 0 })
  vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } })))
  const pending = shelf.submit(id, answer.id)
  await reading
  shelf.editVolume(id, { draft: 'Next question' })
  await shelf.flushShelf()
  const checkpoint = storeShelf.mock.lastCall?.[0].books[0].turns[0]
  stream.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
  stream.close()
  await pending
  expect(checkpoint).toEqual(answer)
  expect(shelf.volume(id).turns[0]).toMatchObject({ a: 'Replacement', state: 'done', output: [] })
})

it('keeps composer edits made while preparing an attachment', async () => {
  const { shelf, id } = await setup('Sent question', [], [attachment])
  let finishFile!: (file: Blob) => void
  libraryFile.mockImplementation(() => new Promise<Blob>((resolve) => { finishFile = resolve }))
  vi.stubGlobal('fetch', vi.fn(async () => completion('OK')))
  const pending = shelf.submit(id)
  expect(libraryFile).toHaveBeenCalledWith(attachment.id)
  shelf.editVolume(id, { draft: 'Unsent follow-up', pending: [attachment, { ...attachment, id: 'file-2', n: 2 }] })
  finishFile(new Blob(['abc']))
  await pending
  expect(shelf.volume(id)).toMatchObject({
    draft: 'Unsent follow-up',
    pending: [{ id: 'file-2' }],
    turns: [{ q: 'Sent question', a: 'OK', input: [attachment] }],
  })
})

it('sends a follow-up without retransmitting restricted previous answers', async () => {
  const privateAnswer = 'There are several ideas here.'
  const { shelf, id } = await setup('What about earlier?', [
    { ...answer, a: privateAnswer }, { ...answer, id: 'turn-2', a: 'Shareable answer' },
  ])
  const send = vi.fn(async (_url: string, _init: RequestInit) => completion('OK'))
  vi.stubGlobal('fetch', send)
  await shelf.submit(id)
  expect(send).toHaveBeenCalledTimes(1)
  const wire = String(send.mock.lastCall?.[1].body)
  const { messages }: { messages: WireMessage[] } = JSON.parse(wire)
  expect(messages[0].content).toContain('Shareable answer')
  expect(messages.filter(({ role }) => role === 'assistant')).toEqual([{ role: 'assistant', content: 'Shareable answer' }])
  expect(messages.at(-1)).toEqual({ role: 'user', content: 'What about earlier?' })
  expect(wire).not.toContain(privateAnswer)
  expect(shelf.volume(id).turns.map(({ a }) => a)).toEqual([privateAnswer, 'Shareable answer', 'OK'])
})
