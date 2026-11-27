// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
const transport = vi.hoisted(() => ({ invoke: vi.fn(), channels: [] as Array<{ onmessage: (event: unknown) => void }> }))
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: transport.invoke, Channel: class { onmessage = (_: unknown) => {}; constructor() { transport.channels.push(this) } } }))
import { useChat, type ChatSnapshot } from './chat'
let chat: ReturnType<typeof useChat>, root: Root
const provider = { name: 'synthetic', endpoint: 'http://127.0.0.1:8088/v1/chat/completions', model: 'test', useKey: false }
const snapshot = (): ChatSnapshot => ({ projectId: 'book-1', conversationId: 'conversation-1', provider, hasKey: false, draft: 'restored draft', messages: [{ id: 'u0', role: 'user', content: 'old question', status: 'complete' }] })
function Harness() { chat = useChat(); return null }
async function mount() { await act(async () => { root.render(<Harness />) }) }
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  transport.channels.length = 0
  transport.invoke.mockReset().mockImplementation(async (command: string) => command === 'chat_load' ? snapshot() : undefined)
  root = createRoot(document.createElement('div'))
})
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals() })
describe('desktop chat lifecycle', () => {
  it('restores the same history and draft without a key in the WebView', async () => {
    await mount(); expect(chat.ready).toBe(true); expect(chat.demo).toBe(false); expect(chat.draft).toBe('restored draft'); expect(chat.messages[0].content).toBe('old question'); expect(Object.keys(chat)).not.toContain('key')
  })
  it('serializes draft writes before send and renders the durable final response', async () => {
    await mount()
    await act(async () => { chat.setDraft('one'); chat.setDraft('two') })
    let complete: () => void = () => {}
    transport.invoke.mockImplementation((command: string) => command === 'chat_send' ? new Promise<void>(resolve => { complete = resolve }) : Promise.resolve(command === 'chat_load' ? snapshot() : undefined))
    let sending: Promise<void>
    await act(async () => { sending = chat.send() })
    expect(chat.busy).toBe(true)
    const commands = transport.invoke.mock.calls.map(([command]) => command)
    expect(commands.slice(-3)).toEqual(['chat_draft', 'chat_draft', 'chat_send'])
    const channel = transport.channels.at(-1)!
    await act(async () => { channel.onmessage({ kind: 'started', user: { id: 'u1', role: 'user', content: 'two', status: 'complete' }, assistant: { id: 'a1', role: 'assistant', content: '', status: 'streaming' } }); channel.onmessage({ kind: 'delta', id: 'a1', content: '你好' }) })
    expect(chat.stream).toBe('你好'); expect(chat.draft).toBe(''); expect(chat.canStop).toBe(true)
    await act(async () => { chat.setDraft('next thought'); channel.onmessage({ kind: 'finished', message: { id: 'a1', role: 'assistant', content: '你好', status: 'complete' } }); complete(); await sending! })
    expect(chat.busy).toBe(false); expect(chat.stream).toBeNull(); expect(chat.messages.at(-1)?.content).toBe('你好'); expect(chat.draft).toBe('next thought')
  })
  it('preserves input when setup or network command fails before starting', async () => {
    await mount(); transport.invoke.mockImplementation(async (command: string) => { if (command === 'chat_send') throw '请设置 API key'; return command === 'chat_load' ? snapshot() : undefined })
    await act(async () => { await chat.send() })
    expect(chat.draft).toBe('restored draft'); expect(chat.error).toBe('请设置 API key'); expect(chat.busy).toBe(false)
  })
  it('sends cancellation for the active request and retains partial failed text', async () => {
    await mount(); let complete: () => void = () => {}
    transport.invoke.mockImplementation((command: string) => command === 'chat_send' ? new Promise<void>(resolve => { complete = resolve }) : Promise.resolve())
    let sending: Promise<void>; await act(async () => { sending = chat.send() })
    const channel = transport.channels.at(-1)!
    await act(async () => { channel.onmessage({ kind: 'started', user: { id: 'u1', role: 'user', content: 'q', status: 'complete' }, assistant: { id: 'a1', role: 'assistant', content: '', status: 'streaming' } }); await chat.stop() })
    const requestId = transport.invoke.mock.calls.find(([c]) => c === 'chat_send')![1].requestId
    expect(transport.invoke).toHaveBeenCalledWith('chat_cancel', { requestId })
    await act(async () => { channel.onmessage({ kind: 'finished', message: { id: 'a1', role: 'assistant', content: 'partial', status: 'cancelled', error: '已停笔' } }); complete(); await sending! })
    expect(chat.messages.at(-1)?.content).toBe('partial'); expect(chat.error).toBe('已停笔'); expect(chat.busy).toBe(false)
  })
  it('isolates demonstration state and restores persistent history when returning', async () => {
    await mount(); await act(async () => { await chat.switchDemo(true); chat.setDraft('demo text') }); expect(chat.demo).toBe(true)
    expect(transport.invoke.mock.calls.some(([c,args]) => c === 'chat_draft' && args.draft === 'demo text')).toBe(false)
    await act(async () => { await chat.switchDemo(false) }); expect(chat.messages[0].content).toBe('old question'); expect(chat.draft).toBe('restored draft')
  })
  it('flushes drafts before opening native export and reports its result', async () => {
    await mount(); transport.invoke.mockImplementation(async (c: string) => c === 'chat_export' ? 'C:\\Exports\\chat.md' : undefined)
    await act(async () => { chat.setDraft('export me'); await chat.exportChat() })
    expect(transport.invoke.mock.calls.slice(-2).map(([c]) => c)).toEqual(['chat_draft', 'chat_export']); expect(chat.notice).toContain('chat.md')
  })
})
