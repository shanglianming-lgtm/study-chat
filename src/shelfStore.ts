import { useSyncExternalStore } from 'react'
import {
  initialLibrary,
  loadShelf,
  storeShelf,
  newVolume,
  resolveModel,
  refFor,
  saveFile,
  libraryFile,
  numberFiles,
  shortTitle,
  errorText,
  type Effort,
  type Library,
  type Volume,
  type Source,
  type Turn,
  type LeafFile,
  type Note,
  type ModuleName,
} from './library'
import { checkMessages, complete, inputParts, type WireMessage, type ReturnedFile } from './provider'
import { selectedEffort } from './modelSupport'

let state = initialLibrary(),
  ready = false,
  fault = '',
  revision = 0,
  change = 0,
  written = 0
let loading: Promise<void> | undefined,
  saving: Promise<void> | undefined,
  timer: ReturnType<typeof setTimeout> | undefined
const listeners = new Set<() => void>(),
  jobs = new Map<string, AbortController>()
const undoTurns = new Map<string, { turn: Turn; index: number }>()
const shelfTitle = ({ id, name }: Volume) => ({ id, name })
let snapshot = { state, ready, fault, catalog: state.books.map(shelfTitle) }
function announce() {
  // The 3D shelf can retain its bindings while tokens and drafts change on the desk.
  const last = snapshot.catalog
  const sameTitles = state.books.length === last.length &&
    state.books.every((book, i) => book.id === last[i].id && book.name === last[i].name)
  snapshot = { state, ready, fault, catalog: sameTitles ? last : state.books.map(shelfTitle) }
  listeners.forEach((fn) => fn())
}
export function report(error: unknown) {
  fault = errorText(error)
  announce()
}
export function clearFault() {
  fault = ''
  announce()
}
function load() {
  return (loading ||= loadShelf()
    .then((saved) => {
      state = saved.value
      revision = saved.revision
      ready = true
      announce()
    })
    .catch((err) => {
      loading = undefined
      report(err)
    }))
}
export function useShelf() {
  const result = useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      void load()
      return () => {
        listeners.delete(fn)
      }
    },
    () => snapshot
  )
  return result
}
export async function flushShelf(): Promise<void> {
  if (saving) return saving
  if (!ready || written === change) return
  saving = (async () => {
    while (written !== change) {
      const version = change,
        value = state
      revision = await storeShelf(value, revision)
      written = version
    }
  })()
  try {
    await saving
  } finally {
    saving = undefined
  }
}
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    void flushShelf().catch(report)
  })
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) void flushShelf().catch(report)
  })
}
function update(next: Library) {
  if (!ready) return
  state = next
  change++
  announce()
  if (!timer)
    timer = setTimeout(() => {
      timer = undefined
      void flushShelf().catch(report)
    }, 100)
}
export function volume(id: string) {
  const book = state.books.find((b) => b.id === id)
  if (!book) throw new Error('找不到这本书。')
  return book
}
export function editVolume(id: string, patch: Partial<Volume>) {
  update({ ...state, books: state.books.map((b) => (b.id === id ? { ...b, ...patch } : b)) })
}
export function chooseBook(id: string) {
  if (id === state.selected) return
  volume(id)
  update({ ...state, selected: id })
}
export function addBook(name: string) {
  if (!ready || !name.trim()) return
  const book = newVolume(name.trim())
  update({ ...state, books: [...state.books, book], selected: book.id })
  return book.id
}
export function saveSource(source: Source) {
  const sources = [...state.providers.filter((s) => s.id !== source.id), source]
  update({
    ...state,
    providers: sources,
    books: state.books.map((b) => {
      const allowed = b.allowed.filter((r) => !!resolveModel(sources, r))
      const choice = (r: string) => (allowed.includes(r) ? r : allowed[0] || '')
      return {
        ...b,
        allowed,
        main: choice(b.main),
        summary: choice(b.summary),
        decision: choice(b.decision),
      }
    }),
  })
}
export function chooseModel(book: Volume, ref: string) {
  if (book.allowed.includes(ref) && resolveModel(state.providers, ref)) editVolume(book.id, { main: ref })
}
export async function attachFiles(id: string, files: File[]) {
  const allocated: Omit<LeafFile, 'n'>[] = []
  for (const file of files)
    allocated.push({
      id: await saveFile(file),
      name: file.name,
      size: file.size,
      mime: file.type || 'application/octet-stream',
    })
  const book = volume(id),
    seen = new Set(book.pending.map((f) => f.id)),
    fresh = allocated.filter((f) => {
      if (seen.has(f.id)) return false
      seen.add(f.id)
      return true
    })
  const { refs, serial } = numberFiles(book, fresh)
  editVolume(id, { pending: [...book.pending, ...refs], serial })
}
export function eraseTurn(id: string, turnId: string) {
  const b = volume(id),
    i = b.turns.findIndex((t) => t.id === turnId)
  if (i < 0 || jobs.has(id)) return false
  undoTurns.set(id, { turn: b.turns[i], index: i })
  editVolume(id, { turns: b.turns.filter((t) => t.id !== turnId) })
  return true
}
export function undoErase(id: string) {
  const entry = undoTurns.get(id)
  if (!entry) return
  const turns = [...volume(id).turns]
  turns.splice(entry.index, 0, entry.turn)
  undoTurns.delete(id)
  editVolume(id, { turns })
}
export function canUndo(id: string) {
  return undoTurns.has(id)
}
export function writing(id: string) {
  return jobs.has(id)
}
export function stop(id: string) {
  jobs.get(id)?.abort()
}
function patchTurn(id: string, turnId: string, patch: Partial<Turn>) {
  const b = volume(id)
  editVolume(id, { turns: b.turns.map((t) => (t.id === turnId ? { ...t, ...patch } : t)) })
}
function modelFor(b: Volume, ref: string) {
  const m = resolveModel(state.providers, ref)
  if (!m || !b.allowed.includes(ref)) throw new Error('请在管理书中为这本书选一个可用模型。')
  return m
}
const english = (s: string) => !/[一-鿿]/u.test(s)
async function summarize(b: Volume, task: 'title' | ModuleName, text: string, signal: AbortSignal) {
  const m = modelFor(b, b.summary)
  if (m.source.id === 'study')
    return task === 'title'
      ? shortTitle(text)
      : text
          .trim()
          .match(/^[\s\S]{1,146}?(?:[。！？.!?](?:\s|$)|$)/u)?.[0]
          .trim() || text.trim().slice(0, 115) + '…'
  const result = await complete(
    m.source,
    m.id,
    [
      { role: 'system', content: b.summaryPrompt },
      {
        role: 'user',
        content:
          (task === 'title'
            ? 'Give this exchange a short book chapter title.'
            : 'Write one or two imaginative sentences summarizing the following ' + task + ' entry.') +
          '\n\n' +
          text,
      },
    ],
    'default',
    false,
    signal
  )
  if (!result.text.trim()) throw new Error('摘要模型未返回文本。')
  return result.text
    .trim()
    .replace(/^["“]|["”]$/g, '')
    .slice(0, task === 'title' ? 110 : 660)
}
export async function refreshModule(id: string, field: ModuleName) {
  const b = volume(id),
    value = b[field]
  const summary = await summarize(b, field, value, AbortSignal.timeout(60000))
  const current = volume(id)
  if (
    current[field] === value &&
    current.summary === b.summary &&
    current.summaryPrompt === b.summaryPrompt
  )
    editVolume(id, { summaries: { ...current.summaries, [field]: summary } })
}
const sourceKeys = ['memory', 'profile', 'history', 'close-reading'] as const
type SourceKey = (typeof sourceKeys)[number]
async function planContext(b: Volume, q: string, files: LeafFile[], signal: AbortSignal) {
  const model = modelFor(b, b.decision)
  if (model.source.id === 'study') {
    const keys: SourceKey[] = []
    if (/remember|memory|回忆|记得|记忆/i.test(q)) keys.push('memory')
    if (/profile|prefer|关于我|偏好|档案/i.test(q)) keys.push('profile')
    if (/earlier|previous|上次|回顾|复习|之前/i.test(q)) keys.push('history')
    if (files.length || /passage|close read|细读|原文/i.test(q)) keys.push('close-reading')
    return keys
  }
  const data = await complete(
    model.source,
    model.id,
    [
      {
        role: 'system',
        content:
          b.decisionPrompt +
          '\nReturn just a JSON array of relevant keys. Allowed keys: memory, profile, history, close-reading.',
      },
      { role: 'user', content: q + '\nAttachments: ' + files.map((f) => f.name).join(', ') },
    ],
    'default',
    false,
    signal
  )
  const match = data.text.match(/\[[^\]]*]/)
  if (!match) throw new Error('决策模型未返回来源列表。')
  const values = JSON.parse(match[0])
  return sourceKeys.filter((k) => Array.isArray(values) && values.includes(k))
}
function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted()
    const abort = () => {
      clearTimeout(t)
      reject(new DOMException('已停笔', 'AbortError'))
    }
    const t = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, ms)
    signal.addEventListener('abort', abort, { once: true })
  })
}
async function localReply(q: string, src: LeafFile[], notes: string[], write: boolean) {
  const en = english(q)
  let text = en
    ? 'I would begin with the detail you would most like to return to. Write it as one sentence, then read it aloud. Which word carries the weight of the question?\n\nLeave that sentence on the page. Beside it, set down one thing you have observed and one thing you are still unsure of. The space between the two is a good place to begin.'
    : '可以先从你最想留住的那个细节写起。把它写成一句话，读一遍，看看哪个词承载着这个问题。\n\n再在旁边记下一件已经观察到的事，和一件仍不确定的事。两者之间的距离，就是下一步可以继续追问的地方。'
  if (src.length) {
    const f = src[0],
      blob = await libraryFile(f.id),
      excerpt =
        blob && (/^text\//.test(f.mime) || /\.(md|txt|csv|json)$/i.test(f.name))
          ? (await blob.text()).trim().slice(0, 180)
          : ''
    text =
      (en ? 'The attached passage' : '随问题附上的材料') +
      ' [' +
      f.n +
      ']' +
      (excerpt
        ? (en ? ' opens with “' : ' 的开头是「') +
          excerpt +
          (en ? (/[.!?]$/u.test(excerpt) ? '”' : '.”') : '」。')
        : en
          ? ' is included with this exchange.'
          : '已收进本轮引用。') +
      '\n\n' +
      text
  } else if (notes.length) {
    text =
      (en ? 'From the book’s notes: ' : '书里留有这样一段记录：') +
      notes[0].split('\n').at(-1)?.slice(0, 160) +
      '\n\n' +
      text
  }
  return {
    text,
    files: write
      ? [
          {
            name: en ? 'Reading note.md' : '阅读手记.md',
            content: '# ' + shortTitle(q) + '\n\n' + text,
            mime: 'text/markdown',
          },
        ]
      : [],
  }
}
export async function submit(id: string, retryId?: string) {
  if (jobs.has(id) || !ready) return
  const b = volume(id),
    old = retryId ? b.turns.find((t) => t.id === retryId) : undefined
  if (retryId && !old) return
  const files = old?.input || b.pending,
    q = old?.q || b.draft.trim() || (files.length ? files.map((f) => f.name).join(' · ') : '')
  if (!q) return
  const m = modelFor(b, b.main),
    signaler = new AbortController(),
    signal = signaler.signal
  const turnId = old?.id || crypto.randomUUID(),
    notes: Note[] = [],
    before = old ? b.turns.slice(0, b.turns.indexOf(old)) : b.turns
  const take = crypto.randomUUID(),
    modelRef = b.main,
    effort = selectedEffort(m.source, m.id, b.effort)
  let ink = ''
  jobs.set(id, signaler)
  let currentInput: WireMessage['content'] = q
  try {
    if (m.source.id !== 'study') {
      currentInput = await inputParts(q, files)
      checkMessages([{ role: 'user', content: currentInput }])
    }
    signal.throwIfAborted()
  } catch (e) {
    jobs.delete(id)
    announce()
    throw e
  }
  if (!old) {
    const turn: Turn = {
      id: turnId,
      take,
      q,
      a: '',
      input: files,
      output: [],
      model: modelRef,
      effort,
      notes: [],
      state: 'writing',
    }
    const current = volume(id)
    editVolume(id, {
      turns: [...current.turns, turn],
      draft: current.draft === b.draft ? '' : current.draft,
      pending: current.pending.filter((f) => !files.includes(f)),
    })
  } else announce()
  const record = (kind: string, text: string) => {
    if (!text) return
    if (kind === '思路摘要' && notes.at(-1)?.kind === kind)
      notes[notes.length - 1] = { kind, text: notes.at(-1)!.text + text }
    else notes.push({ kind, text })
    if (!old) patchTurn(id, turnId, { notes: notes.slice() })
  }
  const write = (delta: string) => {
    if (!delta) return
    ink += delta
    if (!old) patchTurn(id, turnId, { a: ink, notes: notes.slice() })
  }
  try {
    const keys = await planContext(b, q, files, signal),
      context: string[] = []
    record('决策', modelFor(b, b.decision).id + ' · ' + (keys.length ? keys.join(', ') : '直接回答'))
    if (keys.includes('memory')) {
      context.push('Memory\n' + b.memory)
      record('回顾', '读取此书的 Memory')
    }
    if (keys.includes('profile')) {
      context.push('Profile\n' + b.profile)
      record('回顾', '读取此书的 Profile')
    }
    if (keys.includes('history')) {
      context.push(
        'Earlier exchanges\n' +
          before
            .slice(-3)
            .map((t) => t.q + '\n' + t.a)
            .join('\n')
      )
      record('复习', '回看 ' + Math.min(3, before.length) + ' 轮早先的问答')
    }
    if (keys.includes('close-reading')) {
      const skill = await import('./skills/close-reading.md?raw')
      context.push(skill.default)
      record('Skill', '读取 Close reading')
    }
    files.forEach((f) => record('附件', '随问题附入 [' + f.n + '] ' + f.name))
    record(m.source.id === 'study' ? '本地演示' : '模型调用', m.source.name + ' / ' + m.id + ' · ' + effort)
    const wantsFile =
      /(?:生成|制作|导出|保存|写成|写一[个份]).{0,15}(?:文件|文档|报告|表格|markdown|\.md|\.txt|\.csv)|(?:create|generate|write|export|save).{0,25}(?:file|document|\.md|\.txt|\.csv)/i.test(
        q
      )
    let products: ReturnedFile[] = []
    if (m.source.id === 'study') {
      const res = await localReply(q, files, context, wantsFile)
      for (const chunk of res.text.match(/[\s\S]{1,7}/gu) || []) {
        await pause(30, signal)
        write(chunk)
      }
      products = res.files
    } else {
      const wire: WireMessage[] = [
        {
          role: 'system',
          content:
            'You are the correspondent in a printed book. Cite supplied files using their [n] identifiers.\n' +
            context.join('\n\n'),
        },
      ]
      for (const t of before) {
        wire.push({ role: 'user', content: await inputParts(t.q, t.input) })
        if (t.a) wire.push({ role: 'assistant', content: t.a })
      }
      wire.push({ role: 'user', content: currentInput })
      const result = await complete(
        m.source,
        m.id,
        wire,
        effort,
        true,
        signal,
        { ink: write, note: record },
        wantsFile
      )
      products = result.files
    }
    const downloads = new Map<string, string>()
    for (const match of ink.matchAll(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/gi)) {
      const url = match[2]
      if (
        !/\.(?:pdf|docx?|xlsx?|pptx?|csv|md|txt|json|zip|png|jpe?g|webp|wav|mp3|mp4)(?:[?#].*)?$/i.test(url)
      )
        continue
      if (!products.some((p) => p.url === url))
        products.push({ name: match[1], url, mime: 'application/octet-stream' })
      downloads.set(match[0], url)
    }
    let output: LeafFile[] = []
    for (const f of products) {
      if (f.content !== undefined || f.url?.startsWith('data:')) {
        const blob =
          f.content !== undefined
            ? new Blob([f.content], { type: f.mime })
            : new Blob(
                [Uint8Array.from(atob(f.url!.slice(f.url!.indexOf(',') + 1)), (c) => c.charCodeAt(0))],
                { type: f.mime }
              )
        const fileId = await saveFile(blob)
        output.push({ id: fileId, n: 0, name: f.name, mime: blob.type, size: blob.size })
      } else if (f.url)
        output.push({ id: crypto.randomUUID(), n: 0, name: f.name, mime: f.mime, size: 0, url: f.url })
      record('输出文件', f.name)
    }
    signal.throwIfAborted()
    if (!ink && !output.length) throw new Error('模型未返回正文。')
    if (!ink) write(english(q) ? 'The document is ready.' : '文档已写好。')
    const current = volume(id)
    const numbered = numberFiles(current, output, old?.output)
    output = numbered.refs
    for (const [link, url] of downloads) {
      const file = output.find((f) => f.url === url)
      if (file) ink = ink.replaceAll(link, '[' + file.n + ']')
    }
    editVolume(id, {
      serial: numbered.serial,
      turns: current.turns.map((t) =>
        t.id === turnId
          ? { ...t, take, a: ink, state: 'done', output, notes: notes.slice(), model: modelRef, effort, error: undefined }
          : t
      ),
    })
    if (!b.hasTitle && !old) {
      try {
        const title = await summarize(b, 'title', q + '\n' + ink.slice(0, 300), signal)
        if (!volume(id).hasTitle) editVolume(id, { title, hasTitle: true })
      } catch (e) {
        if (!signal.aborted) {
          editVolume(id, { title: shortTitle(q), hasTitle: true })
          record('章名', errorText(e))
        }
      }
    }
  } catch (e) {
    if (old) {
      if (!signal.aborted) report(e)
    } else
      patchTurn(id, turnId, {
        state: signal.aborted ? 'stopped' : 'failed',
        error: signal.aborted ? '已停笔' : errorText(e),
        a: ink,
        notes: notes.slice(),
      })
  } finally {
    jobs.delete(id)
    announce()
    void flushShelf().catch(report)
  }
}
export function exportVolume(b: Volume) {
  const text =
    '# ' +
    b.title +
    '\n\n' +
    b.turns
      .map(
        (t) =>
          '## ' +
          t.q +
          '\n\n' +
          t.a +
          '\n\n' +
          [...t.input, ...t.output].map((f) => '[' + f.n + '] ' + f.name).join('\n')
      )
      .join('\n\n')
  downloadBlob(new Blob([text], { type: 'text/markdown;charset=utf-8' }), b.name + '.md')
}
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}
export const modelRefFor = (source: Source, id: string) => refFor(source.id, id)
