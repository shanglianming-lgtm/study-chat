import type { Events, ReturnedFile, WireMessage } from './provider'

type Json = Record<string, any>
type Request = (body: Json, onData: (data: string) => void) => Promise<Json | null>
export const fileTool = {
  name: 'write_document',
  description: 'Return a downloadable UTF-8 text document to the reader.',
  parameters: {
    type: 'object',
    properties: { filename: { type: 'string' }, content: { type: 'string' } },
    required: ['filename', 'content'],
    additionalProperties: false,
  },
}

export function outputFile(name: string, args: Json, files: ReturnedFile[], enabled: boolean, events: Events) {
  if (!enabled || name !== fileTool.name) {
    events.note?.('工具请求', name + '（未执行）')
    return
  }
  if (typeof args.filename !== 'string' || typeof args.content !== 'string') throw new Error('生成文件的格式无效。')
  files.push({ name: args.filename.replace(/^.*[\\/]/, ''), content: args.content, mime: 'text/plain;charset=utf-8' })
}

export async function nativeCompletion(
  api: 'openai' | 'anthropic', model: string, messages: WireMessage[], fields: Json, stream: boolean,
  events: Events, writeFile: boolean, request: Request
) {
  const result = { text: '', files: [] as ReturnedFile[] }
  const ink = (s?: string) => {
    if (!s) return
    result.text += s
    events.ink?.(s)
  }
  const note = (s?: string) => { if (s) events.note?.('思路摘要', s) }
  const plain = messages.map(({ role, content }) => ({
    role,
    content: typeof content === 'string' ? content : content.map((part) => {
      if (part.type !== 'text' || typeof part.text !== 'string') throw new Error('附件内容无法在本机核对。')
      return part.text
    }).join('\n\n'),
  }))
  let ended = false
  if (api === 'openai') {
    const body: Json = { model, input: plain, stream, store: false, ...fields }
    if (writeFile) body.tools = [{ type: 'function', ...fileTool }]
    const textSeen = new Set<string>(), summarySeen = new Set<string>()
    function finished(response: Json) {
      if (response.status !== 'completed') throw new Error('回应提前结束 · ' + (response.status || '未知状态'))
      for (const [i, item] of (response.output || []).entries()) {
        if (item.type === 'message') for (const [j, p] of (item.content || []).entries()) {
          if (!textSeen.has(i + '/' + j)) {
            if (p.type === 'output_text') ink(p.text)
            else if (p.type === 'refusal') ink(p.refusal)
          }
        }
        if (item.type === 'reasoning') for (const [j, p] of (item.summary || []).entries())
          if (p.type === 'summary_text' && !summarySeen.has(i + '/' + j)) note(p.text)
        if (item.type === 'function_call') outputFile(item.name, JSON.parse(item.arguments), result.files, writeFile, events)
      }
      ended = true
    }
    const json = await request(body, (data) => {
      if (data.trim() === '[DONE]') return
      const p = JSON.parse(data)
      switch (p.type) {
        case 'response.output_text.delta':
        case 'response.refusal.delta':
          textSeen.add(p.output_index + '/' + p.content_index)
          ink(p.delta)
          break
        case 'response.reasoning_summary_text.delta':
          summarySeen.add(p.output_index + '/' + p.summary_index)
          note(p.delta)
          break
        case 'response.completed':
          finished(p.response)
          break
        case 'response.incomplete':
        case 'response.failed':
        case 'error': throw new Error('服务商未能完成本轮回应。')
      }
    })
    if (json) finished(json)
  } else {
    const body: Json = {
      model, stream, max_tokens: /claude-3/.test(model) ? 4096 : 16384,
      messages: plain.filter((m) => m.role !== 'system'), ...fields,
    }
    const system = plain.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')
    if (system) body.system = system
    if (writeFile) body.tools = [{ name: fileTool.name, description: fileTool.description, input_schema: fileTool.parameters }]
    const summarized = /^claude-(opus|sonnet|haiku|fable|mythos)-(4|5|preview)/.test(model)
    const calls = new Map<number, { name: string; json: string; input: Json }>()
    const checkStop = (reason: string) => {
      if (!['end_turn', 'stop_sequence', 'tool_use', 'refusal'].includes(reason)) throw new Error('回应提前结束 · ' + reason)
    }
    function block(p: Json, index: number) {
      if (p.type === 'text') ink(p.text)
      else if (p.type === 'thinking' && summarized) note(p.thinking)
      else if (p.type === 'tool_use') calls.set(index, { name: p.name, json: '', input: p.input || {} })
    }
    const json = await request(body, (data) => {
      const p = JSON.parse(data)
      switch (p.type) {
        case 'error': throw new Error('服务商在生成过程中返回错误。')
        case 'content_block_start':
          block(p.content_block, p.index)
          break
        case 'content_block_delta':
          if (p.delta.type === 'text_delta') ink(p.delta.text)
          if (p.delta.type === 'thinking_delta' && summarized) note(p.delta.thinking)
          if (p.delta.type === 'input_json_delta') {
            const call = calls.get(p.index)
            if (call) call.json += p.delta.partial_json
          }
          break
        case 'message_delta':
          if (p.delta.stop_reason) checkStop(p.delta.stop_reason)
          break
        case 'message_stop':
          ended = true
          break
      }
    })
    if (json) {
      if (json.type !== 'message') throw new Error('服务商没有返回有效的消息。')
      json.content.forEach(block)
      checkStop(json.stop_reason)
      ended = true
    }
    if (ended) for (const call of calls.values())
      outputFile(call.name, call.json ? JSON.parse(call.json) : call.input, result.files, writeFile, events)
  }
  if (!ended) throw new Error('回应流中断，已收到的文字已保留。')
  return result
}
