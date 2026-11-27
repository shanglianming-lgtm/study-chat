import { Channel, invoke } from '@tauri-apps/api/core'
import { libraryFile, native, normalizeEndpoint, type Effort, type LeafFile, type Source } from './library'
import { levels, selectedEffort, service } from './modelSupport'
import { fileTool, nativeCompletion, outputFile } from './providerNative'

const sessionKeys = new Map<string, string>()
export async function credential(url: string, key?: string, remove = false) {
  const endpoint = normalizeEndpoint(url)
  if (native) return invoke<boolean>('library_secret', { endpoint, key: key || null, remove })
  if (remove) sessionKeys.delete(endpoint)
  else if (key?.trim()) sessionKeys.set(endpoint, key.trim())
  return sessionKeys.has(endpoint)
}
type Json = Record<string, any>
export type WireMessage = { role: string; content: string | Json[] }
const restrictedText = /思[维維]([链鏈路]|[过過]程)?|想法|念[头頭]|思[考路绪緒]|推理|內心獨白|内心独白|\b(?:chain[\s_-]*of[\s_-]*thoughts?|thoughts?|thinking|think|reasoning|ideas?|inner[\s_-]+monologue|cot)\b/iu
function checkText(text: string, where: string) {
  const words = text.normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ')
  if (restrictedText.test(words))
    throw new Error(where + '含有受限表述，已保留在本机。')
}
export function checkMessages(messages: WireMessage[]) {
  messages.forEach(({ role, content }, i) => {
    const where = '第 ' + (i + 1) + ' 条' + (role === 'system' ? '提示或引用材料' : '消息')
    if (typeof content === 'string') checkText(content, where)
    else for (const p of content) {
      if (p.type !== 'text' || typeof p.text !== 'string') throw new Error(where + '含有无法在本机核对的附件。')
      checkText(p.text, where)
    }
  })
}
export function effortFields(url: string, effort: Effort): Json {
  if (effort === 'default') return {}
  const api = service(url)
  if (api === 'anthropic') return { output_config: { effort } }
  return api === 'openrouter' || api === 'openai'
    ? { reasoning: { effort } }
    : { reasoning_effort: effort }
}
export function sseReader(onEvent: (event: string) => void) {
  let rest = '',
    parts: string[] = []
  return (fragment: string, end = false) => {
    rest += fragment
    const lines = rest.split('\n')
    rest = lines.pop()!
    if (end && rest) {
      lines.push(rest, '')
      rest = ''
    }
    for (const raw of lines) {
      const line = raw.replace(/\r$/, '')
      if (!line) {
        if (parts.length) onEvent(parts.join('\n'))
        parts = []
      } else if (line.startsWith('data:')) parts.push(line.slice(5).replace(/^ /, ''))
    }
    if (rest.length > 8_000_000) throw new Error('回应事件过大。')
  }
}
async function request(
  source: Source,
  payload: Json | null,
  signal: AbortSignal,
  onData = (_: string) => {},
  after?: string
) {
  signal.throwIfAborted()
  const endpoint = normalizeEndpoint(source.url)
  if (native) {
    const id = crypto.randomUUID(),
      channel = new Channel<string>()
    let eventError: unknown
    let finishStream!: () => void
    const drained = new Promise<void>((resolve) => {
      finishStream = resolve
    })
    channel.onmessage = (data) => {
      if (data === '\u001e') {
        finishStream()
        return
      }
      try {
        if (!signal.aborted && !eventError) onData(data)
      } catch (err) {
        eventError = err
        void invoke('library_cancel', { id }).catch(() => {})
      }
    }
    const abort = () => {
      void invoke('library_cancel', { id }).catch(() => {})
    }
    signal.addEventListener('abort', abort, { once: true })
    try {
      const value = await invoke<Json | null>('library_http', {
        id,
        endpoint,
        useKey: source.useKey,
        payload,
        after: after || null,
        onData: channel,
      })
      if (value === null) await drained
      if (eventError) throw eventError
      signal.throwIfAborted()
      return value
    } finally {
      signal.removeEventListener('abort', abort)
    }
  }
  const key = source.useKey && sessionKeys.get(endpoint)
  const headers: Record<string, string> = payload ? { 'Content-Type': 'application/json' } : {}
  const api = service(endpoint)
  const suffix = !payload ? 'models' : api === 'anthropic' ? 'messages' : api === 'openai' ? 'responses' : 'chat/completions'
  const url = new URL(endpoint.replace(/chat\/completions$/, suffix))
  if (api === 'gemini' && !payload) {
    url.pathname = '/v1beta/models'
    if (key) headers['x-goog-api-key'] = key
    if (after) url.searchParams.set('pageToken', after)
  } else if (api === 'anthropic') {
    headers['anthropic-version'] = '2023-06-01'
    headers['anthropic-dangerous-direct-browser-access'] = 'true'
    if (key) headers['x-api-key'] = key
    if (after && !payload) url.searchParams.set('after_id', after)
  } else if (key) headers.Authorization = 'Bearer ' + key
  let response: Response
  try {
    response = await fetch(url.toString(), {
      method: payload ? 'POST' : 'GET',
      headers,
      body: payload ? JSON.stringify(payload) : undefined,
      credentials: 'omit',
      redirect: 'error',
      signal,
    })
  } catch (e) {
    signal.throwIfAborted()
    throw new Error('连接失败，请检查地址和网络。网页端还需要提供商允许跨域请求。', { cause: e })
  }
  if (!response.ok) {
    const info: Record<number, string> = {
      400: '模型不接受当前参数或附件',
      401: '凭据未被接受',
      403: '缺少模型权限',
      404: '地址或模型不存在',
      422: '参数不适用',
      429: '额度不足或服务商限流',
    }
    throw new Error('HTTP ' + response.status + ' · ' + (info[response.status] || '服务商请求失败'))
  }
  if (response.headers.get('content-type')?.includes('text/event-stream') && response.body) {
    const reader = response.body.getReader(),
      decode = new TextDecoder()
    let doneMarker = false,
      received = 0
    const consume = sseReader((data) => {
      onData(data)
      if (data.trim() === '[DONE]') doneMarker = true
    })
    try {
      while (!doneMarker) {
        const next = await reader.read()
        if (next.done) break
        received += next.value.byteLength
        if (received > 4 * 1024 * 1024) throw new Error('回应流过大，已停止接收。')
        consume(decode.decode(next.value, { stream: true }))
      }
      consume(decode.decode(), true)
    } finally {
      await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
    return null
  }
  return (await response.json()) as Json
}
export async function catalog(source: Source, signal: AbortSignal) {
  const api = service(source.url), models = new Set<string>(), cursors = new Set<string>()
  const modelEfforts: Record<string, Effort[]> = Object.create(null)
  let after: string | undefined
  do {
    const data = await request(source, null, signal, undefined, after)
    const entries = api === 'gemini' ? data?.models : data?.data
    if (!Array.isArray(entries)) throw new Error('该地址未提供模型目录，可手动填写模型 ID。')
    for (const m of entries) {
      const id = api === 'gemini' ? m?.name?.replace(/^models\//, '') : m?.id
      if (typeof id !== 'string' || !id) continue
      if (api === 'gemini' && !m.supportedGenerationMethods?.includes('generateContent')) continue
      if (api === 'openrouter' && Array.isArray(m.endpoints) && !m.endpoints.includes('/api/v1/chat/completions')) continue
      models.add(id)
      if (api === 'openrouter') {
        const supported = m.reasoning?.supported_efforts
        if (supported === null) modelEfforts[id] = levels
        else if (Array.isArray(supported)) modelEfforts[id] = levels.filter((e) => supported.includes(e))
        else if (m.reasoning || (Array.isArray(m.supported_parameters) && !m.supported_parameters.some((p: string) => ['reasoning', 'reasoning_effort'].includes(p)))) modelEfforts[id] = []
      }
      if (api === 'anthropic' && m.capabilities?.effort)
        modelEfforts[id] = levels.filter((e) => m.capabilities.effort[e]?.supported === true)
    }
    after = api === 'gemini' ? data?.nextPageToken : api === 'anthropic' && data?.has_more ? data.last_id : undefined
    if (after && cursors.has(after)) throw new Error('模型目录重复返回同一页。')
    if (after) cursors.add(after)
  } while (after)
  return { models: [...models].sort(), modelEfforts }
}
export async function discover(source: Source, signal: AbortSignal) {
  return (await catalog(source, signal)).models
}
export type ReturnedFile = { name: string; url?: string; content?: string; mime: string }
type Completion = { text: string; files: ReturnedFile[] }
export type Events = { ink?: (delta: string) => void; note?: (kind: string, text: string) => void }
export async function complete(
  source: Source,
  model: string,
  messages: WireMessage[],
  effort: Effort,
  stream: boolean,
  signal: AbortSignal,
  events: Events = {},
  writeFile = false
): Promise<Completion> {
  checkMessages(messages)
  const api = service(source.url)
  const fields = effortFields(source.url, selectedEffort(source, model, effort))
  if (api === 'openai' || api === 'anthropic') {
    return nativeCompletion(api, model, messages, fields, stream, events, writeFile,
      (payload, onData) => request(source, payload, signal, onData))
  }
  const result: Completion = { text: '', files: [] },
    calls = new Map<number, { name: string; args: string }>()
  let ended = false
  const ink = (text: string) => {
    result.text += text
    events.ink?.(text)
  }
  const part = (p: Json) => {
    if (api === 'gemini' && p.thought === true) {
      if (typeof p.text === 'string') events.note?.('思路摘要', p.text)
      return
    }
    if ((p.type === 'text' || p.type === 'output_text') && typeof p.text === 'string') ink(p.text)
    const f = p.file || p.output_file || p.image_url || p
    const url = typeof f === 'string' ? f : f.file_data || f.url || f.download_url
    if (typeof url === 'string' && /^(https?:\/\/|data:[\w.+/-]+;base64,)/i.test(url)) {
      const name =
        f.filename || f.name || p.filename || (p.type === 'image_url' ? 'Image.png' : 'Attachment')
      if (!result.files.some((o) => o.url === url))
        result.files.push({
          name,
          url,
          mime: f.mime_type || url.match(/^data:([^;]+)/)?.[1] || 'application/octet-stream',
        })
    }
  }
  const accept = (packet: Json) => {
    if (packet.error) throw new Error('服务商在生成过程中返回错误。')
    const ch = packet.choices?.[0]
    if (!ch) return
    const m = ch.delta || ch.message
    if (m) {
      if (typeof m.content === 'string') ink(m.content)
      else if (Array.isArray(m.content)) m.content.forEach(part)
      for (const f of [...(m.images || []), ...(m.attachments || []), ...(m.files || [])]) part(f)
      for (const detail of m.reasoning_details || [])
        if (detail.type === 'reasoning.summary' && typeof detail.summary === 'string')
          events.note?.('思路摘要', detail.summary)
      if (typeof m.reasoning_summary === 'string') events.note?.('思路摘要', m.reasoning_summary)
      for (const [i, call] of (m.tool_calls || []).entries()) {
        const index = call.index ?? i,
          prev = calls.get(index) || { name: '', args: '' }
        prev.name += call.function?.name || ''
        prev.args += call.function?.arguments || ''
        calls.set(index, prev)
      }
    }
    if (ch.finish_reason) {
      ended = true
      if (!['stop', 'tool_calls'].includes(ch.finish_reason))
        throw new Error('回应提前结束 · ' + ch.finish_reason)
    }
  }
  const payload: Json = { model, messages, stream, ...fields }
  if (writeFile) payload.tools = [{ type: 'function', function: fileTool }]
  const json = await request(source, payload, signal, (data) => {
    if (data.trim() === '[DONE]') {
      ended = true
      return
    }
    accept(JSON.parse(data))
  })
  if (json) {
    accept(json)
    ended = true
  }
  if (!ended) throw new Error('回应流中断，已收到的文字已保留。')
  for (const call of calls.values()) {
    if (call.name !== 'write_document' || !writeFile) {
      events.note?.('工具请求', call.name + '（未执行）')
      continue
    }
    outputFile(call.name, JSON.parse(call.args), result.files, writeFile, events)
  }
  return result
}
export async function testKey(source: Source, model: string, signal: AbortSignal) {
  const start = performance.now()
  const reply = await complete(
    source,
    model,
    [{ role: 'user', content: 'Reply with the single word OK.' }],
    'default',
    false,
    signal
  )
  if (!reply.text.trim()) throw new Error('服务商接受了请求，但未返回文本。')
  return Math.round(performance.now() - start) + ' ms · ' + reply.text.trim().slice(0, 170)
}
export async function inputParts(text: string, files: LeafFile[]): Promise<string | Json[]> {
  if (!files.length) return text
  const parts: Json[] = [
    { type: 'text', text: text + '\n' + files.map((f) => '[' + f.n + '] ' + f.name).join('\n') },
  ]
  for (const f of files) {
    const blob = await libraryFile(f.id)
    if (!blob) throw new Error('找不到附件 ' + f.name + '，请重新附上文件。')
    if (!/^text\//.test(f.mime) && !/\.(txt|md|csv|json|log|xml|ya?ml)$/i.test(f.name))
      throw new Error('无法在本机核对附件「' + f.name + '」的正文，可改附 UTF-8 文本。')
    let content: string
    try {
      content = new TextDecoder('utf-8', { fatal: true }).decode(await blob.arrayBuffer())
      if (content.includes('\u0000')) throw new Error()
    } catch {
      throw new Error('附件「' + f.name + '」无法作为 UTF-8 文本核对。')
    }
    checkText(f.name + '\n' + content, '附件「' + f.name + '」')
    parts.push({ type: 'text', text: '[' + f.n + '] ' + f.name + '\n' + content })
  }
  return parts
}
