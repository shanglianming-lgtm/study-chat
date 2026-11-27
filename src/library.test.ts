// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  newVolume,
  normalizeEndpoint,
  numberFiles,
  settingAllowed,
  importEarlier,
  efforts,
  type Effort,
} from './library'
import { complete, discover, effortFields, sseReader } from './provider'
import { setType } from './paperType'

describe('model choices in a bound volume', () => {
  it('keeps assignments and prompts independent for each book', () => {
    const a = newVolume('A'),
      b = newVolume('B')
    const pick = a.allowed[1]
    expect(settingAllowed(a, [pick])).toEqual({
      allowed: [pick],
      main: pick,
      summary: pick,
      decision: pick,
    })
    expect(settingAllowed(a, []).main).toBe('')
    expect(b.main).toBe(b.allowed[0])
    expect(b.id).not.toBe(a.id)
  })
  it('imports an existing transcript and scopes its native endpoint', () => {
    const s = importEarlier({
      projectId: 'book-1',
      conversationId: 'conversation-1',
      draft: 'keep',
      hasKey: true,
      provider: {
        name: 'Old',
        endpoint: 'https://example.com/v1/chat/completions',
        model: 'original',
        useKey: true,
      },
      messages: [
        { id: 'q', role: 'user', content: 'My heading?', status: 'complete' },
        { id: 'a', role: 'assistant', content: 'Existing text.', status: 'complete' },
      ],
    })
    expect(s.books[0]).toMatchObject({
      draft: 'keep',
      main: 'original:original',
      turns: [{ q: 'My heading?', a: 'Existing text.', state: 'done' }],
    })
  })
  it('reuses citation numbers for the same file and for a rewritten document', () => {
    const book = newVolume('Files')
    const f = { id: 'f', name: 'note.md', mime: 'text/markdown', size: 12, n: 2 }
    book.serial = 3
    book.pending = [f]
    expect(numberFiles(book, [f])).toMatchObject({ serial: 3, refs: [{ n: 2 }] })
    expect(numberFiles(book, [{ ...f, id: 'updated' }], [f])).toMatchObject({ serial: 3, refs: [{ n: 2 }] })
  })
  it('normalizes complete, base and versioned addresses before looking up credentials', () => {
    const ep = 'https://example.com/api/v1/chat/completions'
    for (const path of ['/api/v1/', '/api/v1/models', '/api/v1/chat/completions'])
      expect(normalizeEndpoint('https://example.com' + path)).toBe(ep)
    expect(normalizeEndpoint('http://localhost:8787')).toBe('http://localhost:8787/v1/chat/completions')
    expect(() => normalizeEndpoint('https://name:secret@example.com')).toThrow()
  })
  it.each(Object.keys(efforts) as Effort[])(
    'serializes %s consistently across the two request formats',
    (effort) => {
      const plain = effortFields('https://example.com/v1/chat/completions', effort)
      const router = effortFields('https://openrouter.ai/api/v1/chat/completions', effort)
      expect(plain).toEqual(effort === 'default' ? {} : { reasoning_effort: effort })
      expect(router).toEqual(effort === 'default' ? {} : { reasoning: { effort } })
    }
  )
})
describe('paper type', () => {
  function render(text: string, user = false, refs: number[] = []) {
    const el = document.createElement('div')
    el.innerHTML = setType(text, user, 0, new Set(refs), false)
    return el
  }
  it('gives a one-sentence reply both interactions and a question only its end action', () => {
    expect(render('Only one sentence.').querySelector('[data-ink="both"]')?.textContent).toBe(
      'Only one sentence.'
    )
    expect(render('一问。', true).querySelector('[data-ink="actions"]')?.textContent).toBe('一问。')
  })
  it('keeps print emphasis, separately clickable references, and source text', () => {
    const el = render('Read *these words*. Another line [3]. Last sentence.', false, [3])
    expect(el.querySelector('em [data-ink="process"]')?.textContent).toContain('these words')
    expect(el.querySelector('[data-ref="3"]')?.textContent).toBe('[3]')
    expect(el.querySelector('[data-ink="actions"]')?.textContent).toBe('Last sentence.')
    expect(el.textContent).toBe('Read these words. Another line [3]. Last sentence.\n')
  })
})
describe('provider communication', () => {
  afterEach(() => vi.unstubAllGlobals())
  const source = {
    id: 'qa',
    name: 'qa',
    url: 'http://127.0.0.1:8787/v1',
    models: ['sample'],
    useKey: false,
  }
  it('discovers via GET and only includes the selected effort on generation', async () => {
    let body: Record<string, unknown> = {}
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        if (init.method === 'GET') return Response.json({ data: [{ id: 'sample' }, { id: 'sample' }] })
        body = JSON.parse(String(init.body))
        return Response.json({ choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] })
      })
    )
    const signal = new AbortController().signal
    expect(await discover(source, signal)).toEqual(['sample'])
    await complete(source, 'sample', [], 'default', false, signal)
    expect(body).not.toHaveProperty('reasoning_effort')
    await complete(source, 'sample', [], 'xhigh', true, signal)
    expect(body.reasoning_effort).toBe('xhigh')
  })
  it('reads split SSE lines and only surfaces explicitly public reasoning summaries', async () => {
    const events: string[] = []
    const read = sseReader((s) => events.push(s))
    read('data: 一\r')
    read('\ndata: 二\r\n\r\n')
    expect(events).toEqual(['一\n二'])
    const packet = {
      choices: [
        {
          delta: {
            content: 'Hello.',
            reasoning: 'private',
            reasoning_content: 'private',
            reasoning_details: [{ type: 'reasoning.summary', summary: 'Public summary' }],
          },
        },
      ],
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('data: ' + JSON.stringify(packet) + '\r\n\r\ndata: [DONE]\r\n\r\n', {
            headers: { 'content-type': 'text/event-stream' },
          })
      )
    )
    const notes = vi.fn()
    const answer = await complete(source, 'sample', [], 'minimal', true, new AbortController().signal, {
      note: notes,
    })
    expect(answer.text).toBe('Hello.')
    expect(notes.mock.calls).toEqual([['思路摘要', 'Public summary']])
  })
})
