import { useLayoutEffect, useRef, type RefObject, type TextareaHTMLAttributes } from 'react'
import { BOOK_TITLE } from './content'

export type BookMetadata = { author: string; edition: string; publisher: string; provider: string; memory: string; profile: string }
export const initialMetadata: BookMetadata = {
  author: 'The Reader & Study', edition: 'First edition · 2026', publisher: 'Study Press · Prototype imprint',
  provider: 'Local specimen · no external provider',
  memory: '记忆摘要示例：这本书为持续的对话保留位置。我们希望把问题写具体，区分事实与判断，并为下一次回来留下一条线索。\n\n这不是从历史记录生成的记忆；你可以在纸页上改写它。',
  profile: '读者档案示例\n\n我希望一次认真读完一个问题，保留自己的语言，并在具体的生活片段中找到下一步。\n\n这不是读取或推断的个人资料；你可以把这里写成自己的介绍。',
}

export function PaperField({ inputRef, value, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { inputRef?: RefObject<HTMLTextAreaElement | null> }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    let active = true
    const fit = () => {
      if (!active) return
      node.style.height = '0px'
      const height = node.scrollHeight + 2
      node.style.height = `${Math.min(height, 210)}px`
      node.style.overflowY = height > 210 ? 'auto' : 'hidden'
    }
    fit()
    let width = node.clientWidth
    const observer = new ResizeObserver(() => {
      if (node.clientWidth !== width) { width = node.clientWidth; fit() }
    })
    observer.observe(node)
    void document.fonts.ready.then(fit)
    return () => { active = false; observer.disconnect() }
  }, [value])
  return <textarea {...props} value={value} ref={node => { ref.current = node; if (inputRef) inputRef.current = node }} className={`paper-field ${props.className || ''}`} rows={1} />
}

export default function BookFrontMatter({ kind, metadata, change, model, setModel, effort, setEffort }: {
  kind: string; metadata: BookMetadata; change: (key: keyof BookMetadata, value: string) => void;
  model: string; setModel: (value: string) => void; effort: string; setEffort: (value: string) => void;
}) {
  if (kind === 'cover') return <div className="half-title"><span>STUDY LIBRARY · VOLUME I</span><h1>A Long Conversation<br />with Myself</h1><p>{BOOK_TITLE}</p><i className="printer-flower">❧</i></div>
  if (kind === 'title') return <div className="title-leaf"><span className="chapter-kicker">A COMMONPLACE BOOK</span><h1>A Long<br />Conversation<br /><em>with Myself</em></h1><p>{BOOK_TITLE}</p><div className="title-author"><PaperField name="author" aria-label="作者" value={metadata.author} onChange={event => change('author', event.target.value)} /></div><div className="title-imprint"><i className="printer-flower">❧</i><PaperField name="publisher" aria-label="出版者" value={metadata.publisher} onChange={event => change('publisher', event.target.value)} /><PaperField name="edition" aria-label="版次" value={metadata.edition} onChange={event => change('edition', event.target.value)} /></div></div>
  if (kind === 'imprint') return <div className="imprint-leaf"><span className="chapter-kicker">COPYRIGHT &amp; IMPRINT</span><p>A Long Conversation with Myself<br />© 2026 {metadata.author || 'The Reader'}</p><PaperField name="edition-imprint" aria-label="出版版次" value={metadata.edition} onChange={event => change('edition', event.target.value)} /><p>A digital, clothbound specimen.<br />Not a registered publication. No ISBN assigned.</p><dl><dt>Publisher</dt><dd><PaperField name="publisher-imprint" aria-label="出版信息" value={metadata.publisher} onChange={event => change('publisher', event.target.value)} /></dd><dt>Model · simulated</dt><dd><select id="study-model" name="model" className="paper-field" aria-label="示例模型（模拟）" value={model} onChange={event => setModel(event.target.value)}><option>Study · Reflective</option><option>Study · Quiet</option></select></dd><dt>Provider</dt><dd><PaperField name="provider" aria-label="提供商资料（示例）" value={metadata.provider} onChange={event => change('provider', event.target.value)} /></dd><dt>Composition</dt><dd><select id="study-effort" name="effort" className="paper-field" aria-label="推理强度（模拟）" value={effort} onChange={event => setEffort(event.target.value)}><option>标准推理</option><option>深入推理</option><option>轻量推理</option></select></dd></dl><p className="imprint-note">Text set in Noto Serif SC. Responses, reasoning summaries and tool records are local specimens, not model output. Nothing is sent; edits last only in this window.</p></div>
  if (kind === 'preface') return <div className="front-essay"><span className="chapter-kicker">PREFACE</span><h1>A place to return to</h1><p>把记得的事，留在开篇。让下一次翻开这本书时，对话有迹可循。</p><h6>Memory summary · 示例</h6><PaperField name="memory-summary" aria-label="记忆总结（示例，可编辑）" value={metadata.memory} onChange={event => change('memory', event.target.value)} /><p className="colophon-note">A specimen memory, open to revision.</p></div>
  return <div className="front-essay"><span className="chapter-kicker">ABOUT THE READER</span><h1>In your own words</h1><p>这本书写给谁，由你自己落笔。</p><PaperField name="reader-profile" aria-label="读者 profile（示例，可编辑）" value={metadata.profile} onChange={event => change('profile', event.target.value)} /><p className="colophon-note">A specimen profile, not an inferred identity.</p></div>
}
