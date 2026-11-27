import { useEffect, useRef, useState, type ReactNode } from 'react'
import { desktop, type Provider, type useChat } from './chat'
import './chat.css'
type Chat = ReturnType<typeof useChat>
export default function ChatSettings({ chat, close, children }: { chat: Chat; close: () => void; children?: ReactNode }) {
  const [provider, setProvider] = useState<Provider>(chat.provider || { name: '', endpoint: '', model: '', useKey: true })
  const [key, setKey] = useState(''), [error, setError] = useState(''), [saving, setSaving] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; dialog.current?.showModal(); return () => { if (previous?.isConnected) previous.focus() } }, [])
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setError(''); setSaving(true)
    const secret = key; setKey('')
    try { await chat.configure(provider, secret || undefined); close() }
    catch (failure) { setError(typeof failure === 'string' ? failure : '保存失败，请重试。') }
    finally { setSaving(false) }
  }
  return <dialog ref={dialog} className="chat-settings" aria-label="对话设置" onCancel={event => { event.preventDefault(); if (!saving) close() }}>
    <form onSubmit={save}>
      <header><h2>对话设置</h2><button type="button" onClick={close} disabled={saving} aria-label="关闭对话设置">关闭</button></header>
      <p>{desktop ? '真实对话保存在本机。只有发送时才会连接下方保存的地址。' : '网页预览仅提供本地演示；真实对话与凭据需在 Tauri 桌面窗口使用。'}</p>
      {chat.demo && children}
      {desktop && <>
        <label><input type="checkbox" checked={chat.demo} disabled={chat.busy || saving} onChange={e => { void chat.switchDemo(e.target.checked) }} />本地演示（不调用服务商，不写入真实对话）</label>
        <fieldset disabled={chat.busy || saving}>
          <label>服务商名称<input autoFocus required value={provider.name} onChange={e => setProvider({ ...provider, name: e.target.value })} maxLength={200} /></label>
          <label>完整请求地址<input type="url" required placeholder="https://你的服务商/v1/chat/completions" value={provider.endpoint} onChange={e => setProvider({ ...provider, endpoint: e.target.value })} /></label>
          <small>填写完整 /chat/completions 地址，不自动补 /v1；拒绝重定向。本机测试可用 http://127.0.0.1。</small>
          <label>模型 ID<input required value={provider.model} onChange={e => setProvider({ ...provider, model: e.target.value })} maxLength={200} /></label>
          <label><input type="checkbox" checked={provider.useKey} onChange={e => setProvider({ ...provider, useKey: e.target.checked })} />使用 API key</label>
          <label>API key<input type="password" autoComplete="new-password" value={key} onChange={e => setKey(e.target.value)} placeholder={chat.hasKey && provider.endpoint === chat.provider?.endpoint ? '已保存到系统凭据库；留空保持不变' : '仅在系统凭据库保存'} /></label>
          <small>凭据按请求地址隔离；更换地址不会自动带上旧 key。保存后清空输入框，不回显 key。</small>
          <button type="submit">{saving ? '正在保存…' : '保存设置'}</button>
          <button type="button" disabled={!chat.hasKey} onClick={() => { setSaving(true); void chat.forgetKey().catch(failure => setError(String(failure))).finally(() => setSaving(false)) }}>删除已保存地址的凭据</button>
        </fieldset>
      </>}
      {error && <p role="alert">{error}</p>}
    </form>
  </dialog>
}
