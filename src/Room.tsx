import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, BookOpen, MousePointer2, Play, Volume2, VolumeX } from 'lucide-react'
import { roomSoundEnabled } from './studySound'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { flatDeskJourneyMs } from './deskSeat'
import RoomScene, { initialRoomStatus, type RoomControls, type Journey, type RoomObject, type ShelfInteraction } from './RoomScene'
import type { HandSignal } from './readingHand'
import type { DeskReading } from './deskReading'
import './studyEntrance.css'

export default function Room({
  onOpen,
  bookAway,
  shelfRef,
  journey,
  onReveal,
  onFinish,
  onReadingRig, onManage, managing, hand,
  books, selectedBook, onSelectBook, inscribing, inscribedBook, onInscribe,
}: ShelfInteraction & {
  onOpen: () => void
  onManage: () => void
  managing: boolean
  hand: HandSignal|null
  bookAway: boolean
  shelfRef: RefObject<HTMLButtonElement | null>
  journey: Journey | null
  onReveal: () => void
  onFinish: () => void
  onReadingRig: (rig: DeskReading | null) => void
}) {
  const [unavailable, setUnavailable] = useState(false),
    [status, setStatus] = useState(initialRoomStatus)
  const [fallbackEntered, setFallbackEntered] = useState(false)
  const [soundEnabled, setSoundEnabled] = useState(roomSoundEnabled)
  const controls = useRef<RoomControls | null>(null)
  useEffect(() => {
    if (!unavailable || !journey) return
    const delay = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : flatDeskJourneyMs
    const timer = window.setTimeout(() => {
      if (journey.direction === 'out') onReveal()
      onFinish()
    }, delay)
    return () => window.clearTimeout(timer)
  }, [unavailable, journey, onReveal, onFinish])
  function shortcut(object: RoomObject, label: string, ref?: RefObject<HTMLButtonElement | null>) {
    return (
      <button
        ref={ref}
        className="room-key-action"
        onFocus={() => controls.current?.focus(object)}
        onBlur={() => controls.current?.focus(null)}
        onClick={() => controls.current?.activate(object)}
      >
        {label}
      </button>
    )
  }

  return (
    <section
      className={'walk-room' + (bookAway ? ' at-desk' : '') + (unavailable ? ' no-webgl' : '')}
      aria-label="第一人称书房"
    >
      <RoomScene
        soundEnabled={soundEnabled}
        onManage={onManage} managing={managing} hand={hand}
        books={books} selectedBook={selectedBook} onSelectBook={onSelectBook}
        inscribing={inscribing} inscribedBook={inscribedBook} onInscribe={onInscribe}
        controlsRef={controls}
        onOpen={onOpen}
        bookAway={bookAway}
        journey={journey}
        onReveal={onReveal}
        onFinish={onFinish}
        onReadingRig={onReadingRig}
        onUnavailable={() => setUnavailable(true)}
        onStatus={setStatus}
      />
      {!unavailable && (
        <>
          {!status.entered && !status.busy && shortcut('door', '推开书房门')}
          {status.entered && !status.paused && (
            <div className="room-access" inert={status.busy}>
              {shortcut('shelf', status.carrying ? '将书放回书架' : '从书架取书', shelfRef)}
              {!status.carrying && <>
                {shortcut('register','打开管理书')}
                {shortcut('inscribe','在书柜添一本书')}
                {books.filter(book => book.id !== selectedBook).map(book => (
                  <span key={book.id}>{shortcut(`volume:${book.id}`, '取阅《' + book.name + '》')}</span>
                ))}
              </>}
              {status.carrying && shortcut('desk', '在窗边落座阅读')}
              {shortcut('window', '开合窗扇')}
            </div>
          )}
          {status.paused && (
            <div className="room-paused">
              <button
                autoFocus
                aria-label="继续走动"
                title="继续走动"
                onClick={() => controls.current?.resume()}
              >
                <Play size={20} />
              </button>
              <button
                aria-label="锁定鼠标并继续"
                title="锁定鼠标并继续"
                onClick={() => controls.current?.resume(true)}
              >
                <MousePointer2 size={18} />
              </button>
              <button
                aria-label="书房环境音"
                aria-pressed={soundEnabled}
                title={soundEnabled ? '静音' : '开启书房环境音'}
                onClick={() => {
                  const next = !soundEnabled
                  setSoundEnabled(next)
                  try { localStorage.setItem('study-room-muted', String(!next)) } catch { /* Session only. */ }
                  if (next) controls.current?.unlockSound()
                }}
              >
                {soundEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
              </button>
            </div>
          )}
          {status.entered && !status.paused && !status.busy && (
            <div className="room-touch-pad">
              {(
                [
                  ['ArrowUp', '前进', ArrowUp],
                  ['ArrowLeft', '左转', ArrowLeft],
                  ['ArrowDown', '后退', ArrowDown],
                  ['ArrowRight', '右转', ArrowRight],
                ] as const
              ).map(([key, label, Icon]) => (
                <button
                  key={key}
                  aria-label={label}
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId)
                    controls.current?.press(key)
                  }}
                  onLostPointerCapture={() => controls.current?.release(key)}
                  onPointerUp={() => controls.current?.release(key)}
                  onPointerCancel={() => controls.current?.release(key)}
                >
                  <Icon size={17} />
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {unavailable && (
        <div className={'room-flat-entrance' + (fallbackEntered ? ' arrived' : '')}>
          {fallbackEntered ? (
            <><button ref={shelfRef} className="room-flat-book" onClick={onOpen}>
              <BookOpen size={22} />
              取书阅读
            </button>
              <div className="flat-library-tools">
                <button onClick={() => onInscribe()}>添书</button>
                <button onClick={onManage}>管理书</button>
              </div></>
          ) : (
            <button
              autoFocus
              className="room-flat-door"
              aria-label="推开书房门"
              onClick={() => setFallbackEntered(true)}
            >
              <span>书房</span>
              <i />
            </button>
          )}
        </div>
      )}
    </section>
  )
}
