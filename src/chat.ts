import { Channel, invoke, isTauri } from '@tauri-apps/api/core'
import { useEffect, useRef, useState } from 'react'
import { mockReply, type Message, type ProcessRecord } from './content'
import { stoppedManuscript } from './book'

export type Provider = { name: string; endpoint: string; model: string; useKey: boolean }
export type StoredMessage = Message & { status: string; error?: string | null }
export type ChatSnapshot = { projectId: string; conversationId: string; provider: Provider | null; hasKey: boolean; draft: string; messages: StoredMessage[] }
export type ChatEvent = { kind: 'started'; user: StoredMessage; assistant: StoredMessage } | { kind: 'delta'; id: string; content: string } | { kind: 'finished'; message: StoredMessage }
export const desktop = isTauri()

// The WebView never fetches a provider. All network and persistence use Rust commands.
export const chatApi = {
  load: () => invoke<ChatSnapshot>('chat_load'),
  configure: (provider: Provider, key?: string) => invoke<void>('chat_configure', { provider, key: key || null }),
  forgetKey: () => invoke<void>('chat_forget_key'),
  draft: (draft: string) => invoke<void>('chat_draft', { draft }),
  send: (requestId: string, question: string, onEvent: (event: ChatEvent) => void) => {
    const channel = new Channel<ChatEvent>(); channel.onmessage = onEvent
    return invoke<void>('chat_send', { requestId, question, onEvent: channel })
  },
  cancel: (requestId: string) => invoke<void>('chat_cancel', { requestId }),
  export: () => invoke<string | null>('chat_export'),
}

export function useChat() {
  const [demo, setDemo] = useState(!desktop)
  const [ready, setReady] = useState(!desktop)
  const [messages, setMessages] = useState<StoredMessage[]>([])
  const [draft, setDraftState] = useState('')
  const [provider, setProvider] = useState<Provider | null>(null)
  const [hasKey, setHasKey] = useState(false)
  const [stream, setStream] = useState<string | null>(null)
  const [streamId, setStreamId] = useState('live')
  const [busy, setBusy] = useState(false)
  const [canStop, setCanStop] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const demoMode = useRef(!desktop)
  const request = useRef<string | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const demoJob = useRef<{ id: string; content: string; process: ProcessRecord } | null>(null)
  const draftQueue = useRef<Promise<void>>(Promise.resolve())
  const unsavedDraft = useRef<string | null>(null)
  const apply = (snapshot: ChatSnapshot) => {
    setMessages(snapshot.messages); setDraftState(snapshot.draft); setProvider(snapshot.provider); setHasKey(snapshot.hasKey)
  }
  useEffect(() => {
    let alive = true
    if (!demo) { setReady(false); void chatApi.load().then(snapshot => { if (alive) { apply(snapshot); setReady(true) } }).catch(() => { if (alive) setError('无法读取本地对话。请检查应用数据目录后重新打开；未切换为演示。') }) }
    return () => { alive = false }
  }, [demo])
  useEffect(() => () => { if (timer.current) clearInterval(timer.current) }, [])
  const setDraft = (value: string) => {
    setDraftState(value)
    if (!demoMode.current && ready) {
      unsavedDraft.current = value
      // Serialize saves; never let an older keystroke overwrite a newer draft.
      draftQueue.current = draftQueue.current.catch(() => {}).then(() => chatApi.draft(value)).then(() => { if (unsavedDraft.current === value) unsavedDraft.current = null }).catch(() => { setError('草稿尚未保存，请检查磁盘后重试；当前文字仍留在输入框。') })
    }
  }
  const flushDraft = async () => {
    await draftQueue.current
    if (unsavedDraft.current !== null) { await chatApi.draft(unsavedDraft.current); unsavedDraft.current = null }
  }
  const finishDemo = (stopped = false) => {
    if (timer.current) clearInterval(timer.current)
    timer.current = null
    const job = demoJob.current
    if (job) setMessages(items => [...items, { id: job.id, role: 'assistant', content: stopped ? stoppedManuscript(job.content || '（尚未写下回应。）') : job.content, process: job.process, status: stopped ? 'cancelled' : 'complete' }])
    demoJob.current = null; request.current = null; setBusy(false); setCanStop(false); setStream(null); setNotice('演示回应已装订；不会写入真实对话。')
  }
  const send = async (demoModel = 'Study · Reflective', demoEffort = '标准推理') => {
    const question = draft.trim()
    if (!question || request.current || !ready) return
    const requestId = crypto.randomUUID(); request.current = requestId
    setBusy(true); setError(''); setNotice('')
    if (demo) {
      const id = `a-${requestId}`; setStreamId(id); setStream(''); setDraftState(''); setCanStop(true)
      setMessages(items => [...items, { id: `q-${requestId}`, role: 'user', content: question, status: 'complete' }])
      const full = mockReply(question, demoModel, demoEffort)
      demoJob.current = { id, content: '', process: { model: demoModel, effort: demoEffort } }
      timer.current = setInterval(() => { const job = demoJob.current; if (!job) return; job.content = full.slice(0, job.content.length + 9); setStream(job.content); if (job.content.length === full.length) finishDemo() }, 44)
      return
    }
    try {
      await flushDraft()
      let finished = false
      await chatApi.send(requestId, question, event => {
        if (request.current !== requestId) return
        if (event.kind === 'started') {
          setMessages(items => [...items, event.user]); setStreamId(event.assistant.id); setStream(''); setDraftState(''); setCanStop(true)
        } else if (event.kind === 'delta') setStream(event.content)
        else {
          finished = true
          setMessages(items => [...items.filter(m => m.id !== event.message.id), event.message]); setStream(null); setCanStop(false)
          if (event.message.error) setError(event.message.error)
          setNotice(event.message.status === 'complete' ? '回应已保存到本地。' : '已保留提问和收到的回应，可继续提问。')
        }
      })
      if (!finished) { const snapshot = await chatApi.load(); setMessages(snapshot.messages); setStream(null) }
    } catch (failure) {
      setError(typeof failure === 'string' ? failure : '请求失败，当前输入仍保留。请检查设置后重试。')
      // Reconcile a command/channel failure with the durable state, without losing a newly typed draft.
      try { const snapshot = await chatApi.load(); setMessages(snapshot.messages); setStream(null) } catch { /* Keep visible text if storage is unavailable. */ }
    } finally { request.current = null; setBusy(false); setCanStop(false) }
  }
  const stop = async () => {
    if (demo) finishDemo(true)
    else if (request.current) { try { await chatApi.cancel(request.current) } catch { setError('停止请求未成功，请重试；已经收到的内容仍保留。') } }
  }
  const switchDemo = async (value: boolean) => {
    if (busy || value === demo) return
    try {
      if (!demo) await flushDraft()
      setMessages([]); setDraftState(''); setStream(null); setError(''); setNotice(''); demoMode.current = value; setDemo(value); setReady(value)
    } catch { setError('当前草稿尚未保存，暂不切换。') }
  }
  const configure = async (next: Provider, key?: string) => {
    await chatApi.configure(next, key)
    const snapshot = await chatApi.load(); setProvider(snapshot.provider); setHasKey(snapshot.hasKey); setError('')
  }
  const forgetKey = async () => { await chatApi.forgetKey(); setHasKey(false) }
  const exportChat = async () => {
    try { await flushDraft(); const path = await chatApi.export(); if (path) setNotice(`已导出到 ${path}`) } catch (failure) { setError(typeof failure === 'string' ? failure : '导出失败，请重试。') }
  }
  return { demo, ready, messages, draft, setDraft, provider, hasKey, stream, streamId, busy, canStop, error, setError, notice, setNotice, send, stop, switchDemo, configure, forgetKey, exportChat }
}
