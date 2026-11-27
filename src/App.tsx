import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { Armchair } from 'lucide-react'
import Room from './Room'
import type { Journey } from './RoomScene'
import type { DeskReading } from './deskReading'
import type { HandSignal } from './readingHand'
import { InkDebugPanel } from './InkDebug'
import { addBook, chooseBook, clearFault, useShelf } from './shelfStore'
import ShelfInscription, { type ShelfAnchor } from './ShelfInscription'
import type { Gesture } from './Correspondence'
import ManagementBook from './ManagementBook'
import PrintedEdition from './PrintedEdition'
import { isHttpUrl } from './book'
import './physicalBook.css'
import './chat.css'

export default function App() {
  const { state, ready, fault, catalog } = useShelf(),
    book = state.books.find((b) => b.id === state.selected) || state.books[0]
  const [opened, setOpened] = useState(false),
    [journey, setJourney] = useState<Journey | null>(null),
    [rig, setRig] = useState<DeskReading | null>(null)
  const [management, setManagement] = useState(false),
    [notes, setNotes] = useState(false)
  const [narrow, setNarrow] = useState(false),
    [hand, setHand] = useState<HandSignal | null>(null),
    seq = useRef(0)
  const shelf = useRef<HTMLButtonElement>(null),
    reader = useRef<HTMLElement>(null)
  const atDesk = opened || !!journey,
    single = narrow || notes
  const [font, setFont] = useState(15)
  const [inscription, setInscription] = useState<ShelfAnchor | null>(null)
  const [inscribedBook, setInscribedBook] = useState<string | null>(null)
  const inscribe = useCallback((anchor?: ShelfAnchor) => {
    setInscription(anchor || { x: 0.5, y: 0.52 })
  }, [])
  const commitInscription = (name: string) => {
    const id = addBook(name)
    if (id) {
      setInscribedBook(id)
      setInscription(null)
    }
  }
  const gest: Gesture = useCallback(
    (action, side, u, v, width) => setHand({ action, side, u, v, width, seq: ++seq.current }),
    []
  )
  const open = useCallback(() => {
    setJourney({ direction: 'out' })
  }, [])
  const reveal = useCallback(() => setOpened(true), []),
    finish = useCallback(() => setJourney(null), [])
  const close = useCallback(() => {
    setOpened(false)
    setJourney({ direction: 'back' })
  }, [])
  const manage = useCallback(() => {
    setManagement(true)
  }, [])
  useEffect(() => {
    const q = matchMedia(rig ? '(max-aspect-ratio:1/1), (max-width:559px)' : '(max-width:859px)')
    const change = () => setNarrow(q.matches)
    change()
    q.addEventListener('change', change)
    return () => q.removeEventListener('change', change)
  }, [rig])
  useLayoutEffect(() => {
    if (!atDesk || !rig) return
    rig.attach(reader.current)
    return () => rig.attach(null)
  }, [atDesk, rig])
  useLayoutEffect(() => {
    if (opened && !journey && !management) reader.current?.focus({ preventScroll: true })
    if (!opened && !journey && shelf.current) shelf.current.focus({ preventScroll: true })
  }, [opened, journey, management])
  useLayoutEffect(() => {
    const n = reader.current
    if (!n) return
    const measure = () => {
      const leaf =
        parseFloat(getComputedStyle(n).getPropertyValue('--leaf-width')) ||
        Math.min(window.innerWidth * 0.42, 500)
      setFont(Math.min(18, Math.max(single ? 16 : 13.4, leaf * 0.033)))
    }
    const ob = new ResizeObserver(measure)
    ob.observe(n)
    measure()
    return () => ob.disconnect()
  }, [atDesk, single, rig])
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if (!opened || journey || management || e.isComposing || e.keyCode === 229 || e.defaultPrevented) return
      const el = e.target instanceof Element ? e.target : null
      const editing = el?.closest('input,textarea,select,[contenteditable]:not([contenteditable=false]),[role=textbox]')
      const stand = (e.code === 'KeyS' || e.key.toLowerCase() === 's') &&
        !editing && !e.ctrlKey && !e.metaKey && !e.altKey
      if (e.key === 'Escape' || stand) {
        e.preventDefault()
        if (!e.repeat) close()
        return
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [opened, journey, management, close])
  const handleLink = async (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a')
    if (!a) return
    e.preventDefault()
    const url = a.getAttribute('href') || ''
    if (!isHttpUrl(url)) return
    if ('__TAURI_INTERNALS__' in window) {
      const { openUrl } = await import('@tauri-apps/plugin-opener')
      await openUrl(url)
    } else window.open(url, '_blank', 'noopener,noreferrer')
  }
  return (
    <div
      className={
        'app ' + (atDesk ? 'reading physical-reading' : 'in-room') + (journey ? ' in-transit' : '')
      }
      style={{ '--book-size': font + 'px' } as CSSProperties}
    >
      <div
        className="room-layer"
        inert={opened || !!journey || management || !!inscription}
        aria-hidden={opened || !!journey || management || !!inscription}
      >
        <Room
          books={catalog}
          selectedBook={book.id}
          onSelectBook={chooseBook}
          onInscribe={inscribe}
          inscribing={!!inscription}
          inscribedBook={inscribedBook}
          onOpen={open}
          onManage={manage}
          managing={management}
          hand={hand}
          bookAway={opened || !!journey}
          shelfRef={shelf}
          journey={journey}
          onReveal={reveal}
          onFinish={finish}
          onReadingRig={setRig}
        />
      </div>
      {atDesk && (
        <section
          className={
            'reader-surface' + (rig ? ' desk-surface' : ' flat-book') + (single ? ' one-paper' : '')
          }
          data-journey={journey?.direction}
          onContextMenu={(e) => {
            if (!(e.target as HTMLElement).closest('input,textarea,[contenteditable=true]')) e.preventDefault()
          }}
          ref={reader}
          aria-label="窗边书桌上的书"
          tabIndex={-1}
          inert={!!journey || management}
          aria-hidden={!!journey}
        >
          {opened && rig && <InkDebugPanel />}
          <main className="workspace" onClick={(e) => void handleLink(e)}>
            <div className="book-stage">
              {ready ? (
                <PrintedEdition
                  key={book.id}
                  deskRig={rig}
                  single={single}
                  library={state}
                  book={book}
                  gest={gest}
                  active={opened && !journey && !management}
                  onManage={manage}
                />
              ) : (
                <div role="status">正在取出书页…</div>
              )}
            </div>
          </main>
        </section>
      )}
      {inscription && (
        <ShelfInscription
          anchor={inscription}
          ready={ready}
          error={ready ? '' : fault}
          onCommit={commitInscription}
          onCancel={() => setInscription(null)}
        />
      )}
      {opened && !journey && !management && (
        <button className="leave-desk" aria-label="起身离开书桌" aria-keyshortcuts="S Escape" onClick={close}>
          <Armchair size={19} />
        </button>
      )}
      {management && ready && (
        <ManagementBook library={state} onClose={() => setManagement(false)} singlePage={notes} setSinglePage={setNotes} />
      )}
      {fault && (
        <div className="chat-feedback" role="alert">
          {fault}
          <button onClick={clearFault}>关闭</button>
        </div>
      )}
    </div>
  )
}
