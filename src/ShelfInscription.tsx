import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { Check, X } from 'lucide-react'
import './shelfInscription.css'

export type ShelfAnchor = { x: number; y: number }

export default function ShelfInscription({
  anchor, ready, error, onCommit, onCancel,
}: {
  anchor: ShelfAnchor
  ready: boolean
  error: string
  onCommit: (title: string) => void
  onCancel: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const composing = useRef(false)
  const compositionEnded = useRef(-Infinity)
  const [title, setTitle] = useState('')
  const duringComposition = () => composing.current || performance.now() - compositionEnded.current < 35
  useLayoutEffect(() => {
    const el = dialog.current!
    el.showModal()
    input.current?.focus({ preventScroll: true })
    return () => el.close()
  }, [])
  return (
    <dialog
      ref={dialog}
      aria-label="为新书题名"
      className="shelf-inscription"
      style={{ '--anchor-x': anchor.x * 100 + '%', '--anchor-y': anchor.y * 100 + '%' } as CSSProperties}
      onCancel={(e) => {
        e.preventDefault()
        if (!duringComposition()) onCancel()
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div className="shelf-label-position">
        <form
          className="shelf-title-slip"
          onSubmit={(e) => {
            e.preventDefault()
            if (!duringComposition() && ready && title.trim()) onCommit(title.trim())
          }}
        >
          <input
            ref={input}
            aria-label="书名"
            placeholder="题写书名…"
            enterKeyHint="done"
            autoComplete="off"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onCompositionStart={() => { composing.current = true }}
            onCompositionEnd={() => {
              composing.current = false
              compositionEnded.current = performance.now()
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) compositionEnded.current = performance.now()
            }}
          />
          <button type="submit" aria-label="将新书收入书架" title="收入书架" disabled={!ready || !title.trim()}>
            <Check size={20} strokeWidth={1.4} />
          </button>
          <button type="button" aria-label="取消添书" title="取消" onClick={onCancel}>
            <X size={15} strokeWidth={1.35} />
          </button>
          <span className="shelf-label-dust" aria-hidden="true">
            {Array.from({ length: 9 }, (_, i) => (
              <i key={i} style={{ '--grain': i, left: (5 + (i * 29) % 89) + '%' } as CSSProperties} />
            ))}
          </span>
        </form>
        {error && <small className="shelf-label-error" role="alert">{error}</small>}
      </div>
    </dialog>
  )
}
