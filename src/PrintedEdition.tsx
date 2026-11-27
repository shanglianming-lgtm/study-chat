import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { appearsInContents } from './content'
import {
  pageForPosition,
  pageForSection,
  paginate,
  turnPage,
  type BookPage,
  type ReadingPosition,
} from './book'
import { flatSheet, type TurnFaces } from './flatSheet'
import { pullProgress, stepPaper } from './pagePull'
import { paperStock } from './paperStock'
import { turnDeskSheet, type DeskReading } from './deskReading'
import BookFrontMatter from './BookFrontMatter'
import Correspondence, { type Gesture } from './Correspondence'
import type { Library, ModuleName, Volume } from './library'
import type { ScrollMark } from './readingPosition'
import { editVolume } from './shelfStore'
import { volumeSections } from './volumeEdition'
type PageTurn = TurnFaces & {
  source: number; next: number; grip: number; pointer: number | null
  bookmark?: BookPage
  startX: number; width: number; target: number; landing: 0 | 1 | null
  wake?: () => void
}
function snapshot(node: HTMLElement) {
  const clone = node.cloneNode(true) as HTMLElement
  const style = getComputedStyle(node)
  clone.style.width = style.width
  clone.style.height = style.height
  clone.style.paddingLeft = style.paddingLeft
  clone.style.paddingRight = style.paddingRight
  if (node.closest('.dialogue-spread')) clone.classList.add('dialogue-spread')
  const pane = node.querySelector<HTMLElement>('.book-scroll')
  const ink = clone.querySelector<HTMLElement>('.flowing-text')
  if (pane && ink) {
    // Turn only the visible lines with the sheet, at their current reading offset.
    const entries = node.querySelectorAll<HTMLElement>('.flowing-text > .bound-turn')
    let firstTop: number | undefined
    Array.from(ink.children).forEach((copy, i) => {
      const entry = entries[i]
      if (!entry || entry.offsetTop + entry.offsetHeight <= pane.scrollTop ||
          entry.offsetTop >= pane.scrollTop + pane.clientHeight) copy.remove()
      else firstTop ??= entry.offsetTop
    })
    ink.style.transform = `translateY(${(firstTop ?? 0) - pane.scrollTop}px)`
  }
  clone.querySelectorAll('[id]').forEach((element) => element.removeAttribute('id'))
  clone.querySelectorAll('.leaf-edge').forEach((control) => control.remove())
  clone
    .querySelectorAll('input,textarea,select,button,a')
    .forEach((element) => element.setAttribute('tabindex', '-1'))
  return clone
}

export default function PrintedEdition({
  deskRig,
  single,
  book, library, gest, onManage, active,
}: {
  deskRig: DeskReading | null
  single: boolean
  book: Volume
  library: Library
  gest: Gesture
  onManage: () => void
  active: boolean
}) {
  const [pages, setPages] = useState<BookPage[]>([]),
    [pageIndex, setPageIndex] = useState(0),
    [preview, setPreview] = useState<PageTurn | null>(null),
    [fontReady, setFontReady] = useState(0)
  const [metrics, setMetrics] = useState({ width: 320, height: 480 })
  const [editing, setEditing] = useState<ModuleName | null>(null)
  const memory = editing === 'memory' ? '' : book.memory
  const profile = editing === 'profile' ? '' : book.profile
  const sections = useMemo(() => volumeSections({ name: book.name, title: book.title, memory, profile }),
    [book.name, book.title, memory, profile])
  const currentAnchor = useRef<ReadingPosition>(book.bookmark || { sectionId: 'cover', offset: 0 }),
    scrollMark = useRef<ScrollMark>({}),
    spreadRef = useRef<HTMLDivElement>(null),
    leafHost = useRef<HTMLDivElement>(null),
    bodyRef = useRef<HTMLDivElement>(null),
    probeRef = useRef<HTMLDivElement>(null)
  const turn = useRef<PageTurn | null>(null)
  const shown = preview?.next ?? pageIndex
  const turning = !!preview
  useLayoutEffect(() => {
    const stock = paperStock()
    if (stock) spreadRef.current?.style.setProperty('--paper-stock', stock.url)
  }, [])
  useEffect(() => {
    const f = () => setFontReady((n) => n + 1)
    void document.fonts.ready.then(f)
    document.fonts.addEventListener('loadingdone', f)
    return () => document.fonts.removeEventListener('loadingdone', f)
  }, [])
  useLayoutEffect(() => {
    const n = bodyRef.current
    if (!n) return
    const r = new ResizeObserver(([e]) => {
      const width = Math.floor(e.contentRect.width),
        height = Math.floor(e.contentRect.height)
      setMetrics((old) => (old.width === width && old.height === height ? old : { width, height }))
    })
    r.observe(n)
    return () => r.disconnect()
  }, [single, pageIndex, deskRig])
  useLayoutEffect(() => {
    const p = probeRef.current
    if (turn.current || !p || metrics.width < 20 || metrics.height < 100) return
    p.style.width = metrics.width + 'px'
    const next = paginate(sections, p, metrics.height)
    setPages(next)
    const index = pageForPosition(next, currentAnchor.current)
    setPageIndex(single ? index : index - (index % 2))
  }, [metrics, single, fontReady, sections, turning])
  useLayoutEffect(() => {
    deskRig?.configure(
      Math.floor(pageIndex / 2) / Math.max(1, Math.floor((pages.length - 1) / 2)),
      single ? (pageIndex % 2 ? 'right' : 'left') : 'spread'
    )
  }, [deskRig, single, pages.length, pageIndex])
  const cancelTurn = useCallback(() => {
    turn.current = null
    setPreview(null)
  }, [])
  const remember = useCallback((page: BookPage) => {
    const bookmark = { sectionId: page.sectionId, offset: page.offset || 0 }
    currentAnchor.current = bookmark
    editVolume(book.id, { bookmark })
  }, [book.id])
  const nextLeaf = useCallback((direction: number) => {
    let next = turnPage(pageIndex, direction, pages.length, single)
    while (single && pages[next]?.kind === 'blank') {
      const further = turnPage(next, direction, pages.length, true)
      if (further === next) return pageIndex
      next = further
    }
    return next
  }, [pageIndex, pages, single])
  const commit = useCallback((index: number, destination?: BookPage) => {
    const facing = pages[index + 1]
    const page = destination ?? (!single && (pages[index]?.kind === 'blank' || facing?.kind === 'live') ? facing : pages[index])
    if (page) remember(page)
    setPageIndex(index)
  }, [pages, remember, single])
  function begin(direction: number, event?: ReactPointerEvent<HTMLDivElement>, destination?: number) {
    if (!active || turn.current) return
    const next = destination === undefined ? nextLeaf(direction) : single ? destination : destination - destination % 2
    const bookmark = destination === undefined ? undefined : pages[destination]
    if (next === pageIndex) { if (bookmark) remember(bookmark); return }
    if (!event && matchMedia('(prefers-reduced-motion: reduce)').matches) { commit(next, bookmark); return }
    const leaves = Array.from(spreadRef.current!.querySelectorAll<HTMLElement>(':scope > .paper'))
      .filter(leaf => deskRig || !single || leaf.getAttribute('aria-hidden') !== 'true')
    const front = direction > 0 ? leaves.at(-1) : leaves[0]
    if (!front) return
    const under = (deskRig || !single) ? (direction > 0 ? leaves[0] : leaves.at(-1)) : undefined
    const held = event && (event.target as Element).closest('.paper')
    const rect = (held || front).getBoundingClientRect()
    const pending: PageTurn = {
      source: pageIndex, next, bookmark, direction, front: snapshot(front), under: under && snapshot(under),
      grip: event ? Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) : .5,
      pointer: event?.pointerId ?? null, startX: event?.clientX ?? 0, width: rect.width,
      target: event ? pullProgress(0, rect.width, single) : 1, landing: event ? null : 1,
    }
    if (event) event.currentTarget.setPointerCapture(event.pointerId)
    turn.current = pending
    setPreview(pending)
  }
  const flip = (direction: number) => begin(direction)
  function press(e: ReactPointerEvent<HTMLDivElement>) {
    const edge = (e.target as Element).closest<HTMLButtonElement>('button.leaf-edge')
    if (!edge || edge.disabled || !e.isPrimary || e.button !== 0) return
    e.preventDefault()
    begin(edge.classList.contains('forward') ? 1 : -1, e)
  }
  useLayoutEffect(() => {
    const t = preview, spread = spreadRef.current
    if (!t || t.pointer === null || !spread) return
    const pointer = t.pointer
    function change(e: PointerEvent) {
      if (e.pointerId !== pointer || t!.landing !== null) return
      t!.target = pullProgress((t!.startX - e.clientX) * t!.direction, t!.width, single)
      t!.wake?.()
    }
    function finish(e: PointerEvent) {
      if (e.pointerId !== pointer || t!.landing !== null) return
      change(e)
      t!.landing = e.type === 'pointerup' && t!.target >= .5 ? 1 : 0
      t!.target = t!.landing
      if (spread!.hasPointerCapture(pointer)) spread!.releasePointerCapture(pointer)
    }
    function move(e: PointerEvent) {
      if (e.pointerId !== pointer || t!.landing !== null) return
      if (!e.buttons && e.pointerType === 'mouse') { finish(e); return }
      change(e)
      // Chromium can drop capture when the pressed button becomes the reverse face.
      if (!spread!.hasPointerCapture(pointer) && e.buttons) spread!.setPointerCapture(pointer)
    }
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', finish, true)
    window.addEventListener('pointercancel', finish, true)
    return () => {
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', finish, true)
      window.removeEventListener('pointercancel', finish, true)
      if (spread.hasPointerCapture(pointer)) spread.releasePointerCapture(pointer)
    }
  }, [preview, single])
  useLayoutEffect(() => {
    const spread = spreadRef.current, host = leafHost.current, t = preview
    if (!spread || !host || !t) return
    const incoming = Array.from(spread.querySelectorAll<HTMLElement>(':scope > .paper'))
      .filter(leaf => deskRig || !single || leaf.getAttribute('aria-hidden') !== 'true')
    const back = t.direction > 0 ? incoming[0] : incoming.at(-1)
    if (!back) { cancelTurn(); return }
    const forward = t.direction > 0
    const panOnly = deskRig && single && Math.floor(t.next / 2) === Math.floor(t.source / 2)
    let draw: ((p: number) => void) | undefined
    if (!panOnly) {
      if (deskRig) {
        spread.dataset.landing = forward ? 'left' : 'right'
        draw = turnDeskSheet(host, deskRig, t.front, snapshot(back), t.under, forward, t.grip)
      } else draw = flatSheet(host, t, snapshot(back), single, t.grip)
    }
    let frame = 0, position = 0, velocity = 0, last = performance.now()
    const reduced = matchMedia('(prefers-reduced-motion: reduce)')
    function paint(p: number) {
      if (single && deskRig) deskRig.trackFocus(t!.source % 2 ? 'right' : 'left', t!.next % 2 ? 'right' : 'left', p)
      draw?.(p)
    }
    paint(0)
    function advance(now: number) {
      frame = 0
      if (turn.current !== t || !t) return
      const dt = Math.max(0, Math.min(.25, (now - last) / 1000))
      last = now
      const step = stepPaper(position, velocity, t.target, dt, t.landing === null ? 22 : 12)
      position = reduced.matches ? t.target : step.position
      velocity = reduced.matches ? 0 : step.velocity
      const settled = Math.abs(position - t.target) < .0009 && Math.abs(velocity) < .012
      paint(settled ? t.target : Math.max(0, Math.min(1, position)))
      if (settled && t.landing !== null) {
        if (t.landing) commit(t.next, t.bookmark)
        cancelTurn()
      } else if (!settled) frame = requestAnimationFrame(advance)
    }
    t.wake = () => {
      if (!frame) { last = performance.now(); frame = requestAnimationFrame(advance) }
    }
    t.wake()
    return () => {
      delete t.wake
      cancelAnimationFrame(frame)
      host.replaceChildren()
      delete spread.dataset.landing
      deskRig?.endTurn()
    }
  }, [preview, deskRig, single, cancelTurn, commit])
  useLayoutEffect(() => {
    if (!active || turn.current && turn.current.source !== pageIndex) cancelTurn()
  }, [active, pageIndex, cancelTurn])
  useEffect(() => {
    const abandon = () => { if (turn.current) cancelTurn() }
    const hidden = () => { if (document.hidden) abandon() }
    window.addEventListener('blur', abandon)
    window.addEventListener('resize', abandon)
    document.addEventListener('visibilitychange', hidden)
    return () => {
      window.removeEventListener('blur', abandon)
      window.removeEventListener('resize', abandon)
      document.removeEventListener('visibilitychange', hidden)
    }
  }, [cancelTurn])
  useLayoutEffect(() => {
    spreadRef.current?.querySelectorAll<HTMLElement>(':scope > .paper > .paper-body').forEach(body => { body.scrollTop = 0 })
  }, [shown])
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        !active || e.defaultPrevented || e.isComposing || e.altKey || e.ctrlKey || e.metaKey ||
        document.querySelector('dialog[open]') ||
        (e.target instanceof Element && e.target.closest('textarea,input,select,[contenteditable=true],.raised-words'))
      )
        return
      if (['ArrowRight', 'ArrowLeft', 'PageDown', 'PageUp'].includes(e.key)) {
        e.preventDefault()
        flip(e.key === 'ArrowRight' || e.key === 'PageDown' ? 1 : -1)
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [active, flip])
  function go(id: string) {
    if (!active || turn.current) return
    const n = pageForSection(pages, id)
    const next = single ? n : n - (n % 2)
    // A contents entry turns the physical sheet to its destination, rather
    // than replacing the ink abruptly. Reduced motion uses begin's instant path.
    begin(next > pageIndex ? 1 : -1, undefined, n)
  }
  const startIndex = single && !deskRig ? shown : shown - (shown % 2)
  function leaf(index: number) {
    const p = pages[index],
      active = !single || shown === index
    return (
      <article
        key={index % 2}
        lang={p?.lang || 'en'}
        className={'paper ' + (index % 2 ? 'recto' : 'verso')}
        data-section={p?.sectionId}
        inert={!active}
        aria-hidden={!active}
      >
        <div className="paper-body prose" ref={index === pageIndex ? bodyRef : undefined}>
          {p?.kind === 'toc' ? (
            <div className="edition-toc">
              <h1>Contents</h1>
              <div className="edition-contents">
                {sections
                  .filter(appearsInContents)
                  .slice(p.tocStart, p.tocEnd)
                  .map((s) => (
                    <button key={s.id} onClick={() => go(s.id)}>
                      <span className="contents-numeral">{s.chapter}</span>
                      <span className="contents-title"><span>{s.title}</span></span>
                      <span className="contents-folio">{pages[pageForSection(pages, s.id)]?.folio}</span>
                    </button>
                  ))}
              </div>
            </div>
          ) : p?.kind && p.kind !== 'blank' ? (
            <BookFrontMatter
              kind={p.kind}
              book={book}
              library={library}
              onEdit={setEditing}
              onOpenConversation={() => go('correspondence')}
            />
          ) : (
            <div className="manuscript-text" dangerouslySetInnerHTML={{ __html: p?.html || '' }} />
          )}
        </div>
        {p?.folio && <footer className="printed-folio">{p.folio}</footer>}
        {(single || index % 2 === 0) && (
          <button
            className="leaf-edge backward"
            aria-label="上一页"
            disabled={turning || nextLeaf(-1) === pageIndex}
            onClick={() => flip(-1)}
          />
        )}
        {(single || index % 2 === 1) && (
          <button
            className="leaf-edge forward"
            aria-label="下一页"
            disabled={turning || nextLeaf(1) === pageIndex}
            onClick={() => flip(1)}
          />
        )}
      </article>
    )
  }
  const spreadStart = shown - shown % 2
  const chapter = pages[spreadStart + 1]?.kind === 'live' ? pages[spreadStart + 1] : undefined
  return (
    <>
      <div
        className={chapter ? 'spread dialogue-spread' : 'spread'}
        ref={spreadRef}
        data-turning={turning || undefined}
        onPointerDown={press}
        onClickCapture={e => {
          if (turn.current || (e.detail > 0 && (e.target as Element).closest('.leaf-edge'))) {
            e.preventDefault()
            e.stopPropagation()
          }
        }}
        style={{ '--left-stack': 3 + pageIndex / 2 + 'px' } as CSSProperties}
      >
        {chapter ? <Correspondence book={book} library={library} gest={gest} single={single}
          side={shown % 2 ? 'right' : 'left'} turnPage={flip} turning={turning}
          folio={chapter.folio || '1'} scrollMark={scrollMark.current} onManage={onManage} />
        : <>{leaf(startIndex)}{(!single || deskRig) && leaf(startIndex + 1)}</>}
        <div className="leaf-host" ref={leafHost} inert aria-hidden />
      </div>
      <div className="prose pagination-probe" ref={probeRef} aria-hidden />
    </>
  )
}
