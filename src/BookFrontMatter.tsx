import { useLayoutEffect, useRef, type RefObject, type TextareaHTMLAttributes } from 'react'
import type { ModuleName, Volume } from './library'
import type { PageKind } from './content'
import { editVolume } from './shelfStore'

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
      node.style.overflowY = node.scrollHeight > node.clientHeight + 1 ? 'auto' : 'hidden'
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

export default function BookFrontMatter({ kind, book, onEdit }: {
  kind: PageKind; book: Volume; onEdit: (field: ModuleName | null) => void
}) {
  const imprint = book.imprint || {}
  function imprintField(key: keyof NonNullable<Volume['imprint']>, label: string) {
    return <PaperField aria-label={label} placeholder={label} value={imprint[key] || ''}
      onChange={e => editVolume(book.id, { imprint: { ...imprint, [key]: e.target.value } })} />
  }
  if (kind === 'cover') return <div className="edition-half-title"><h1>{book.name}</h1></div>
  if (kind === 'title') return <div className="edition-title">
    <h1>{book.name}</h1>
    {imprintField('author', '作者')}
    <div className="edition-imprint">{imprintField('publisher', '出版者')}</div>
  </div>
  if (kind === 'imprint') return <div className="edition-copyright">
    <p><i>{book.name}</i></p>
    {imprint.author && <p>{imprint.author}</p>}
    <PaperField aria-label="版次" value={imprint.edition ?? 'Private edition'}
      onChange={e => editVolume(book.id, { imprint: { ...imprint, edition: e.target.value } })} />
    {imprint.publisher && <p>{imprint.publisher}</p>}
  </div>
  if (kind === 'colophon') return <div className="edition-colophon"><h1>Colophon</h1>
    <p>Set in <i>Crimson Text</i> and <i>Noto Serif SC</i>.</p></div>
  if (kind === 'preface' || kind === 'profile') {
    const field = kind === 'preface' ? 'memory' : 'profile'
    const label = field === 'memory' ? '写序言' : '写读者小记'
    return <div className="edition-preface"><h1 className="front-opening">{field === 'memory' ? 'Preface' : 'A Note on the Reader'}</h1>
      <PaperField aria-label={label} placeholder={label} value={book[field]}
        onFocus={() => onEdit(field)} onBlur={() => onEdit(null)}
        onChange={e => editVolume(book.id, { [field]: e.target.value })} />
    </div>
  }
  return null
}
