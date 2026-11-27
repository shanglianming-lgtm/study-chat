import { isTauri, invoke } from '@tauri-apps/api/core'
import { BOOK_TITLE } from './content'
import type { ReadingPosition } from './book'
import type { ChatSnapshot } from './chat'

export const native = isTauri()
export const efforts = {
  default: 'default',
  minimal: 'Light',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'XHigh',
  max: 'Max',
} as const
export type Effort = keyof typeof efforts
export type Source = { id: string; name: string; url: string; models: string[]; useKey: boolean; modelEfforts?: Record<string, Effort[]> }
export type LeafFile = { id: string; n: number; name: string; mime: string; size: number; url?: string }
export type Note = { kind: string; text: string }
export type Turn = {
  take?: string
  id: string
  q: string
  a: string
  state: 'writing' | 'done' | 'stopped' | 'failed'
  input: LeafFile[]
  output: LeafFile[]
  notes: Note[]
  model: string
  effort: Effort
  error?: string
}
export type ModuleName = 'memory' | 'profile'
export type Volume = {
  id: string
  name: string
  title: string
  hasTitle: boolean
  bookmark?: ReadingPosition
  imprint?: { author?: string; publisher?: string; edition?: string }
  draft: string
  pending: LeafFile[]
  serial: number
  turns: Turn[]
  memory: string
  profile: string
  summaries: Record<ModuleName, string>
  allowed: string[]
  main: string
  summary: string
  decision: string
  effort: Effort
  summaryPrompt: string
  decisionPrompt: string
}
export type Library = { version: 1; selected: string; providers: Source[]; books: Volume[] }
export const localSource: Source = {
  id: 'study',
  name: '本地演示',
  url: '',
  useKey: false,
  models: ['Study · Reflective', 'Study · Quiet'],
}
export const refFor = (p: string, m: string) => p + ':' + m
export function resolveModel(sources: Source[], ref: string) {
  const i = ref.indexOf(':'),
    id = ref.slice(i + 1)
  const source = sources.find((p) => p.id === ref.slice(0, i) && p.models.includes(id))
  return source ? { source, id } : null
}
export const summaryInstruction =
  'Write a short literary title or a compact, imaginative marginal note in the language of the source. Preserve its facts. Return only the requested text.'
export const decisionInstruction =
  'Choose the sources needed to answer the question. Select only relevant items from memory, profile, earlier exchanges, and the close-reading skill.'
export function newVolume(name: string, id = crypto.randomUUID() as string): Volume {
  const allowed = localSource.models.map((m) => refFor(localSource.id, m))
  return {
    id,
    name,
    title: 'Correspondence',
    hasTitle: false,
    draft: '',
    pending: [],
    serial: 1,
    turns: [],
    memory: '',
    profile: '',
    summaries: { memory: '', profile: '' },
    allowed,
    main: allowed[0],
    summary: allowed[1],
    decision: allowed[1],
    effort: 'default',
    summaryPrompt: summaryInstruction,
    decisionPrompt: decisionInstruction,
  }
}
export function initialLibrary(): Library {
  const book = newVolume(BOOK_TITLE, 'book-1')
  return { version: 1, selected: book.id, providers: [localSource], books: [book] }
}
export function importEarlier(snapshot: ChatSnapshot) {
  const library = initialLibrary(),
    book = library.books[0]
  book.draft = snapshot.draft
  if (snapshot.provider) {
    const p = snapshot.provider
    const source: Source = {
      id: 'original',
      name: p.name,
      url: p.endpoint,
      models: [p.model],
      useKey: p.useKey,
    }
    library.providers.push(source)
    book.main = refFor(source.id, p.model)
    book.allowed.push(book.main)
  }
  for (const message of snapshot.messages) {
    let turn = book.turns.at(-1)
    if (message.role === 'user' || !turn || turn.state !== 'writing') {
      turn = {
        id: message.id,
        q: '',
        a: '',
        notes: [],
        input: [],
        output: [],
        state: 'writing',
        model: book.main,
        effort: 'default',
      }
      book.turns.push(turn)
    }
    if (message.role === 'user') turn.q = message.content
    else {
      turn.a = message.content
      turn.state = message.status === 'complete' ? 'done' : 'stopped'
      turn.error = message.error || undefined
    }
  }
  if (book.turns[0]?.q) {
    book.title = shortTitle(book.turns[0].q)
    book.hasTitle = true
  }
  return library
}
export function shortTitle(s: string) {
  return (
    s
      .trim()
      .split(/[\n。！？!?]/u)[0]
      ?.slice(0, 62)
      .trim() || 'Correspondence'
  )
}
let database: Promise<IDBDatabase> | undefined
function db() {
  if (!database)
    database = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('study-bound-library', 1)
      req.onupgradeneeded = () => {
        req.result.createObjectStore('shelf')
        req.result.createObjectStore('files')
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => {
        database = undefined
        reject(req.error)
      }
    })
  return database
}
async function stored<T>(store: string, key: string): Promise<T | undefined> {
  const d = await db()
  return new Promise((resolve, reject) => {
    const req = d.transaction(store).objectStore(store).get(key)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
export const libraryFile = (id: string) => stored<Blob>('files', id)
export async function saveFile(data: Blob) {
  const digest = await crypto.subtle.digest('SHA-256', await data.arrayBuffer())
  const id =
      'sha256-' + Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, '0')).join(''),
    d = await db()
  await new Promise<void>((resolve, reject) => {
    const tx = d.transaction('files', 'readwrite')
    tx.objectStore('files').put(data, id)
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error)
  })
  return id
}
type Saved = { revision: number; value: Library }
export async function loadShelf(): Promise<Saved> {
  const saved = native
    ? await invoke<Saved | null>('library_load')
    : await stored<Saved>('shelf', 'current')
  const value =
    saved?.value || (native ? importEarlier(await invoke<ChatSnapshot>('chat_load')) : initialLibrary())
  for (const book of value.books)
    for (const turn of book.turns) if (turn.state === 'writing') turn.state = 'stopped'
  return { revision: saved?.revision || 0, value }
}
export async function storeShelf(value: Library, revision: number) {
  if (native) return invoke<number>('library_save', { value, revision })
  const d = await db()
  return new Promise<number>((resolve, reject) => {
    const tx = d.transaction('shelf', 'readwrite'),
      table = tx.objectStore('shelf'),
      req = table.get('current')
    req.onsuccess = () => {
      if ((req.result?.revision || 0) !== revision) {
        tx.abort()
        return
      }
      table.put({ value, revision: revision + 1 }, 'current')
    }
    tx.oncomplete = () => resolve(revision + 1)
    tx.onabort = () => reject(tx.error || new Error('另一窗口已保存更新，请重新打开书房。'))
  })
}
export function normalizeEndpoint(raw: string) {
  const url = new URL(raw.trim())
  if (
    !(
      url.protocol === 'https:' ||
      (url.protocol === 'http:' && /^(localhost|127(?:\.\d+){3}|\[::1\])$/.test(url.hostname))
    ) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('请填写 HTTPS 服务地址，本地服务可用 HTTP。')
  let path = url.pathname.replace(/\/+$/, '').replace(/\/(?:chat\/completions|models)$/, '')
  if (url.hostname === 'api.openai.com') path = path.replace(/\/responses$/, '')
  if (url.hostname === 'api.anthropic.com') path = path.replace(/\/messages$/, '')
  if (url.hostname === 'openrouter.ai' && ['', '/api', '/v1'].includes(path)) path = '/api/v1'
  if (url.hostname === 'generativelanguage.googleapis.com' && ['', '/v1', '/v1beta'].includes(path))
    path = '/v1beta/openai'
  if (!path) path = '/v1'
  url.pathname = path + '/chat/completions'
  return url.toString()
}
export function numberFiles(book: Volume, files: Omit<LeafFile, 'n'>[], previous: LeafFile[] = []) {
  const remembered = [...book.pending, ...book.turns.flatMap((t) => [...t.input, ...t.output]), ...previous]
  const numbers = new Map(remembered.map((f) => [f.url || f.id, f.n]))
  const matches = new Set<number>()
  let serial = book.serial
  const refs = files.map((f) => {
    const key = f.url || f.id,
      old = previous.find((p) => p.name === f.name && p.mime === f.mime && !matches.has(p.n))
    const n = numbers.get(key) ?? old?.n ?? serial++
    matches.add(n)
    numbers.set(key, n)
    return { ...f, n }
  })
  return { refs, serial }
}
export function settingAllowed(book: Volume, allowed: string[]): Partial<Volume> {
  const pick = (value: string) => (allowed.includes(value) ? value : allowed[0] || '')
  return { allowed, main: pick(book.main), summary: pick(book.summary), decision: pick(book.decision) }
}
export const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))
