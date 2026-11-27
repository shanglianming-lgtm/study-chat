// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type Source, type Effort, efforts, localSource, normalizeEndpoint } from './library'
import { catalog, complete, credential } from './provider'
import { effortOptions, selectedEffort } from './modelSupport'

const signal = new AbortController().signal
const question = [{ role: 'user', content: 'Hello.' }]
const openai = 'https://api.openai.com/v1/responses'
const claude = 'https://api.anthropic.com/v1/messages'
const google = 'https://generativelanguage.googleapis.com'
const router = 'https://openrouter.ai'
const source = (url: string): Source => ({ id: 'test', name: 'Test', url, useKey: true, models: [] })
const response = {
  status: 'completed',
  output: [{ type: 'message', content: [{ type: 'output_text', text: 'Hello.' }] }],
}
const message = { type: 'message', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Hello.' }] }
const chat = { choices: [{ message: { content: 'Hello.' }, finish_reason: 'stop' }] }
const sse = (packets: unknown[]) => new Response(packets.map((p) => 'data: ' + JSON.stringify(p) + '\n\n').join(''), {
  headers: { 'content-type': 'text/event-stream' },
})
afterEach(() => vi.unstubAllGlobals())
describe('official provider adapters', () => {
  it.each(localSource.models)('offers five selectable presets through Max for %s', (id) => {
    const options = effortOptions(localSource, id)
    expect(options.map((e) => efforts[e])).toEqual(['default', 'Light', 'Low', 'Medium', 'High', 'Max'])
    expect(selectedEffort(localSource, id, 'default')).toBe('default')
    expect(selectedEffort(localSource, id, 'max')).toBe('max')
    expect(selectedEffort(localSource, id, 'xhigh')).toBe('max')
  })
  it.each([
    [openai, 'gpt-6.2-astra', { reasoning: { effort: 'max' } }, response],
    [claude, 'claude-opus-4-6', { output_config: { effort: 'max' } }, message],
    [router, 'openai/gpt-6.2-astra', { reasoning: { effort: 'max' } }, chat],
    [router, 'anthropic/claude-opus-4.8', { reasoning: { effort: 'max' } }, chat],
    [router, 'anthropic/claude-sonnet-4.6', { reasoning: { effort: 'max' } }, chat],
  ] as const)('sends the native max value to %s', async (url, model, fields, result) => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => Response.json(result))
    vi.stubGlobal('fetch', fetch)
    expect(effortOptions(source(url), model)).toContain('max')
    await complete(source(url), model, question, 'max', false, signal)
    expect(JSON.parse(String(fetch.mock.lastCall![1].body))).toMatchObject(fields)
  })
  it('keeps the real maximum levels of limited models and honours the OpenRouter catalogue', () => {
    const limited = { ...source(router), modelEfforts: { example: ['low', 'high'] as Effort[] } }
    expect(effortOptions(limited, 'example')).not.toContain('max')
    expect(selectedEffort(source(google), 'gemini-4-neon', 'max')).toBe('default')
    expect(selectedEffort(source(google), 'gemini-4-neon', 'xhigh')).toBe('xhigh')
  })
  it.each([
    [openai, 'gpt-6.2-astra', 'https://api.openai.com/v1/responses', { reasoning: { effort: 'high' } }, response],
    [claude, 'claude-sonnet-4-6', 'https://api.anthropic.com/v1/messages', { output_config: { effort: 'high' } }, message],
    [google, 'gemini-3-flash-preview', google + '/v1beta/openai/chat/completions', { reasoning_effort: 'high' }, chat],
    [router, 'openai/gpt-5.5', router + '/api/v1/chat/completions', { reasoning: { effort: 'high' } }, chat],
  ] as const)('sends default and an explicit level to %s', async (url, model, target, selected, result) => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => Response.json(result))
    vi.stubGlobal('fetch', fetch)
    await credential(url, 'fixture-only')
    for (const level of ['default', 'high'] as Effort[]) {
      expect((await complete(source(url), model, question, level, false, signal)).text).toEqual('Hello.')
      const [address, init] = fetch.mock.lastCall!
      expect(address).toBe(target)
      const body = JSON.parse(String(init.body))
      if (level === 'high') expect(body).toMatchObject(selected)
      else for (const key of ['reasoning', 'reasoning_effort', 'output_config', 'thinking', 'include']) expect(body).not.toHaveProperty(key)
      expect(body.input || body.messages).toEqual(question)
      const headers = new Headers(init.headers)
      expect(headers.get(url === claude ? 'x-api-key' : 'authorization')).toBe(url === claude ? 'fixture-only' : 'Bearer fixture-only')
      if (url === claude) expect(headers.get('anthropic-version')).toBe('2023-06-01')
    }
  })
  it('uses discovered model capabilities, including explicit absence and paged Claude results', async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.startsWith(router)) return Response.json({ data: [
        { id: 'custom/a', reasoning: { supported_efforts: ['high', 'low'] } },
        { id: 'custom/b', reasoning: { mandatory: true } },
      ] })
      return url.includes('after_id=') ? Response.json({ data: [{ id: 'c2' }] }) : Response.json({
        data: [{ id: 'c1', capabilities: { effort: { low: { supported: true }, high: { supported: false } } } }],
        last_id: 'c1', has_more: true,
      })
    })
    vi.stubGlobal('fetch', fetch)
    const a = { ...source(claude), ...await catalog(source(claude), signal) }
    const r = { ...source(router), ...await catalog(source(router), signal) }
    expect(a.models).toEqual(['c1', 'c2'])
    expect(effortOptions(a, 'c1')).toEqual(['default', 'low'])
    expect(effortOptions(r, 'custom/a')).toEqual(['default', 'low', 'high'])
    expect(effortOptions(r, 'custom/b')).toEqual(['default'])
    expect(effortOptions(source(google), 'gemini-3-pro-preview')).toEqual(['default', 'low', 'high'])
    expect(normalizeEndpoint(google + '/v1beta/models')).toBe(google + '/v1beta/openai/chat/completions')
  })
  it('streams Responses text and returned summaries once, and reads the final file tool', async () => {
    const file = { type: 'function_call', name: 'write_document', arguments: '{"filename":"a.txt","content":"abc"}' }
    const final = { ...response, output: [...response.output, { type: 'reasoning', summary: [{ type: 'summary_text', text: 'Short.' }] }, file] }
    vi.stubGlobal('fetch', vi.fn(async () => sse([
      { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: 'Hello.' },
      { type: 'response.reasoning_summary_text.delta', output_index: 1, summary_index: 0, delta: 'Short.' },
      { type: 'response.completed', response: final },
    ])))
    const note = vi.fn(), ink = vi.fn()
    const got = await complete(source(openai), 'gpt-5.5', question, 'default', true, signal, { note, ink }, true)
    expect(got).toMatchObject({ text: 'Hello.', files: [{ name: 'a.txt', content: 'abc' }] })
    expect(ink.mock.calls).toEqual([['Hello.']])
    expect(note.mock.calls).toEqual([['思路摘要', 'Short.']])
  })
  it('reads Gemini’s native paged catalogue with its key in a header and selects generative models', async () => {
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      expect(new Headers(init.headers).get('x-goog-api-key')).toBe('sample-key')
      expect(url).toMatch(/^https:\/\/generativelanguage.googleapis.com\/v1beta\/models/)
      expect(url).not.toContain('sample-key')
      if (url.endsWith('?pageToken=next')) return Response.json({ models: [{ name: 'models/gemini-b', supportedGenerationMethods: ['generateContent'] }] })
      return Response.json({ models: [
        { name: 'models/gemini-a', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/embedding', supportedGenerationMethods: ['embedContent'] },
      ], nextPageToken: 'next' })
    })
    vi.stubGlobal('fetch', fetch)
    await credential(google, 'sample-key')
    expect((await catalog(source(google), signal)).models).toEqual(['gemini-a', 'gemini-b'])
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it('handles Claude text and split tool input without exposing signatures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sse([
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'OK' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'signature_delta', signature: 'opaque' } },
      { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', name: 'write_document', input: {} } },
      { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"filename":"one.txt",' } },
      { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '"content":"ok"}' } },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' } }, { type: 'message_stop' },
    ])))
    const note = vi.fn()
    const result = await complete(source(claude), 'claude-sonnet-4-6', question, 'default', true, signal, { note }, true)
    expect(result).toMatchObject({ text: 'OK', files: [{ name: 'one.txt', content: 'ok' }] })
    expect(note).not.toHaveBeenCalled()
  })
  it.each([claude, google, router, openai])('checks text and opaque attachments before sending to %s', async (url) => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    for (const content of ['旧记录中的想法', 'private_reasoning', 'includeThoughts', [{ type: 'text', text: 'Chain-of-thought' }], [{ type: 'file', file: { filename: 'raw.pdf' } }]]) {
      await expect(complete(source(url), 'test', [{ role: 'system', content }], 'default', false, signal)).rejects.toThrow('本机')
    }
    expect(fetch).not.toHaveBeenCalled()
  })
})
