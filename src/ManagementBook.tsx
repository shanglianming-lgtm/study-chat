import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, Plus, X, Radio } from 'lucide-react'
import {
  localSource,
  native,
  normalizeEndpoint,
  refFor,
  settingAllowed,
  errorText,
  type Library,
  type Source,
  type Volume,
} from './library'
import { addBook, chooseBook, editVolume, exportVolume, refreshModule, saveSource } from './shelfStore'
import { credential, catalog, testKey } from './provider'

export function ModelOptions({ library, book }: { library: Library; book: Volume }) {
  return (
    <>
      {library.providers.map((p) => {
        const ids = p.models.filter((m) => book.allowed.includes(refFor(p.id, m)))
        return ids.length ? (
          <optgroup key={p.id} label={p.name}>
            {ids.map((m) => (
              <option key={m} value={refFor(p.id, m)}>
                {m}
              </option>
            ))}
          </optgroup>
        ) : null
      })}
    </>
  )
}
function BookSettings({ library, book }: { library: Library; book: Volume }) {
  const [filter, setFilter] = useState(''),
    [notice, setNotice] = useState(''),
    [working, setWorking] = useState(false)
  const change = (patch: Partial<Volume>) => editVolume(book.id, patch)
  return (
    <div className="eink-section">
      <details className="ink-disclosure" open>
        <summary>
          可用模型 <span>{book.allowed.length}</span>
        </summary>
        <input
          type="search"
          aria-label="筛选模型"
          placeholder="筛选模型"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <div className="allow-models">
          {library.providers.map((p) => (
            <fieldset key={p.id}>
              <legend>{p.name}</legend>
              {p.models
                .filter((m) => (m + ' ' + p.name).toLowerCase().includes(filter.toLowerCase()))
                .map((m) => {
                  const key = refFor(p.id, m)
                  return (
                    <label key={m}>
                      <input
                        type="checkbox"
                        checked={book.allowed.includes(key)}
                        onChange={(e) =>
                          change(
                            settingAllowed(
                              book,
                              e.target.checked
                                ? [...book.allowed, key]
                                : book.allowed.filter((r) => r !== key)
                            )
                          )
                        }
                      />
                      {m}
                    </label>
                  )
                })}
            </fieldset>
          ))}
        </div>
      </details>
      {(['main', 'summary', 'decision'] as const).map((role, i) => (
        <label className="eink-row" key={role}>
          <span>{['默认对话模型', '标题与总结模型', '决策小模型'][i]}</span>
          <select value={book[role]} onChange={(e) => change({ [role]: e.target.value })}>
            {!book.allowed.length && <option value="">选择可用模型</option>}
            <ModelOptions library={library} book={book} />
          </select>
        </label>
      ))}
      <details className="ink-disclosure">
        <summary>小模型提示词</summary>
        <label>
          标题与总结
          <textarea
            value={book.summaryPrompt}
            onChange={(e) => change({ summaryPrompt: e.target.value })}
          />
        </label>
        <label>
          资料与 Skill 决策
          <textarea
            value={book.decisionPrompt}
            onChange={(e) => change({ decisionPrompt: e.target.value })}
          />
        </label>
      </details>
      <details className="ink-disclosure">
        <summary>记忆与读者档案</summary>
        {(['memory', 'profile'] as const).map((field) => (
          <div key={field}>
            <label>
              {field === 'memory' ? 'Memory 原文' : 'Profile 原文'}
              <textarea value={book[field]} onChange={(e) => change({ [field]: e.target.value })} />
            </label>
            <button
              disabled={working}
              onClick={async () => {
                setWorking(true)
                setNotice('')
                try {
                  await refreshModule(book.id, field)
                  setNotice('左页摘要已更新')
                } catch (e) {
                  setNotice(errorText(e))
                } finally {
                  setWorking(false)
                }
              }}
            >
              用总结模型重写摘要
            </button>
          </div>
        ))}
      </details>
      {notice && <p role="status">{notice}</p>}
    </div>
  )
}
function emptySource(): Source {
  return { id: crypto.randomUUID(), name: '', url: '', models: [], useKey: true }
}
function ProviderForm({ value, library, done }: { value: Source; library: Library; done: () => void }) {
  const [source, setSource] = useState(() => ({ ...value, url: value.url.replace(/\/chat\/completions\/?$/, '') })),
    [key, setKey] = useState(''),
    [hasKey, setHasKey] = useState(false)
  const [manual, setManual] = useState(''),
    [selected, setSelected] = useState(value.models[0] || ''),
    [status, setStatus] = useState(''),
    [testing, setTesting] = useState(false)
  const query = useRef<AbortController | null>(null),
    test = useRef<AbortController | null>(null),
    last = useRef(''),
    alive = useRef(true)
  useEffect(() => {
    alive.current = true
    if (value.url)
      void credential(value.url)
        .then((v) => {
          if (alive.current) setHasKey(v)
        })
        .catch(() => {})
    return () => {
      alive.current = false
      query.current?.abort()
      test.current?.abort()
    }
  }, [value.id])
  function address() {
    const url = normalizeEndpoint(source.url)
    return { ...source, url, name: source.name.trim() || new URL(url).hostname }
  }
  async function lookup(force = false) {
    if (!source.url.trim()) return
    let next: Source
    try {
      next = address()
    } catch (e) {
      if (force) setStatus(errorText(e))
      return
    }
    if (!force && last.current === next.url) return
    query.current?.abort()
    const controller = new AbortController()
    query.current = controller
    last.current = next.url
    setStatus('正在读取模型目录…')
    try {
      const { models: ids, modelEfforts } = await catalog(next, controller.signal)
      if (controller.signal.aborted) return
      setSource((s) => ({ ...s, models: [...new Set([...s.models, ...ids])], modelEfforts: { ...s.modelEfforts, ...modelEfforts } }))
      setSelected((s) => s || ids[0] || '')
      setStatus('目录中有 ' + ids.length + ' 个模型')
    } catch (e) {
      if (!controller.signal.aborted) setStatus(errorText(e))
    }
  }
  function addManual() {
    const ids = manual
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
    if (!ids.length) return
    setSource((s) => ({ ...s, models: [...new Set([...s.models, ...ids])] }))
    setSelected((s) => s || ids[0])
    setManual('')
  }
  async function saveKey() {
    const next = address()
    if (key.trim()) {
      setHasKey(await credential(next.url, key))
      setKey('')
    }
  }
  async function save() {
    try {
      const next = address()
      await saveKey()
      const extra = manual
        .split(/[,\n]/)
        .map((m) => m.trim())
        .filter(Boolean)
      next.models = [...new Set([...next.models, ...extra])]
      if (!next.models.length) throw new Error('请读取模型目录或填写一个模型 ID。')
      const existing = library.providers.find((p) => p.url === next.url)
      next.id = existing?.id || (value.url && next.url !== value.url ? crypto.randomUUID() : source.id)
      saveSource(next)
      done()
    } catch (e) {
      setStatus(errorText(e))
    }
  }
  return (
    <div className="eink-section">
      <h2>{value.url ? value.name : 'New provider'}</h2>
      <label>
        名称
        <input
          value={source.name}
          onChange={(e) => setSource({ ...source, name: e.target.value })}
          placeholder="提供商名称"
        />
      </label>
      <label>
        服务地址
        <input
          type="url"
          list="official-model-services"
          value={source.url}
          onChange={(e) => {
            query.current?.abort()
            last.current = ''
            setStatus('')
            setKey('')
            setHasKey(false)
            setSelected('')
            setSource({ ...source, url: e.target.value, models: [], modelEfforts: {} })
          }}
          onBlur={() => void lookup()}
          placeholder="https://…/v1"
        />
        <datalist id="official-model-services">
          <option value="https://api.openai.com/v1">OpenAI</option>
          <option value="https://api.anthropic.com/v1">Anthropic</option>
          <option value="https://generativelanguage.googleapis.com/v1beta/openai">Google Gemini</option>
          <option value="https://openrouter.ai/api/v1">OpenRouter</option>
        </datalist>
      </label>
      <label className="eink-check">
        <input
          type="checkbox"
          checked={source.useKey}
          onChange={(e) => setSource({ ...source, useKey: e.target.checked })}
        />
        使用 API Key
      </label>
      {source.useKey && (
        <label>
          API Key
          <input
            type="password"
            autoComplete="new-password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={hasKey ? '此地址已有凭据' : native ? '保存于系统凭据库' : '仅在当前网页会话中使用'}
          />
        </label>
      )}
      <div className="eink-actions">
        <button
          onClick={async () => {
            try {
              await saveKey()
              await lookup(true)
            } catch (e) {
              setStatus(errorText(e))
            }
          }}
        >
          读取模型目录
        </button>
        {hasKey && (
          <button
            onClick={async () => {
              try {
                await credential(address().url, undefined, true)
                setHasKey(false)
                setKey('')
                setStatus('已清除该地址的凭据')
              } catch (e) {
                setStatus(errorText(e))
              }
            }}
          >
            清除此地址的 Key
          </button>
        )}
      </div>
      <label>
        手动添加模型 ID
        <span className="inline-field">
          <input
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addManual()
              }
            }}
          />
          <button onClick={addManual} aria-label="添加模型">
            <Plus size={15} />
          </button>
        </span>
      </label>
      <label>
        测试模型
        <select value={selected} onChange={(e) => setSelected(e.target.value)}>
          {!source.models.length && <option value="">待选择</option>}
          {source.models.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
      </label>
      <div className="eink-actions">
        <button
          disabled={testing || !selected}
          onClick={async () => {
            setTesting(true)
            setStatus('等待模型回复…')
            const controller = new AbortController()
            test.current = controller
            try {
              const next = address()
              await saveKey()
              const msg = await testKey(
                next,
                selected,
                AbortSignal.any([controller.signal, AbortSignal.timeout(60000)])
              )
              if (!controller.signal.aborted) setStatus(selected + ' · ' + msg)
            } catch (e) {
              if (!controller.signal.aborted) setStatus(errorText(e))
            } finally {
              if (alive.current) setTesting(false)
            }
          }}
        >
          <Radio size={14} /> 测试响应
        </button>
        <button className="ink-primary" onClick={() => void save()}>
          保存提供商
        </button>
      </div>
      {status && (
        <p className="eink-status" role="status">
          {status}
        </p>
      )}
    </div>
  )
}
export default function ManagementBook({ library, onClose, singlePage, setSinglePage }: {
  library: Library
  onClose: () => void
  singlePage: boolean
  setSinglePage: (enabled: boolean) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    [tab, setTab] = useState<'books' | 'providers'>('books'),
    [provider, setProvider] = useState<Source | null>(null)
  const [newName, setNewName] = useState(''),
    [adding, setAdding] = useState(false)
  useEffect(() => {
    const d = dialog.current!,
      previous = document.activeElement as HTMLElement | null
    d.showModal()
    return () => {
      d.close()
      previous?.focus({ preventScroll: true })
    }
  }, [])
  const book = library.books.find((b) => b.id === library.selected) || library.books[0]
  return (
    <dialog
      ref={dialog}
      className="management-book"
      aria-label="管理书"
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
      <div className="eink-glass">
        <header className="eink-mast">
          <div>
            <i />
            Library Register
          </div>
          <button aria-label="合上管理书" onClick={onClose}>
            <X size={17} />
          </button>
        </header>
        <nav className="eink-tabs">
          {(['books', 'providers'] as const).map((t, i) => (
            <button
              key={t}
              aria-current={tab === t ? 'page' : undefined}
              onClick={() => {
                setTab(t)
                setProvider(null)
              }}
            >
              {['书目', '提供商'][i]}
            </button>
          ))}
        </nav>
        <div className="eink-scroll">
          {tab === 'books' ? (
            <>
              <div className="book-switch">
                {library.books.length === 1 ? (
                  <h2>{book.name}</h2>
                ) : (
                  <select
                    aria-label="选择要管理的书"
                    value={book.id}
                    onChange={(e) => chooseBook(e.target.value)}
                  >
                    {library.books.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                )}
                <button onClick={() => setAdding(!adding)} aria-label="新增书籍">
                  <Plus size={17} />
                </button>
              </div>
              {adding && (
                <form
                  className="inline-field"
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (addBook(newName)) {
                      setNewName('')
                      setAdding(false)
                    }
                  }}
                >
                  <input
                    autoFocus
                    aria-label="新书名称"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                  />
                  <button>建书</button>
                </form>
              )}
              <BookSettings key={book.id} library={library} book={book} />
              <div className="eink-section">
                <label className="eink-check">
                  <input type="checkbox" checked={singlePage} onChange={(e) => setSinglePage(e.target.checked)} />
                  单页阅读
                </label>
                <button onClick={() => exportVolume(book)}>导出本书对话</button>
              </div>
            </>
          ) : provider ? (
            <>
              <button className="provider-back" onClick={() => setProvider(null)}>
                <ChevronLeft size={14} /> 提供商
              </button>
              <ProviderForm
                key={provider.id}
                library={library}
                value={provider}
                done={() => setProvider(null)}
              />
            </>
          ) : (
            <div className="eink-section">
              <h2>Providers</h2>
              {library.providers.map((p) => (
                <button
                  className="provider-line"
                  disabled={p.id === localSource.id}
                  key={p.id}
                  onClick={() => setProvider(p)}
                >
                  <span>{p.name}</span>
                  <small>{p.models.length} 个模型</small>
                </button>
              ))}
              <button className="eink-add" onClick={() => setProvider(emptySource())}>
                <Plus size={15} /> 添加提供商
              </button>
            </div>
          )}
        </div>
      </div>
    </dialog>
  )
}
