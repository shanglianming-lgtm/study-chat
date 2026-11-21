import { ArrowUpRight, BookOpen, Sparkles } from 'lucide-react'

export default function Room({ onOpen }: { onOpen: () => void }) {
  return <section className="room-view" aria-label="书房">
    <div className="room-intro"><div className="eyebrow"><span /> A QUIET PLACE FOR YOUR MIND</div><h1>思绪，在这里<span>慢慢成书。</span></h1><p>让对话离开信息流，回到纸页之间。<br />取下一本书，从一个念头开始。</p><button className="primary room-cta" onClick={onOpen}>取下这本书 <ArrowUpRight size={17} /></button><div className="intro-note"><Sparkles size={13} /> 一间书房 · 一本书 · 你的下一段思考</div></div>
    <div className="room-art" aria-label="有窗、台灯、书桌和书架的分层书房插画">
      <div className="room-wall" /><div className="room-floor" />
      <div className="sunlight" /><div className="window-frame"><div className="window-sky"><div className="hill hill-one" /><div className="hill hill-two" /><div className="tree-trunk" /><div className="tree-canopy" /></div><i /><b /><div className="window-sill" /></div>
      <div className="wall-print"><div>山<br />间</div><span>STILLNESS / 01</span></div>
      <div className="shelf"><div className="shelf-shadow" /><div className="shelf-top"><i className="vase" /><i className="vase-branch" /><div className="little-books"><i /><i /><i /></div></div><div className="shelf-books"><i className="decor-book b1" /><i className="decor-book b2" /><button className="spine" onClick={onOpen} aria-label="取下《与自己的漫长对话》"><small>书房文库 · 001</small><strong>与自己的漫长对话</strong><BookOpen size={19} /><span className="spine-tip">点击取书 ↗</span></button><i className="decor-book b3" /><i className="decor-book b4" /></div><div className="shelf-plank" /><div className="shelf-bottom"><i /><i /><i /></div></div>
      <div className="desk"><div className="desk-top" /><div className="desk-edge" /><div className="desk-leg leg-left" /><div className="desk-leg leg-right" /><div className="desk-notebook"><i /></div><div className="pencil" /><div className="mug"><i /></div><div className="lamp"><i className="lamp-base" /><i className="lamp-arm" /><i className="lamp-neck" /><i className="lamp-shade" /><i className="lamp-glow" /></div></div>
      <div className="chair"><i /><b /></div><div className="plant"><div className="plant-leaves"><i /><i /><i /><i /><i /></div><div className="plant-pot" /></div><div className="room-caption"><span className="live-dot" /> 午后的书房 <span>光线正好，适合想一想。</span></div>
    </div>
    <div className="room-bottom"><span>01 / 我的书架</span><div><span className="book-dot" /> 与自己的漫长对话 <small>示例藏书 · 可继续书写</small></div><span>没有通知，只有下一页。</span></div>
  </section>
}
