import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from 'react'
import { ArrowUp, Paperclip, Square, X } from 'lucide-react'
import {
  efforts,
  resolveModel,
  errorText,
  libraryFile,
  type Library,
  type Volume,
  type Turn,
  type LeafFile,
  type Effort,
  type ModuleName,
} from './library'
import {
  attachFiles,
  canUndo,
  chooseModel,
  downloadBlob,
  editVolume,
  eraseTurn,
  report,
  stop,
  submit,
  undoErase,
  writing,
} from './shelfStore'
import { ModelOptions } from './ManagementBook'
import { effortOptions, selectedEffort } from './modelSupport'
import { setType } from './paperType'
import { maintainReadingPosition } from './readingPosition'
import { shouldSend } from './book'
import { PaperField } from './BookFrontMatter'
import type { PageSide } from './deskReading'
import { INK_SPELL } from './inkSpell'
import { inkFlight } from './inkFlight'

export type HandAction = 'point' | 'sweep' | 'stroke' | 'pinch' | 'rewind'
export type Gesture = (action: HandAction, side: PageSide, u: number, v: number, width?: number) => void
type Float = {
  side: PageSide
  x: number
  y: number
  kind: 'module' | 'lift' | 'actions' | 'process' | 'both' | 'ref' | 'undo'
  text?: string
  title?: string
  field?: ModuleName
  turn?: string
  user?: boolean
  file?: LeafFile
  cue?: number
  placement?: { y: number; below: boolean }
}
function paperPoint(el: Element, side: PageSide) {
  const sheet = el.closest('.paper') as HTMLElement
  const bounds = el.getBoundingClientRect(),
    x = bounds.left + bounds.width * 0.5,
    y = bounds.top + bounds.height * 0.5
  const surface = sheet.closest('.desk-surface'),
    css =
      surface &&
      getComputedStyle(surface)
        .getPropertyValue('--desk-' + side)
        .trim()
  if (css) {
    const m = new DOMMatrix(css)
    const a = m.m11 - x * m.m14,
      b = m.m21 - x * m.m24,
      c = m.m12 - y * m.m14,
      d = m.m22 - y * m.m24
    const e = x * m.m44 - m.m41,
      f = y * m.m44 - m.m42,
      det = a * d - b * c
    if (Math.abs(det) > 1e-8)
      return { x: (e * d - f * b) / det / sheet.offsetWidth, y: (a * f - c * e) / det / sheet.offsetHeight }
  }
  const r = sheet.getBoundingClientRect()
  return { x: (x - r.left) / r.width, y: (y - r.top) / r.height }
}
function useFlow(target: string, animate: boolean, hold = false) {
  const [value, setValue] = useState(() => (animate ? '' : target)),
    [hot, setHot] = useState(0)
  const current = useRef(value),
    latest = useRef({ target, hold }),
    frame = useRef(0),
    cool = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  latest.current = { target, hold }
  useEffect(() => {
    if (!animate) {
      current.current = target
      setValue(target)
      setHot(0)
      return
    }
    if (!target.startsWith(current.current)) {
      current.current = ''
      setValue('')
    }
    if (hold || frame.current || current.current === target) return
    let last = performance.now()
    function tick(now: number) {
      frame.current = 0
      const { target, hold } = latest.current
      if (hold) return
      let n = current.current.length
      if (!target.startsWith(current.current)) n = 0
      const count = Math.min(
        target.length - n,
        Math.max(
          1,
          Math.floor((now - last) * 0.11),
          target.length - n > 300 ? Math.ceil((target.length - n) / 16) : 1
        )
      )
      if (count > 0) {
        let end = n + count
        if (end < target.length && /[\uD800-\uDBFF]/.test(target[end - 1])) end++
        current.current = target.slice(0, end)
        setValue(current.current)
        setHot(Math.min(18, end))
        last = now
        clearTimeout(cool.current)
        cool.current = setTimeout(() => setHot(0), 360)
      }
      if (current.current !== target) frame.current = requestAnimationFrame(tick)
    }
    frame.current = requestAnimationFrame(tick)
  }, [target, animate, hold])
  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current)
      frame.current = 0
      clearTimeout(cool.current)
    },
    []
  )
  return { value, hot }
}
const InkText = memo(function InkText({
  value,
  hot,
  user,
  files,
  live,
  tails,
}: {
  value: string
  hot: number
  user: boolean
  files: LeafFile[]
  live: boolean
  tails?: LeafFile[]
}) {
  const html = useMemo(
    () =>
      setType(
        value,
        user,
        hot,
        new Set(files.map((f) => f.n)),
        live,
        tails?.map((f) => f.n)
      ),
    [value, hot, user, files, live, tails]
  )
  return (
    <div
      className={'set-ink ' + (user ? 'question-ink' : 'answer-ink')}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
})
function AnswerInk({
  turn,
  files,
  play,
  hold,
  gest,
}: {
  turn: Turn
  files: LeafFile[]
  play: boolean
  hold: boolean
  gest: Gesture
}) {
  const a = useFlow(turn.a, play, hold),
    waved = useRef(false)
  useEffect(() => {
    if (play && !hold && turn.a && !waved.current) {
      waved.current = true
      gest('sweep', 'right', 0.67, 0.6)
    }
  }, [turn.a, play, hold, gest])
  return (
    <InkText
      user={false}
      value={a.value}
      hot={a.hot}
      files={files}
      live={turn.state === 'writing'}
      tails={a.value === turn.a ? turn.output : undefined}
    />
  )
}
function Entry({
  turn,
  gest,
  motion,
  open,
}: {
  turn: Turn
  gest: Gesture
  motion: boolean
  open: (f: Float, el: Element) => void
}) {
  const animated = useRef(turn.state === 'writing' && motion),
    firstTake = useRef(turn.take),
    previous = useRef({ take: turn.take, text: turn.a })
  const [ghost, setGhost] = useState('')
  useLayoutEffect(() => {
    if (previous.current.take !== turn.take && motion) setGhost(previous.current.text)
    previous.current = { take: turn.take, text: turn.a }
  }, [turn.take, turn.a, motion])
  useEffect(() => {
    if (!ghost) return
    const t = setTimeout(() => setGhost(''), 330)
    return () => clearTimeout(t)
  }, [ghost])
  const q = useFlow(turn.q, animated.current)
  const allFiles = useMemo(() => [...turn.input, ...turn.output], [turn.input, turn.output])
  function interact(el: HTMLElement, user: boolean) {
    const target = el.closest<HTMLElement>('[data-ink]')
    if (!target || el.closest('a')) return
    const action = target.dataset.ink!,
      file = allFiles.find((f) => f.n === Number(target.dataset.ref))
    if (action === 'ref' && !file) return
    const passage = target.closest('.ink-block')
    open(
      {
        side: 'right',
        ...paperPoint(target, 'right'),
        kind: action === 'lift' ? 'lift' : (action as Float['kind']),
        text: action === 'lift' ? passage?.textContent || '' : undefined,
        turn: turn.id,
        user,
        file,
      },
      target
    )
  }
  const events = (user: boolean) => ({
    onClick: (e: MouseEvent<HTMLElement>) => interact(e.target as HTMLElement, user),
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
      if ((e.key === 'Enter' || e.key === ' ') && (e.target as HTMLElement).matches('span[role=button]')) {
        e.preventDefault()
        interact(e.target as HTMLElement, user)
      }
    },
  })
  return (
    <section className="bound-turn" data-turn={turn.id}>
      <div className="question-line" role="heading" aria-level={2} {...events(true)}>
        <InkText
          user
          value={q.value}
          hot={q.hot}
          files={turn.input}
          live={false}
          tails={q.value === turn.q ? turn.input : undefined}
        />
      </div>
      <div className="answer-lines" {...events(false)}>
        {ghost && (
          <div className="receding-ink" aria-hidden inert>
            {ghost}
          </div>
        )}
        <AnswerInk
          key={turn.take || turn.id}
          turn={turn}
          files={allFiles}
          play={motion && (animated.current || firstTake.current !== turn.take)}
          hold={q.value !== turn.q}
          gest={gest}
        />
      </div>
      {turn.error && (
        <small className="margin-error" role="status">
          {turn.error}
        </small>
      )}
    </section>
  )
}
function Composer({
  library,
  book,
  gest,
  onManage,
}: {
  library: Library
  book: Volume
  gest: Gesture
  onManage: () => void
}) {
  const files = useRef<HTMLInputElement>(null),
    field = useRef<HTMLTextAreaElement>(null),
    composing = useRef(false),
    [adding, setAdding] = useState(false)
  const drag = useRef(false)
  const busy = writing(book.id)
  const model = resolveModel(library.providers, book.main)
  const choices = model ? effortOptions(model.source, model.id) : ['default' as const]
  const send = () => {
    if (adding || busy || (!book.draft.trim() && !book.pending.length)) return
    gest('point', 'right', 0.58, 0.86)
    field.current?.blur()
    void submit(book.id).catch(report)
  }
  return (
    <div
      className="quill-zone"
      data-writing={!!book.draft || !!book.pending.length || busy || undefined}
      onClick={(e) => {
        if (e.target === e.currentTarget) field.current?.focus()
      }}
    >
      <div className="quill" role="group" aria-label="书页输入框">
        {!!book.pending.length && (
          <div className="pending-files">
            {book.pending.map((f) => (
              <span key={f.id}>
                {f.name}
                <button
                  onClick={() =>
                    editVolume(book.id, { pending: book.pending.filter((i) => i.id !== f.id) })
                  }
                  aria-label={'移除 ' + f.name}
                >
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        )}
        <PaperField
          inputRef={field}
          value={book.draft}
          aria-label="写下你的问题"
          placeholder={book.turns.length ? '续写一个问题……' : '在此写下第一个问题……'}
          autoComplete="off"
          onPointerDown={() => {
            drag.current = false
          }}
          onPointerMove={(e) => {
            if (e.buttons === 1) drag.current = true
          }}
          onSelect={(e) => {
            const n = e.currentTarget
            if (drag.current && n.selectionStart !== n.selectionEnd) {
              n.setSelectionRange(n.selectionEnd, n.selectionEnd)
            }
          }}
          onPointerUp={() => {
            drag.current = false
          }}
          onChange={(e) => editVolume(book.id, { draft: e.target.value })}
          onCompositionStart={() => {
            composing.current = true
          }}
          onCompositionEnd={() => {
            composing.current = false
          }}
          onKeyDown={(e) => {
            if (
              shouldSend({
                key: e.key,
                shiftKey: e.shiftKey,
                isComposing: composing.current || e.nativeEvent.isComposing,
                keyCode: e.nativeEvent.keyCode,
              })
            ) {
              e.preventDefault()
              send()
            }
          }}
        />
        <div className="quill-tools">
          <button
            aria-label="添加文件"
            title="添加文件"
            disabled={adding}
            onClick={() => files.current?.click()}
          >
            <Paperclip size={15} />
          </button>
          <input
            hidden
            type="file"
            multiple
            ref={files}
            onChange={async (e) => {
              const chosen = Array.from(e.target.files || [])
              e.target.value = ''
              setAdding(true)
              try {
                await attachFiles(book.id, chosen)
              } catch (err) {
                report(err)
              } finally {
                setAdding(false)
              }
            }}
          />
          {book.allowed.length ? (
            <select
              aria-label="当前书的对话模型"
              value={book.main}
              onChange={(e) => chooseModel(book, e.target.value)}
            >
              <ModelOptions library={library} book={book} />
            </select>
          ) : (
            <button onClick={onManage}>设置可用模型</button>
          )}
          <select
            aria-label="推理强度"
            title="推理强度"
            value={model ? selectedEffort(model.source, model.id, book.effort) : 'default'}
            onChange={(e) => editVolume(book.id, { effort: e.target.value as Effort })}
          >
            {choices.map((k) => (
              <option value={k} key={k}>
                {efforts[k]}
              </option>
            ))}
          </select>
          {busy ? (
            <button className="quill-send" aria-label="停笔" onClick={() => stop(book.id)}>
              <Square size={12} />
            </button>
          ) : (
            <button
              className="quill-send"
              disabled={adding || !book.main || (!book.draft.trim() && !book.pending.length)}
              aria-label="发送问题"
              onClick={send}
            >
              <ArrowUp size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default function Correspondence({
  library,
  book,
  gest,
  single,
  side,
  turnPage,
  turning,
  folio,
  scrollMark,
  onManage,
}: {
  library: Library
  book: Volume
  gest: Gesture
  single: boolean
  side: PageSide
  turnPage: (direction: number) => void
  turning: boolean
  folio: string
  scrollMark: import('./readingPosition').ScrollMark
  onManage: () => void
}) {
  const [float, setFloat] = useState<Float | null>(null),
    [retiring, setRetiring] = useState(false),
    [feedback, setFeedback] = useState(''),
    list = useRef<HTMLDivElement>(null),
    body = useRef<HTMLDivElement>(null),
    anchor = useRef<Element | null>(null),
    cue = useRef(0)
  const floatingRef = useRef<HTMLDivElement>(null)
  const cancelFlight = useRef<() => void>(() => {})
  useLayoutEffect(() => {
    const el = floatingRef.current
    if (!el) return
    const measure = () => {
      el.style.setProperty('--float-height', el.offsetHeight + 'px')
      const sheet = el.parentElement!
      const x = (float?.x ?? .5) * sheet.clientWidth - el.offsetLeft,
        y = (float?.y ?? .5) * sheet.clientHeight - el.offsetTop
      // Work in the leaf's local coordinates, not the room's projected pixels.
      el.style.setProperty('--lift-x', (x - el.offsetWidth / 2) * .32 + 'px')
      el.style.setProperty('--lift-y', (y - el.offsetHeight / 2) * .32 + 'px')
      el.style.setProperty('--spark-x', Math.max(0, Math.min(el.offsetWidth, x)) + 'px')
      el.style.setProperty('--spark-y', Math.max(0, Math.min(el.offsetHeight, y)) + 'px')
      el.style.transformOrigin = `${x}px ${y}px`
    }
    measure()
    const obs = new ResizeObserver(measure)
    obs.observe(el)
    return () => obs.disconnect()
  }, [float?.cue, float?.kind, float?.x, float?.y])
  useLayoutEffect(() => {
    const source = anchor.current, panel = floatingRef.current
    if (!source || !panel || !float) return
    cancelFlight.current = inkFlight(source, panel, float.side, retiring)
    return () => cancelFlight.current()
  }, [float?.cue, retiring])
  const motion = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  function dismiss() {
    if (retiring) return
    const el = floatingRef.current
    // Exit is decorative: an already-dismissed destructive menu must be inert.
    if (el) {
      el.inert = true
      if (el.contains(document.activeElement) && anchor.current instanceof HTMLElement)
        anchor.current.focus({ preventScroll: true })
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) setFloat(null)
    else {
      if (el) {
        // Interrupt a half-finished lift at its current frame, without a pop.
        const style = getComputedStyle(el)
        el.style.setProperty('--settle-opacity', style.opacity)
        el.style.setProperty('--settle-transform', style.transform)
        el.style.setProperty('--settle-filter', style.filter)
      }
      setRetiring(true)
    }
  }
  const show = (f: Float, el: Element) => {
    let placement: Float['placement']
    if (f.kind === 'module') {
      // Leave both printed excerpts available when moving between Memory/Profile.
      const excerpts = el.closest('.memory-print')?.querySelectorAll<HTMLElement>('.module-excerpt')
      const first = excerpts?.[0], last = excerpts?.[excerpts.length - 1]
      const sheet = el.closest<HTMLElement>('.paper')
      if (first && last && sheet) {
        const top = Math.max(.04, paperPoint(first, f.side).y - first.offsetHeight / sheet.offsetHeight / 2)
        const bottom = Math.min(.93, paperPoint(last, f.side).y + last.offsetHeight / sheet.offsetHeight / 2)
        const below = 1 - bottom >= top
        const room = (below ? 1 - bottom : top) * sheet.offsetHeight
        // Prefer an unused margin only if it fits the clearance and readable
        // text. Dense marginalia uses the normal source-relative scroll panel.
        if (room >= parseFloat(getComputedStyle(el).fontSize) * 8)
          placement = { y: below ? bottom : top, below }
      }
    }
    anchor.current = el
    setRetiring(false)
    setFeedback('')
    setFloat({ ...f, placement, cue: ++cue.current })
    const paper = el.closest('.paper')?.getBoundingClientRect()
    const width = paper?.width ? Math.min(.72, Math.max(.18, el.getBoundingClientRect().width / paper.width)) : .36
    gest('stroke', f.side, f.x, f.y, width)
  }
  useEffect(() => {
    setFloat(null)
    setRetiring(false)
  }, [side, book.id])
  useEffect(() => {
    if (!retiring) return
    // Also finish if a motion preference change cancels the CSS animation.
    const timeout = setTimeout(() => { setFloat(null); setRetiring(false) }, INK_SPELL.settle + 60)
    return () => clearTimeout(timeout)
  }, [retiring])
  useLayoutEffect(() => {
    const origin = anchor.current
    if (!float || retiring || !origin) return
    origin.classList.add('ink-selected')
    return () => origin.classList.remove('ink-selected')
  }, [float?.cue, retiring])
  useEffect(() => {
    if (!float) return
    const close = (event: PointerEvent) => {
      const target = event.target as HTMLElement
      if (!target.closest('.raised-words') && !anchor.current?.contains(target)) {
        dismiss()
      }
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation()
        e.preventDefault()
        dismiss()
      }
    }
    document.addEventListener('pointerdown', close, true)
    window.addEventListener('keydown', key, true)
    return () => {
      document.removeEventListener('pointerdown', close, true)
      window.removeEventListener('keydown', key, true)
    }
  }, [float, retiring])
  useLayoutEffect(() => {
    const pane = list.current,
      inner = body.current
    if (!pane || !inner) return
    return maintainReadingPosition(pane, inner, scrollMark)
  }, [book.id, scrollMark])
  function scrolled() {
    const pane = list.current!
    cancelFlight.current()
    if (retiring) return
    if (float?.side === 'right' && float.kind !== 'undo' && anchor.current) {
      const bounds = anchor.current.getBoundingClientRect(),
        rect = pane.getBoundingClientRect()
      if (!anchor.current.isConnected || bounds.bottom < rect.top || bounds.top > rect.bottom)
        dismiss()
      else {
        const point = paperPoint(anchor.current, 'right')
        setFloat((f) => (f ? { ...f, ...point } : null))
      }
    }
  }
  const visible = (s: PageSide) => !single || side === s
  const turn = float?.turn ? book.turns.find((t) => t.id === float.turn) : undefined
  const isMenu = float?.kind === 'actions' || float?.kind === 'both',
    isProcess = float?.kind === 'process' || float?.kind === 'both'
  const selectedFile = float?.file
  const floatAnchor = float?.placement?.y ?? Math.min(.93, Math.max(.05, float?.y ?? .5))
  const floatBelow = float?.placement?.below ?? (float?.y ?? .5) < .5
  const action = (type: 'copy' | 'erase' | 'retry') => {
    if (!turn || !float) return
    if (type === 'copy') {
      void navigator.clipboard
        .writeText(float.user ? turn.q : turn.a)
        .then(() => setFeedback('已复制'))
        .catch(() => setFeedback('复制未获系统允许'))
      return
    }
    if (type === 'retry') {
      gest('rewind', 'right', float.x, float.y)
      setFloat(null)
      void submit(book.id, turn.id).catch(report)
      return
    }
    gest('pinch', 'right', float.x, float.y)
    const item = Array.from(body.current?.children || []).find(
      (el) => (el as HTMLElement).dataset.turn === turn.id
    )
    const remove = () => {
      if (eraseTurn(book.id, turn.id)) setFloat({ ...float, kind: 'undo', turn: undefined })
    }
    if (!item || !motion) {
      remove()
      return
    }
    setFloat(null)
    const animation = item.animate(
      [
        { opacity: 1, filter: 'blur(0)', transform: 'translateY(0)' },
        { offset: 0.45, opacity: 0.8, color: '#b68a42', textShadow: '0 0 4px #dfb95e' },
        { opacity: 0, filter: 'blur(1.8px)', transform: 'translateY(-6px)' },
      ],
      { duration: 440, easing: 'ease-in', fill: 'forwards' }
    )
    animation.onfinish = remove
  }
  return (
    <>
      <article
        className="paper verso memory-leaf"
        inert={!visible('left')}
        aria-hidden={!visible('left')}
        aria-label="左页记忆与档案"
      >
        <div className="memory-print" data-muted={(!retiring && float?.side === 'left') || undefined}>
          {(book.memory || book.profile) && <h1>Marginalia</h1>}
          {(['memory', 'profile'] as const).map((field, i) => book[field] && (
            <section key={field}>
              <h2>{i ? 'Profile' : 'Memory'}</h2>
              <button
                className="module-excerpt"
                aria-label={i ? '展开 Profile 原文' : '展开 Memory 原文'}
                onClick={(e) =>
                  show(
                    {
                      side: 'left',
                      ...paperPoint(e.currentTarget, 'left'),
                      kind: 'module',
                      field,
                      title: i ? 'Profile' : 'Memory',
                      text: book[field],
                    },
                    e.currentTarget
                  )
                }
              >
                {book.summaries[field] || book[field]}
              </button>
            </section>
          ))}
        </div>
        <button className="leaf-edge backward" aria-label="上一页" disabled={turning} onClick={() => turnPage(-1)} />
        {single && (
          <button
            className="leaf-edge forward"
            aria-label="看右页对话"
            disabled={turning} onClick={() => turnPage(1)}
          />
        )}
      </article>
      <article
        className="paper recto correspondence-leaf"
        inert={!visible('right')}
        aria-hidden={!visible('right')}
        aria-label="右页对话"
      >
        <div
          className="conversation-print"
          data-muted={
            (!retiring && float?.side === 'right' && float.kind !== 'actions' && float.kind !== 'undo') || undefined
          }
        >
          <header className="chapter-fixed">
            <span className="chapter-designation">Chapter I</span>
            <h1>{book.title}</h1>
          </header>
          <div
            className="book-scroll"
            tabIndex={0}
            ref={list}
            onScroll={scrolled}
            onKeyDown={(e) => {
              if (e.target !== list.current) return
              const pane = e.currentTarget
              if (e.key === 'Home' || e.key === 'End') {
                e.preventDefault()
                pane.scrollTop = e.key === 'Home' ? 0 : pane.scrollHeight
              } else if (e.key === 'PageUp' || e.key === 'PageDown') {
                e.preventDefault()
                pane.scrollBy(0, pane.clientHeight * (e.key === 'PageUp' ? -0.9 : 0.9))
              }
            }}
            aria-label="对话正文"
          >
            <div ref={body} className="flowing-text">
              {book.turns.map((t) => (
                <Entry key={t.id} turn={t} gest={gest} motion={motion} open={show} />
              ))}
            </div>
          </div>
          <Composer library={library} book={book} gest={gest} onManage={onManage} />
        </div>
        <footer className="printed-folio">{folio}</footer>
        <button className="leaf-edge forward" aria-label="下一页" disabled={turning} onClick={() => turnPage(1)} />
        {single && (
          <button
            className="leaf-edge backward"
            aria-label="看左页记忆"
            disabled={turning} onClick={() => turnPage(-1)}
          />
        )}
      </article>
      {float && visible(float.side) && (
        <div className={'raised-sheet rise-' + float.side} aria-live="polite" style={{
          '--spell-contact': INK_SPELL.contact + 'ms',
          '--spell-rise': INK_SPELL.rise + 'ms',
          '--spell-settle': INK_SPELL.settle + 'ms',
        } as CSSProperties}>
          <div
            key={float.cue}
            ref={floatingRef}
            className={
              'raised-words ' +
              ((isMenu && !isProcess) || float.kind === 'undo' ? 'action-words' : 'detail-words')
            }
            role="dialog"
            inert={retiring}
            data-retiring={retiring || undefined}
            onAnimationEnd={(e) => {
              if (e.target === e.currentTarget && e.animationName === 'settle-ink') {
                setFloat(null)
                setRetiring(false)
              }
            }}
            data-placement={floatBelow ? 'below' : 'above'}
            aria-label={isMenu ? '浮字操作' : isProcess ? '本轮过程' : '浮起的文字'}
            style={
              {
                '--anchor': floatAnchor,
                '--float-room': floatBelow ? 1 - floatAnchor : floatAnchor,
                '--ink-x': Math.max(0.26, Math.min(0.68, float.x)),
              } as CSSProperties
            }
          >
            <div className="gold-motes" aria-hidden>
              {Array.from({ length: 10 }, (_, i) => (
                <i
                  key={i}
                  style={
                    {
                      '--i': i,
                      '--dx': Math.sin(i * 7) * 42 + 'px',
                      '--dy': -14 - (i % 5) * 7 + 'px',
                    } as CSSProperties
                  }
                />
              ))}
            </div>
            {(float.kind === 'module' || float.kind === 'lift') && (
              <div className="raised-copy">
                {float.title && <h2>{float.title}</h2>}
                {float.text?.split(/\n\s*\n/).map((p, i) => (
                  <p key={i} style={{ '--ink-line': Math.min(i + 1, 6) } as CSSProperties}>{p}</p>
                ))}
              </div>
            )}
            {isProcess && (
              <div className="raised-copy provenance">
                <h2>Process notes</h2>
                {turn?.notes.length ? (
                  turn.notes.map((n, i) => (
                    <p key={i} style={{ '--ink-line': Math.min(i + 1, 6) } as CSSProperties}>
                      <b>{n.kind}</b> {n.text}
                    </p>
                  ))
                ) : (
                  <p>本轮尚无过程记录。</p>
                )}
              </div>
            )}
            {selectedFile && (
              <div className="raised-copy">
                <small>[{selectedFile.n}]</small>
                <h2>{selectedFile.name}</h2>
                <p>{selectedFile.mime}</p>
                <button
                  onClick={async () => {
                    try {
                      if (selectedFile.url) {
                        if (/^https?:\/\//i.test(selectedFile.url)) {
                          if ('__TAURI_INTERNALS__' in window) {
                            const { openUrl } = await import('@tauri-apps/plugin-opener')
                            await openUrl(selectedFile.url)
                          } else window.open(selectedFile.url, '_blank', 'noopener,noreferrer')
                        }
                      } else {
                        const blob = await libraryFile(selectedFile.id)
                        if (!blob) throw new Error('文件未找到。')
                        downloadBlob(blob, selectedFile.name)
                      }
                    } catch (e) {
                      setFeedback(errorText(e))
                    }
                  }}
                >
                  {selectedFile.url ? '打开文件' : '保存文件'}
                </button>
              </div>
            )}
            {isMenu && turn && (
              <div className="word-actions">
                <button onClick={() => action('copy')}>复制</button>
                <button disabled={writing(book.id)} onClick={() => action('erase')}>
                  删除
                </button>
                <button disabled={writing(book.id)} onClick={() => action('retry')}>
                  重试
                </button>
              </div>
            )}
            {float.kind === 'undo' && canUndo(book.id) && (
              <button
                onClick={() => {
                  undoErase(book.id)
                  setFloat(null)
                }}
              >
                撤销删除
              </button>
            )}
            {feedback && <small role="status">{feedback}</small>}
          </div>
        </div>
      )}
    </>
  )
}
