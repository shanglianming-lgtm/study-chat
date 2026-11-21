import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, ArrowUp, BookOpen, Check, ChevronDown, Feather, List, LoaderCircle, PanelLeftClose, PenLine, Square, X } from 'lucide-react'
import Room from './Room'
import { BOOK_TITLE, conversationSections, mockReply, sections, type Message } from './content'
import { isHttpUrl, pageForSection, paginate, safeMarkdown, shouldSend, turnPage, type BookPage } from './book'

function SourceCard() {
  return <aside className="source-card"><span className="source-icon">↗</span><div><strong>关于思考与书写的阅读笔记 <small>演示</small></strong><p>模拟来源 · 未访问或抓取任何网页</p></div></aside>
}

function Cover() {
  return <div className="book-cover"><span className="cover-edition">书 房 文 库 / 001</span><div className="cover-line" /><div className="cover-title">与自己的<br />漫长对话</div><p>A LONG CONVERSATION<br />WITH MYSELF</p><div className="cover-art"><i /><i /><i /><span>问</span></div><div className="cover-author">你，与书房一起著</div><div className="cover-bottom">每一个问题，都是新的一页。<span>书房 Chat</span></div></div>
}

export default function App() {
  const [opened, setOpened] = useState(false)
  const [closing, setClosing] = useState(false)
  const [mode, setMode] = useState<'book' | 'notes'>('book')
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [model, setModel] = useState('书房 · 沉思')
  const [effort, setEffort] = useState('标准推理')
  const [stream, setStream] = useState<string | null>(null)
  const [pages, setPages] = useState<BookPage[]>([])
  const [pageIndex, setPageIndex] = useState(0)
  const [single, setSingle] = useState(window.innerWidth < 860)
  const [directory, setDirectory] = useState(false)
  const [notice, setNotice] = useState('')
  const [linkError, setLinkError] = useState('')
  const [metrics, setMetrics] = useState({ width: 340, height: 430 })
  const bodyRef = useRef<HTMLDivElement>(null)
  const probeRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const manuscriptRef = useRef<HTMLDivElement>(null)
  const notesEndRef = useRef<HTMLDivElement>(null)
  const composition = useRef(false)
  const streamJob = useRef<{ full: string; text: string; id: string; timer: ReturnType<typeof setInterval> } | null>(null)
  const pendingAnchor = useRef<string | null>(null)
  const currentAnchor = useRef('cover')
  const allSections = useMemo(() => [...sections, ...conversationSections(messages)], [messages])

  useEffect(() => {
    const query = window.matchMedia('(max-width: 859px)')
    const update = () => setSingle(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  useLayoutEffect(() => {
    if (!opened || mode !== 'book' || !bodyRef.current) return
    const observer = new ResizeObserver(([entry]) => {
      setMetrics({ width: Math.floor(entry.contentRect.width), height: Math.floor(entry.contentRect.height) })
    })
    observer.observe(bodyRef.current)
    return () => observer.disconnect()
  }, [opened, mode, single])

  const [fontReady, setFontReady] = useState(0)
  useEffect(() => {
    const update = () => setFontReady(value => value + 1)
    void document.fonts.ready.then(update)
    document.fonts.addEventListener('loadingdone', update)
    return () => document.fonts.removeEventListener('loadingdone', update)
  }, [])

  useEffect(() => {
    if (!closing) return
    const timer = setTimeout(() => { setOpened(false); setClosing(false) }, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 400)
    return () => clearTimeout(timer)
  }, [closing])

  useEffect(() => {
    if (!directory) return
    const previous = document.activeElement as HTMLElement | null
    const trap = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setDirectory(false); return }
      if (event.key !== 'Tab') return
      const items = Array.from(document.querySelectorAll<HTMLElement>('.directory-drawer button, .directory-drawer a[href]'))
      const first = items[0], last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', trap)
    return () => { document.removeEventListener('keydown', trap); previous?.focus() }
  }, [directory])

  useLayoutEffect(() => {
    if (!probeRef.current || metrics.width < 20 || metrics.height < 100) return
    probeRef.current.style.width = `${metrics.width}px`
    const nextPages = paginate(allSections, probeRef.current, metrics.height)
    setPages(nextPages)
    const id = pendingAnchor.current || currentAnchor.current
    const index = pageForSection(nextPages, id)
    setPageIndex(single ? index : Math.floor(index / 2) * 2)
    pendingAnchor.current = null
  }, [allSections, metrics, single, fontReady])

  const jump = useCallback((id: string) => {
    const target = pageForSection(pages, id)
    setPageIndex(single ? target : Math.floor(target / 2) * 2)
    currentAnchor.current = id
    setDirectory(false)
    setMode('book')
  }, [pages, single])

  const flip = useCallback((direction: number) => {
    setPageIndex(index => {
      const next = turnPage(index, direction, pages.length, single)
      currentAnchor.current = pages[next]?.sectionId || 'cover'
      return next
    })
  }, [pages, single])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (!opened || mode !== 'book' || directory || target.closest('input,textarea,select,button,[contenteditable="true"]') || event.isComposing) return
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); flip(event.key === 'ArrowRight' ? 1 : -1) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [opened, mode, directory, flip])

  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (textarea) { textarea.style.height = '0px'; textarea.style.height = `${Math.min(textarea.scrollHeight, 132)}px` }
  }, [draft, opened])

  useEffect(() => {
    if (manuscriptRef.current) manuscriptRef.current.scrollTop = manuscriptRef.current.scrollHeight
    if (mode === 'notes') notesEndRef.current?.scrollIntoView({ block: 'nearest' })
  }, [stream, messages, mode])

  const bind = useCallback((stopped = false) => {
    const job = streamJob.current
    if (!job) return
    clearInterval(job.timer)
    streamJob.current = null
    const text = job.text || '（本轮已停笔，尚未写下回应。）'
    pendingAnchor.current = job.id
    currentAnchor.current = job.id
    setMessages(items => [...items, { id: job.id, role: 'assistant', content: text + (stopped ? '\n\n*本轮已停笔。*' : '') }])
    setStream(null)
    setNotice(stopped ? '已停笔，现有文字已装订' : '墨迹已干，新的一轮已装订入书')
  }, [])

  useEffect(() => () => { if (streamJob.current) clearInterval(streamJob.current.timer) }, [])

  const send = () => {
    const question = draft.trim()
    if (!question || streamJob.current) return
    const id = crypto.randomUUID()
    setMessages(items => [...items, { id: `q-${id}`, role: 'user', content: question }])
    setDraft(''); setStream(''); setNotice('')
    const full = mockReply(question, model, effort)
    const job = { full, text: '', id: `a-${id}`, timer: setInterval(() => {
      job.text = job.full.slice(0, job.text.length + 9)
      setStream(job.text)
      if (job.text.length === job.full.length) bind()
    }, 44) }
    streamJob.current = job
  }

  const handleLink = async (event: React.MouseEvent) => {
    const anchor = (event.target as HTMLElement).closest('a')
    if (!anchor) return
    event.preventDefault()
    const url = anchor.getAttribute('href') || ''
    if (!isHttpUrl(url)) return
    try {
      if ('__TAURI_INTERNALS__' in window) {
        const { openUrl } = await import('@tauri-apps/plugin-opener')
        await openUrl(url)
      } else window.open(url, '_blank', 'noopener,noreferrer')
    } catch { setLinkError('未能打开链接，请检查系统默认浏览器。') }
  }

  const tocItems = allSections.filter(section => section.id !== 'cover' && section.id !== 'contents')
  const toc = (compact = false) => <div className={compact ? 'toc-list compact' : 'toc-list'}>{tocItems.map(section => <button key={section.id} onClick={() => jump(section.id)}><span>{section.title}</span><i /><b>{pageForSection(pages, section.id) + 1}</b></button>)}</div>
  const renderPage = (page: BookPage | undefined, index: number) => <article key={index === pageIndex ? 'first' : 'second'} className={`paper ${index % 2 ? 'recto' : 'verso'} ${page?.kind === 'cover' ? 'cover-paper' : ''}`} aria-label={`第 ${index + 1} 页：${page?.title || '留白'}`}>
    <header className="running-head"><span>{index % 2 ? page?.title || '留白' : BOOK_TITLE}</span><span>书房文库</span></header>
    <div className={`paper-body prose ${page?.role || ''}`} ref={index === pageIndex ? bodyRef : undefined}>
      {page?.kind === 'cover' ? <Cover /> : page?.kind === 'toc' ? <><span className="chapter-kicker">CONTENTS</span><h1>目 录</h1><p className="toc-preface">沿着问题，找到回来的路。</p>{toc(true)}</> : page ? <div dangerouslySetInnerHTML={{ __html: page.html }} /> : <div className="blank-page">下一页，留给新的想法。</div>}
    </div>
    <footer className="page-footer"><span>{String(index + 1).padStart(2, '0')}</span><i /></footer>
  </article>

  return <div className={`app ${opened ? 'reading' : 'in-room'} ${closing ? 'closing-book' : ''}`}  onClick={handleLink}>
    <header className="app-header"><a className="brand" href="#" onClick={event => { event.preventDefault(); setClosing(true) }} aria-label="回到书房"><span className="brand-symbol"><BookOpen size={22} strokeWidth={1.4} /></span><strong>书房<span>Chat</span></strong><i /><small>把思绪写成书</small></a><div className="header-right"><span className="simulation"><i /> 本地模拟 · 无需联网</span><span className="version">PROTOTYPE 01</span></div></header>
    {!opened ? <Room onOpen={() => { setOpened(true); setNotice('') }} /> : <>
      <div className="reader-toolbar"><div className="book-identity"><button className="icon-button back-room" onClick={() => setClosing(true)} aria-label="合上书，放回书架"><PanelLeftClose size={18} /></button><div><strong>{BOOK_TITLE}</strong><span>书房文库 / 001 <i /> {messages.length ? `${Math.ceil(messages.length / 2)} 轮对话` : '一本可以继续写下去的书'}</span></div></div><div className="view-switch" aria-label="阅读模式"><button className={mode === 'book' ? 'active' : ''} onClick={() => setMode('book')}><BookOpen size={15} />书页</button><button className={mode === 'notes' ? 'active' : ''} onClick={() => setMode('notes')}><PenLine size={15} />速记</button></div><button className="text-button contents-button" onClick={() => setDirectory(true)}><List size={16} />目录<span>{pages.length} 页</span></button></div>
      <main className="workspace">
        {mode === 'book' ? <div className="book-stage"><div className="spread" key={single ? 'single' : 'double'}>{renderPage(pages[pageIndex], pageIndex)}{!single && renderPage(pages[pageIndex + 1], pageIndex + 1)}<div className="book-ribbon" /></div><div className="pagination"><button className="icon-button" onClick={() => flip(-1)} disabled={pageIndex === 0} aria-label="上一页"><ArrowLeft size={17} /></button><span>第 {pageIndex + 1}{!single && pageIndex + 1 < pages.length ? `—${pageIndex + 2}` : ''} 页 <i>/</i> 共 {pages.length} 页</span><button className="icon-button" onClick={() => flip(1)} disabled={pageIndex + (single ? 1 : 2) >= pages.length} aria-label="下一页"><ArrowRight size={17} /></button></div><div className="reading-hint">{notice ? <><Check size={13} />{notice}</> : <>翻过一页，给思考一点时间。<span>← → 翻页</span></>}</div></div> : <section className="notes-view"><div className="notes-heading"><span className="chapter-kicker">FIELD NOTES</span><h1>让想法，先流动起来。</h1><p>不必整理，不必成章。这里的每一笔，也会留在书中。</p></div>{messages.length === 0 ? <div className="notes-empty"><Feather size={32} strokeWidth={1} /><h2>这一页，还没有写下什么。</h2><p>从下方写一个问题，让对话开始。</p><button className="text-button" onClick={() => { setDraft('如何给每天的思考留一点空白？'); textareaRef.current?.focus() }}>试试：如何给每天的思考留一点空白？ ↗</button></div> : messages.map(message => <article className={`note-entry ${message.role}`} key={message.id}><div className="note-label">{message.role === 'user' ? '你 / 提问' : '书房 / 模拟回应'}<button onClick={() => jump(message.id)} aria-label="在书页中阅读">在书页中阅读 ↗</button></div><div className="prose" dangerouslySetInnerHTML={{ __html: safeMarkdown(message.content) }} />{message.role === 'assistant' && <SourceCard />}</article>)}{stream !== null && <div className="notes-writing"><LoaderCircle className="spinning" size={14} /> 正在手稿纸上书写…</div>}<div ref={notesEndRef} /></section>}
      </main>
      <div className="composer-wrap"><div className="composer"><div className="composer-top"><Feather size={18} strokeWidth={1.4} /><textarea ref={textareaRef} value={draft} rows={1} placeholder="此刻，你在想什么？" aria-label="写下你的问题" onChange={event => setDraft(event.target.value)} onCompositionStart={() => { composition.current = true }} onCompositionEnd={() => { composition.current = false }} onKeyDown={event => { if (shouldSend({ key: event.key, shiftKey: event.shiftKey, isComposing: composition.current || event.nativeEvent.isComposing, keyCode: event.nativeEvent.keyCode })) { event.preventDefault(); send() } }} /><button className="send-button" onClick={send} disabled={!draft.trim() || stream !== null} aria-label="发送问题"><ArrowUp size={19} /></button></div><div className="composer-bottom"><div className="model-controls"><label><span className="model-dot" /><select aria-label="示例模型（模拟）" value={model} onChange={event => setModel(event.target.value)}><option>书房 · 沉思</option><option>书房 · 轻语</option></select><ChevronDown size={11} /></label><i /><label><select aria-label="推理强度（模拟）" value={effort} onChange={event => setEffort(event.target.value)}><option>标准推理</option><option>深入推理</option><option>轻量推理</option></select><ChevronDown size={11} /></label><span className="mock-badge">模拟</span></div><span className="keyboard-hint">Enter 发送 <i>·</i> Shift + Enter 换行</span></div></div><div className="composer-footnote"><span>每轮对话，都是书里新的一页。</span><span>仅当前窗口保存 · 刷新后重置</span></div></div>
      {directory && <div className="drawer-overlay" onClick={() => setDirectory(false)}><aside className="directory-drawer" role="dialog" aria-modal="true" aria-label="全书目录" onClick={event => event.stopPropagation()} onKeyDown={event => { if (event.key === 'Escape') setDirectory(false) }}><header><div><span className="chapter-kicker">YOUR BOOK</span><h2>沿着书页，回来。</h2></div><button autoFocus className="icon-button" onClick={() => setDirectory(false)} aria-label="关闭目录"><X size={19} /></button></header><p>{BOOK_TITLE} <span>共 {pages.length} 页</span></p><button className="cover-jump" onClick={() => jump('cover')}>封面 <ArrowUp size={13} /></button>{toc()}<SourceCard /><footer>页码随窗口排版计算，入口始终留在原处。</footer></aside></div>}
      {stream !== null && <aside className="manuscript" aria-label="正在生成的手稿纸"><div className="manuscript-header"><div><span className="ink-dot" /><strong>正在落笔</strong><small>手稿纸 / 尚未装订</small></div><button onClick={() => bind(true)}><Square size={11} />停笔</button></div><div className="manuscript-scroll prose" ref={manuscriptRef} tabIndex={0}><div dangerouslySetInnerHTML={{ __html: safeMarkdown(stream, true) }} /><span className="ink-cursor" /></div><div className="manuscript-footer"><Feather size={12} /> 模拟生成中，完成后自动装订进书页</div></aside>}
    </>}
    {linkError && <div className="toast" role="alert">{linkError}<button onClick={() => setLinkError('')}>关闭</button></div>}
    <div className="prose pagination-probe" ref={probeRef} aria-hidden="true" />
    <span className="sr-only" aria-live="polite">{notice}</span>
  </div>
}
