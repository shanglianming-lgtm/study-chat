import { ArrowUpRight, Move, Sparkles } from 'lucide-react'
import { useState, type RefObject } from 'react'
import RoomScene, { type Journey } from './RoomScene'

export default function Room({ onOpen, bookAway, shelfRef, journey, onReveal, onFinish }: {
  onOpen: () => void; bookAway: boolean; shelfRef: RefObject<HTMLButtonElement | null>
  journey: Journey | null; onReveal: () => void; onFinish: () => void
}) {
  const [unavailable, setUnavailable] = useState(false)
  return <section className="room-view" aria-label="三维书房">
    <div className="room-intro"><div className="eyebrow"><span /> A ROOM OF YOUR OWN</div><h1>思绪，在这里<span>慢慢成书。</span></h1><p>让对话离开信息流，回到纸页之间。<br />取下一本书，从一个念头开始。</p><button className="primary room-cta" onClick={onOpen}>取下这本书 <ArrowUpRight size={17} /></button><div className="intro-note"><Sparkles size={13} /> 一间书房 · 一本书 · 你的下一段思考</div></div>
    <div className="room-art room-3d" aria-label="可拖动观察的三维书房：窗、台灯、书桌、书架和植物">
      <RoomScene onOpen={onOpen} bookAway={bookAway} shelfRef={shelfRef} journey={journey} onReveal={onReveal} onFinish={onFinish} onUnavailable={() => setUnavailable(true)} />
      <button className={`scene-spine-button ${bookAway ? 'book-away' : ''} ${unavailable ? 'scene-fallback-button' : ''}`} ref={shelfRef} onClick={onOpen} aria-label="取下《与自己的漫长对话》"><span>与自己的漫长对话 · 取书 ↗</span></button>
      <div className="scene-instructions"><Move size={13} /><span>{unavailable ? '三维预览不可用，仍可点击取书阅读' : '拖动观察 · 滚轮缩放 · 点击书脊取书'}</span><b>3D</b></div>
    </div>
    <div className="room-bottom"><span>01 / 我的书架</span><div><span className="book-dot" /> 与自己的漫长对话 <small>示例藏书 · 可继续书写</small></div><span>没有通知，只有下一页。</span></div>
  </section>
}
