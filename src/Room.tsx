import { ArrowUp, ArrowDown, ArrowLeft, ArrowRight, BookOpen, Footprints, MousePointer2 } from 'lucide-react'
import { useRef, useState, type RefObject, type ReactNode } from 'react'
import RoomScene, { initialRoomStatus, type RoomControls, type Journey } from './RoomScene'

export default function Room({ onOpen, bookAway, shelfRef, journey, onReveal, onFinish }: {
  onOpen: () => void; bookAway: boolean; shelfRef: RefObject<HTMLButtonElement | null>
  journey: Journey | null; onReveal: () => void; onFinish: () => void
}) {
  const [unavailable, setUnavailable] = useState(false), [status, setStatus] = useState(initialRoomStatus), [help, setHelp] = useState(false)
  const controls = useRef<RoomControls | null>(null)
  const action = status.target === 'shelf' ? status.carrying ? '放回书架' : '取下这本书' : status.target === 'desk' ? '坐下，摊开书' : status.carrying ? '走近窗边书桌' : '走近书架取书'
  const pad = (key: string, label: string, icon: ReactNode) => <button aria-label={label} onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); controls.current?.press(key) }} onPointerUp={() => controls.current?.release(key)} onPointerCancel={() => controls.current?.release(key)} onLostPointerCapture={() => controls.current?.release(key)} onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); controls.current?.press(key) } }} onKeyUp={() => controls.current?.release(key)} onBlur={() => controls.current?.release(key)}>{icon}</button>
  return <section className="walk-room" aria-label="第一人称书房">
    <RoomScene onOpen={onOpen} bookAway={bookAway} controlsRef={controls} journey={journey} onReveal={onReveal} onFinish={onFinish} onUnavailable={() => setUnavailable(true)} onStatus={setStatus} />
    <div className="walk-shade" />
    <div className="walk-location"><span>私人书房 / 午后</span><small>有些想法，值得慢一点。</small></div>
    {!unavailable && status.entered && <>
      <div className="walk-objective"><span>{status.carrying ? '02' : '01'}</span><div><small>{status.carrying ? '手中 · 与自己的漫长对话' : '书架 · 与自己的漫长对话'}</small><strong>{status.carrying ? '在窗边，留下一段对话。' : '先找一本，愿意翻开的书。'}</strong></div></div>
      <div className={`walk-crosshair ${status.target ? 'near' : ''}`} aria-hidden="true" />
      <div className="walk-interaction" aria-live="polite"><p>{status.hint}</p><button ref={shelfRef} className={status.target ? 'ready' : ''} onClick={() => controls.current?.interact()} aria-disabled={!status.target || status.busy}><kbd>E</kbd>{status.busy ? '慢慢来…' : action}</button></div>
      <div className="walk-bottom"><span><kbd>W A S D</kbd> 行走 <i /> 鼠标{status.locked ? '转头' : '拖动转头'} <i /> <kbd>Esc</kbd> 暂停</span><button onClick={() => setHelp(!help)}>{help ? '收起辅助操作' : '辅助操作'}</button></div>
      <div className={`walk-pad ${help ? 'show' : ''}`} aria-label="辅助行走控制">{pad('ArrowUp', '向前走', <ArrowUp size={18} />)}{pad('KeyA', '向左走', <ArrowLeft size={18} />)}{pad('ArrowDown', '向后走', <ArrowDown size={18} />)}{pad('KeyD', '向右走', <ArrowRight size={18} />)}<button aria-label="向左转头" onClick={() => controls.current?.turn(Math.PI / 6)}>↶</button><button aria-label="向右转头" onClick={() => controls.current?.turn(-Math.PI / 6)}>↷</button></div>
    </>}
    {!unavailable && (!status.entered || status.paused) && <div className="walk-welcome"><div>
      <span className="walk-overline">A ROOM OF YOUR OWN</span>
      <h1>{status.paused ? '稍作停留。' : '门开着，进来坐坐。'}</h1>
      <p>{status.paused ? '书和思绪，都还在原处。' : '走向书架，取下一本书。\n到窗边坐下，把一轮对话写进去。'}</p>
      <button className="walk-enter" onClick={() => controls.current?.enter()}><Footprints size={17} />{status.paused ? '继续走动' : '走进书房'}<span>↗</span></button>
      <small><MousePointer2 size={12} /> WASD 行走 · 鼠标转头 · E 交互<br />也可用方向键；触屏拖动转头，屏幕按钮行走。</small>
      <button className="walk-free" onClick={() => controls.current?.enter(false)}>不锁定鼠标，使用拖动视角与辅助按钮</button>
    </div></div>}
    {unavailable && <div className="walk-welcome"><div><BookOpen size={28} /><h1>书仍然为你打开。</h1><p>此环境无法显示三维书房，仍可直接阅读和对话。</p><button ref={shelfRef} className="walk-enter" onClick={onOpen}>取书阅读</button></div></div>}
  </section>
}
