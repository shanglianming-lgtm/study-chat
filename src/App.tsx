import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { ArrowLeft, ArrowRight, ArrowUp, BookOpen, Feather, List, PanelLeftClose, PenLine, Square, X } from 'lucide-react'
import Room from './Room'
import type { Journey } from './RoomScene'
import BookFrontMatter, { initialMetadata, PaperField, type BookMetadata } from './BookFrontMatter'
import { BOOK_TITLE, conversationSections, mockReply, sections, type Message, type ProcessRecord } from './content'
import { isHttpUrl, pageForPosition, pageForSection, paginate, processRecordHtml, safeMarkdown, shouldSend, stoppedManuscript, turnPage, type BookPage, type ReadingPosition } from './book'
import { LEAF_PERSPECTIVE, LEAF_SEGMENTS, leafOutline, leafPose } from './leafGeometry'
import './physicalBook.css'

function snapshot(node: HTMLElement) {
  const clone = node.cloneNode(true) as HTMLElement
  const style = getComputedStyle(node)
  clone.style.width = style.width
  clone.style.height = style.height
  clone.style.paddingLeft = style.paddingLeft
  clone.style.paddingRight = style.paddingRight
  clone.querySelectorAll('[id]').forEach(element => element.removeAttribute('id'))
  clone.querySelectorAll('input,textarea,select,button,a').forEach(element => element.setAttribute('tabindex', '-1'))
  return clone
}

export default function App() {
  const [opened, setOpened] = useState(false)
  const [journey, setJourney] = useState<Journey | null>(null)
  const [mode, setMode] = useState<'book' | 'notes'>('book')
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [model, setModel] = useState('Study · Reflective')
  const [effort, setEffort] = useState('标准推理')
  const [metadata, setMetadata] = useState(initialMetadata)
  const [expandedProcesses, setExpandedProcesses] = useState(new Set<string>())
  const [stream, setStream] = useState<string | null>(null)
  const [pages, setPages] = useState<BookPage[]>([])
  const [pageIndex, setPageIndex] = useState(0)
  const [single, setSingle] = useState(window.innerWidth < 860)
  const [directory, setDirectory] = useState(false)
  const [notice, setNotice] = useState('')
  const [linkError, setLinkError] = useState('')
  const [metrics, setMetrics] = useState({ width: 340, height: 430 })
  const [turning, setTurning] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const probeRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const manuscriptRef = useRef<HTMLDivElement>(null)
  const notesRef = useRef<HTMLDivElement>(null)
  const workspaceRef = useRef<HTMLElement>(null)
  const spreadRef = useRef<HTMLDivElement>(null)
  const leafHost = useRef<HTMLDivElement>(null)
  const manuscriptFollow = useRef(true)
  const notesFollow = useRef(true)
  const notesScrollTop = useRef(0)
  const shelfRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const turnSnapshot = useRef<{ direction: number; front: HTMLElement; under?: HTMLElement } | null>(null)
  const turnAnimation = useRef<Animation | null>(null)
  const hasPickedUp = useRef(false)
  const composition = useRef(false)
  const streamJob = useRef<{ full: string; text: string; id: string; process: ProcessRecord; timer: ReturnType<typeof setInterval> } | null>(null)
  const pendingAnchor = useRef<string | null>(null)
  const currentAnchor = useRef<ReadingPosition>({ sectionId: 'cover', offset: 0 })
  const writing = stream !== null
  const allSections = useMemo(() => [...sections, ...conversationSections(messages, expandedProcesses),
    ...(writing ? [{ id: streamJob.current?.id || 'live', title: 'Response · 正在落笔', live: true, role: 'assistant' as const, markdown: `###### Response · 回应\n\n${stream || ''}` }] : []),
    { id: 'writing', title: 'Continue the Conversation', kind: 'writing' as const, markdown: '' },
  ], [messages, writing, stream, expandedProcesses])

  useEffect(() => {
    const query = window.matchMedia('(max-width: 859px)')
    const update = () => setSingle(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  useLayoutEffect(() => {
    if (!opened || mode !== 'book' || !bodyRef.current) return
    const observer = new ResizeObserver(([entry]) => setMetrics({ width: Math.floor(entry.contentRect.width), height: Math.floor(entry.contentRect.height) }))
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
  const cancelTurn = useCallback(() => {
    turnAnimation.current?.cancel()
    turnAnimation.current = null
    leafHost.current?.replaceChildren()
    turnSnapshot.current = null
    setTurning(false)
  }, [])
  const openBook = useCallback(() => {
    if (journey || opened || !shelfRef.current) return
    hasPickedUp.current = true
    setNotice('')
    const focused = document.activeElement
    if (focused instanceof HTMLElement && focused.closest('.room-layer')) focused.blur()
    setJourney({ direction: 'out' })
  }, [journey, opened])
  const closeBook = useCallback(() => {
    if (journey || !opened) return
    cancelTurn()
    setDirectory(false); setOpened(false); setJourney({ direction: 'back' })
  }, [journey, opened, cancelTurn])
  const revealReader = useCallback(() => setOpened(true), [])
  const finishJourney = useCallback(() => setJourney(null), [])
  useLayoutEffect(() => {
    if (journey || !hasPickedUp.current) return
    if (opened) closeRef.current?.focus({ preventScroll: true })
    else shelfRef.current?.focus({ preventScroll: true })
  }, [opened, journey])
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
    const probe = probeRef.current
    probe.style.width = `${metrics.width}px`
    const nextPages = paginate(allSections, probe, metrics.height)
    setPages(nextPages)
    const position = pendingAnchor.current ? { sectionId: pendingAnchor.current, offset: 0 } : currentAnchor.current
    const index = writing && manuscriptFollow.current ? (nextPages.map((page, i) => page.live ? i : -1).filter(i => i >= 0).at(-1) ?? 0) : pageForPosition(nextPages, position)
    setPageIndex(single ? index : Math.floor(index / 2) * 2)
    pendingAnchor.current = null
  }, [allSections, metrics, single, fontReady])
  const jump = useCallback((id: string) => {
    cancelTurn()
    manuscriptFollow.current = id === streamJob.current?.id
    const target = manuscriptFollow.current ? (pages.map((page, i) => page.live ? i : -1).filter(i => i >= 0).at(-1) ?? 0) : pageForSection(pages, id)
    setPageIndex(single ? target : Math.floor(target / 2) * 2)
    currentAnchor.current = { sectionId: id, offset: 0 }
    setDirectory(false); setMode('book')
  }, [pages, single, cancelTurn])
  const flip = useCallback((direction: number) => {
    if (turnAnimation.current) return
    manuscriptFollow.current = false
    const next = turnPage(pageIndex, direction, pages.length, single)
    if (next === pageIndex) return
    const leaves = spreadRef.current?.querySelectorAll<HTMLElement>(':scope > .paper')
    const front = direction > 0 ? leaves?.[leaves.length - 1] : leaves?.[0]
    if (front && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const under = !single ? (direction > 0 ? leaves?.[0] : leaves?.[leaves.length - 1]) : undefined
      turnSnapshot.current = { direction, front: snapshot(front), under: under ? snapshot(under) : undefined }
    }
    const page = pages[next]?.kind === 'blank' ? pages[next + 1] : pages[next]
    currentAnchor.current = { sectionId: page?.sectionId || 'cover', offset: page?.offset || 0 }
    setPageIndex(next)
  }, [pageIndex, pages, single])
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (!opened || journey || directory || event.isComposing) return
      if (event.key === 'Escape') { event.preventDefault(); closeBook(); return }
      if (mode !== 'book' || target.closest('input,textarea,select,summary,details,a,[contenteditable="true"]')) return
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); flip(event.key === 'ArrowRight' ? 1 : -1) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [opened, journey, mode, directory, flip, closeBook])
  useLayoutEffect(() => {
    if (manuscriptRef.current && manuscriptFollow.current) manuscriptRef.current.scrollTop = manuscriptRef.current.scrollHeight
    if (notesRef.current && notesFollow.current && writing) notesRef.current.scrollTop = notesRef.current.scrollHeight
  }, [stream, mode])
  useLayoutEffect(() => {
    if (notesRef.current) notesRef.current.scrollTop = notesFollow.current ? notesRef.current.scrollHeight : notesScrollTop.current
  }, [messages, mode, opened])
  useLayoutEffect(() => {
    workspaceRef.current?.scrollTo({ top: 0 })
    // Reused left/right paper nodes must not carry a scrolled Preface into
    // the next leaf (for example, past the profile's opening heading).
    spreadRef.current?.querySelectorAll<HTMLElement>(':scope > .paper > .paper-body').forEach(body => { body.scrollTop = 0 })
    turnAnimation.current?.cancel()
    turnAnimation.current = null
    leafHost.current?.replaceChildren()
    const pending = turnSnapshot.current
    turnSnapshot.current = null
    if (!pending || mode !== 'book' || !leafHost.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setTurning(false); return }
    const incoming = spreadRef.current?.querySelectorAll<HTMLElement>(':scope > .paper')
    const back = pending.direction > 0 ? incoming?.[0] : incoming?.[incoming.length - 1]
    if (!back) return
    const leaf = document.createElement('div')
    leaf.className = `turning-leaf ${pending.direction > 0 ? 'forward' : 'backward'} ${single ? 'single-leaf' : ''}`
    leaf.setAttribute('aria-hidden', 'true'); leaf.setAttribute('inert', '')
    // Face bleed closes raster cracks; a shared nominal outline below trims it
    // to one sheet and casts a shaped shadow, never an unbent rectangular one.
    leaf.style.setProperty('--leaf-segments', String(LEAF_SEGMENTS))
    const backSnapshot = snapshot(back)
    const strips: HTMLElement[] = []
    let parent: HTMLElement = leaf
    for (let i = 0; i < LEAF_SEGMENTS; i++) {
      const strip = document.createElement('div')
      strip.className = `page-strip ${i === 0 ? 'strip-root' : ''}`
      strips.push(strip)
      for (const [side, paper] of [['front', pending.front], ['back', backSnapshot]] as const) {
        const face = document.createElement('div')
        face.className = `leaf-face leaf-${side}`
        const content = paper.cloneNode(true) as HTMLElement
        const frontIndex = pending.direction > 0 ? i : LEAF_SEGMENTS - 1 - i
        const column = side === 'front' ? frontIndex : LEAF_SEGMENTS - 1 - frontIndex
        content.style.position = 'absolute'
        // Compensate the symmetric face bleed without shifting the printed ink.
        content.style.left = `calc(var(--leaf-bleed) - ${column * parseFloat(paper.style.width) / LEAF_SEGMENTS}px)`
        face.append(content); strip.append(face)
      }
      parent.append(strip); parent = strip
    }
    const projection = document.createElement('div')
    projection.className = 'leaf-projection'
    projection.style.perspective = `${LEAF_PERSPECTIVE}px`
    projection.append(leaf)
    const silhouette = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    silhouette.classList.add('leaf-silhouette')
    const outline = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    silhouette.append(outline)
    leafHost.current.append(silhouette, projection)
    setTurning(true)
    // A nonvisual WAAPI clock retains pause/seek and easing. Do not animate
    // transforms independently on the compositor: the JS clip can lag them.
    const animation = leaf.animate([],
      { duration: 760, easing: 'cubic-bezier(.32,.08,.24,1)', fill: 'forwards' })
    turnAnimation.current = animation
    const width = parseFloat(pending.front.style.width), height = parseFloat(pending.front.style.height)
    const hostWidth = parseFloat(getComputedStyle(projection).width)
    const segmentWidth = parseFloat(getComputedStyle(strips[0]).width)
    // The opposite old page stays put until the moving reverse face lands.
    // Rendering both incoming pages immediately would duplicate the new text.
    const under = pending.under
    if (under) {
      under.classList.add('leaf-underlay')
      Object.assign(under.style, { position: 'absolute', top: '0', left: pending.direction > 0 ? '0' : `${hostWidth - width}px`, zIndex: '0' })
      leafHost.current.append(under)
    }
    let lastProgress: number | null = null
    const followOutline = () => {
      if (!leaf.isConnected) return
      const progress = animation.effect?.getComputedTiming().progress ?? 0
      if (progress !== lastProgress) {
        lastProgress = progress
        const { root, bends } = leafPose(progress, pending.direction > 0)
        // Paper, clip and shadow are committed together from identical matrices.
        leaf.style.transform = `matrix3d(${root.join(',')})`
        strips.forEach((strip, i) => { strip.style.transform = `matrix3d(${bends[i].join(',')})` })
        const points = leafOutline(width, height, hostWidth, pending.direction > 0, root, bends, segmentWidth)
        projection.style.clipPath = `polygon(${points.map(p => `${p.x}px ${p.y}px`).join(',')})`
        outline.setAttribute('d', `${points.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join('')}Z`)
      }
      requestAnimationFrame(followOutline)
    }
    followOutline()
    animation.onfinish = () => { projection.remove(); silhouette.remove(); under?.remove(); turnAnimation.current = null; setTurning(false) }
  }, [pageIndex, mode, single, metrics.width, metrics.height, fontReady])
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => { if (query.matches) cancelTurn() }
    query.addEventListener('change', update)
    return () => { query.removeEventListener('change', update); turnAnimation.current?.cancel() }
  }, [cancelTurn])
  const bind = useCallback((stopped = false) => {
    const job = streamJob.current
    if (!job) return
    clearInterval(job.timer); streamJob.current = null
    const text = job.text || '（本轮已停笔，尚未写下回应。）'
    pendingAnchor.current = job.id
    currentAnchor.current = { sectionId: job.id, offset: 0 }
    setMessages(items => [...items, { id: job.id, role: 'assistant', content: stopped ? stoppedManuscript(text) : text, process: job.process }])
    setStream(null)
    setNotice(stopped ? '已停笔，现有文字已装订' : '墨迹已干，新的一轮已装订入书')
  }, [])
  useEffect(() => () => { if (streamJob.current) clearInterval(streamJob.current.timer) }, [])
  const send = () => {
    const question = draft.trim()
    if (!question || streamJob.current) return
    cancelTurn()
    const id = crypto.randomUUID()
    manuscriptFollow.current = true; notesFollow.current = true
    pendingAnchor.current = `a-${id}`
    currentAnchor.current = { sectionId: `a-${id}`, offset: 0 }
    setMessages(items => [...items, { id: `q-${id}`, role: 'user', content: question }])
    setDraft(''); setStream(''); setNotice('')
    const full = mockReply(question, model, effort)
    const job = { full, text: '', id: `a-${id}`, process: { model, effort }, timer: setInterval(() => {
      job.text = job.full.slice(0, job.text.length + 9)
      setStream(job.text)
      if (job.text.length === job.full.length) bind()
    }, 44) }
    streamJob.current = job
  }
  const handleLink = async (event: React.MouseEvent) => {
    const disclosure = (event.target as HTMLElement).closest('details.process-record > summary')?.parentElement
    const recordId = disclosure?.dataset.record
    if (recordId) {
      event.preventDefault()
      manuscriptFollow.current = false
      setExpandedProcesses(previous => {
        const next = new Set(previous)
        if (next.has(recordId)) next.delete(recordId)
        else next.add(recordId)
        return next
      })
      setNotice(expandedProcesses.has(recordId) ? '过程附页已收起' : '过程记录已展开为续页，请翻页阅读')
      return
    }
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
  const changeMetadata = (key: keyof BookMetadata, value: string) => setMetadata(previous => ({ ...previous, [key]: value }))
  const tocItems = allSections.filter(section => section.id !== 'cover' && section.id !== 'contents')
  const totalPages = pages.length
  const visibleFolios = pages.slice(pageIndex, pageIndex + (single ? 1 : 2)).flatMap(page => page.folio ? [page.folio] : [])
  const visibleIndexes = single ? [pageIndex] : [pageIndex, pageIndex + 1]
  const stopPageIndex = visibleIndexes.filter(index => pages[index]?.live).at(-1) ?? visibleIndexes.at(-1)
  const toc = (page?: BookPage) => <div className="toc-list compact">{tocItems.slice(page?.tocStart ?? 0, page?.tocEnd).map(section => <button key={section.id} onClick={() => jump(section.id)}><span>{section.title}</span><i /><b>{pages[pageForSection(pages, section.id)]?.folio || '—'}</b></button>)}</div>
  const composer = () => <div className="in-page-composer">
    <h6>Conversation {String(Math.floor(messages.length / 2) + 1).padStart(2, '0')} · 提问</h6>
    <PaperField id="study-question" name="question" inputRef={textareaRef} value={draft} placeholder="此刻，你在想什么？把问题写在这一页。" aria-label="写下你的问题" onChange={event => setDraft(event.target.value)} onCompositionStart={() => { composition.current = true }} onCompositionEnd={() => { composition.current = false }} onKeyDown={event => { if (shouldSend({ key: event.key, shiftKey: event.shiftKey, isComposing: composition.current || event.nativeEvent.isComposing, keyCode: event.nativeEvent.keyCode })) { event.preventDefault(); send() } }} />
    <div className="ink-actions"><button onClick={send} disabled={!draft.trim() || writing} aria-label="发送问题"><Feather size={13} /> 落笔 <ArrowUp size={12} /></button><span>Enter 落笔 · Shift + Enter 换行</span></div>
    <p className="colophon-note">回应也写在书中。模型与提供商见版权页。</p>
  </div>
  const liveReply = () => <div className="live-response"><h6>Response · 回应</h6><div className="live-ink" ref={manuscriptRef} tabIndex={0} aria-label="书页中正在生成的回应" onScroll={event => { const node = event.currentTarget; manuscriptFollow.current = node.scrollHeight - node.clientHeight - node.scrollTop < 32 }}><div dangerouslySetInnerHTML={{ __html: safeMarkdown(stream || '', true) }} /><span className="ink-cursor" /></div><div className="ink-actions"><span className="ink-status">墨迹未干 · 本地模拟</span><button onClick={() => bind(true)}><Square size={11} />停笔并装订</button></div></div>
  const renderPage = (page: BookPage | undefined, index: number) => <article key={index === pageIndex ? 'first' : 'second'} className={`paper ${index % 2 ? 'recto' : 'verso'} ${page?.kind === 'blank' ? 'blank-paper' : ''} ${page?.kind === 'writing' ? 'writing-paper' : ''} ${page?.kind ? 'special-leaf' : ''}`} aria-label={`${page?.folio || ''} ${page?.title || 'Flyleaf'}`}>
    <header className="running-head"><span>{index % 2 ? page?.title || '' : BOOK_TITLE}</span><span>STUDY LIBRARY</span></header>
    <div className={`paper-body prose ${page?.role || ''}`} ref={index === pageIndex ? bodyRef : undefined}>
      {page?.kind === 'blank' ? null : page?.kind === 'toc' ? <><span className="chapter-kicker">CONTENTS</span><h1>Contents{page.tocStart ? ' (cont.)' : ''}</h1>{toc(page)}</> : page?.kind === 'writing' ? <div className="writing-leaf"><span className="chapter-kicker">AN OPEN LEAF</span><h1>The next thought</h1>{composer()}</div> : page?.kind === 'live' ? liveReply() : page?.kind ? <BookFrontMatter kind={page.kind} metadata={metadata} change={changeMetadata} model={model} setModel={setModel} effort={effort} setEffort={setEffort} /> : page ? <div dangerouslySetInnerHTML={{ __html: page.html }} /> : null}
    </div>
    <footer className="page-footer"><span>{page?.folio || ''}</span>{writing && index === stopPageIndex ? <button className="paper-stop" onClick={() => bind(true)}><Square size={10} />停笔并装订</button> : <i />}</footer>
    <button className={`page-corner ${index % 2 || single ? 'next-corner' : 'previous-corner'}`} aria-label={index % 2 || single ? '翻起右页' : '翻起左页'} onClick={() => flip(index % 2 || single ? 1 : -1)} disabled={turning || (index % 2 || single ? pageIndex + (single ? 1 : 2) >= pages.length : pageIndex === 0)} />
  </article>
  const thickness = { '--left-stack': `${Math.min(25, 3 + pageIndex * .55)}px`, '--right-stack': `${Math.min(25, 3 + Math.max(0, pages.length - pageIndex - (single ? 1 : 2)) * .55)}px` } as CSSProperties

  return <div className={`app ${opened ? 'reading physical-reading' : 'in-room'} ${journey ? 'in-transit' : ''}`} onClick={handleLink}>
    <div className="room-layer" inert={opened || !!journey} aria-hidden={opened || !!journey}><Room onOpen={openBook} bookAway={opened || !!journey} shelfRef={shelfRef} journey={journey} onReveal={revealReader} onFinish={finishJourney} /></div>
    {opened && <section className="reader-surface" aria-label="窗边书桌上的书" inert={!!journey}>
      <div className="reader-toolbar"><div className="book-identity"><button className="icon-button back-room" ref={closeRef} onClick={closeBook} aria-label="合上书，起身"><PanelLeftClose size={18} /></button><div><strong>{BOOK_TITLE}</strong><span>STUDY LIBRARY / I · {Math.ceil(messages.length / 2)} conversations</span></div></div><div className="view-switch" aria-label="阅读模式"><button className={mode === 'book' ? 'active' : ''} onClick={() => { cancelTurn(); setMode('book') }}><BookOpen size={15} />书页</button><button className={mode === 'notes' ? 'active' : ''} onClick={() => { cancelTurn(); setMode('notes') }}><PenLine size={15} />速记</button></div><button className="text-button contents-button" onClick={() => setDirectory(true)}><List size={16} />目录<span>{totalPages} 页</span></button></div>
      <main className="workspace" ref={workspaceRef}>
        <div className="book-stage">
          {mode === 'book' ? <div className="spread" ref={spreadRef} style={thickness} key={single ? 'single' : 'double'}>
            <div className="page-stack left-stack" aria-hidden="true" /><div className="page-stack right-stack" aria-hidden="true" />
            {renderPage(pages[pageIndex], pageIndex)}{!single && renderPage(pages[pageIndex + 1], pageIndex + 1)}
            <div className="leaf-host" ref={leafHost} aria-hidden="true" inert /><div className="book-ribbon" />
            <button className="writing-bookmark" onClick={() => jump(writing ? streamJob.current?.id || 'writing' : 'writing')} aria-label="翻到续写页"><Feather size={14} /><span>续写</span></button>
          </div> : <div className="spread notes-spread" style={thickness}><div className="page-stack right-stack" aria-hidden="true" /><article className="paper notes-paper"><header className="running-head"><span>FIELD NOTES</span><span>STUDY LIBRARY</span></header><div className="paper-body prose notes-scroll" ref={notesRef} onScroll={event => { const node = event.currentTarget; notesFollow.current = node.scrollHeight - node.clientHeight - node.scrollTop < 32; notesScrollTop.current = node.scrollTop }}><span className="chapter-kicker">FIELD NOTES</span><h1>让想法，先流动起来。</h1>{messages.length === 0 && <p>不必整理，不必成章。这里的每一笔，也会留在书中。</p>}{messages.map(message => <section className="written-entry" key={message.id}><h6>{message.role === 'user' ? 'Question · 提问' : 'Response · 回应'} <button onClick={() => jump(message.id)} aria-label="在书页中阅读">↗</button></h6><div dangerouslySetInnerHTML={{ __html: safeMarkdown(message.content) }} />{message.process && <div dangerouslySetInnerHTML={{ __html: processRecordHtml(message.process) }} />}</section>)}{writing ? liveReply() : composer()}</div><footer className="page-footer"><span>Field notes</span><i /></footer></article></div>}
          <div className="pagination">{mode === 'book' && <><button className="icon-button" onClick={() => flip(-1)} disabled={turning || pageIndex === 0} aria-label="上一页"><ArrowLeft size={17} /></button><span>{visibleFolios.join(' — ') || 'Front matter'} <i>/</i> {single ? pageIndex + 1 : Math.floor(pageIndex / 2) + 1} of {Math.ceil(totalPages / (single ? 1 : 2))} {single ? 'pages' : 'spreads'}</span><button className="icon-button" onClick={() => flip(1)} disabled={turning || pageIndex + (single ? 1 : 2) >= pages.length} aria-label="下一页"><ArrowRight size={17} /></button></>}</div>
        </div>
      </main>
      {directory && <div className="drawer-overlay" onClick={() => setDirectory(false)}><aside className="directory-drawer" role="dialog" aria-modal="true" aria-label="全书目录" onClick={event => { event.stopPropagation(); void handleLink(event) }} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDirectory(false) } }}><header><div><span className="chapter-kicker">CONTENTS</span><h2>A way back.</h2></div><button autoFocus className="icon-button" onClick={() => setDirectory(false)} aria-label="关闭目录"><X size={19} /></button></header><p>{BOOK_TITLE}</p><button className="cover-jump" onClick={() => jump('cover')}>Half Title <ArrowUp size={13} /></button>{toc()}<footer>页码随窗口排版计算，章节入口始终留在原处。</footer></aside></div>}
    </section>}
    {linkError && <div className="toast" role="alert">{linkError}<button onClick={() => setLinkError('')}>关闭</button></div>}
    <div className="prose pagination-probe" ref={probeRef} aria-hidden="true" />
    <span className="sr-only" aria-live="polite">{notice}</span>
  </div>
}
