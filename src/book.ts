import DOMPurify from 'dompurify'
import { Lexer, Marked, Renderer } from 'marked'
import { parse as parseDomain } from 'tldts'
import remend from 'remend'
import { SOURCE_CARD_HTML, type Section, type PageKind, type ProcessRecord } from './content'

export type BookPage = { sectionId: string; title: string; html: string; kind?: PageKind | 'blank'; role?: 'user' | 'assistant'; live?: boolean; tocStart?: number; tocEnd?: number; offset?: number; number?: number; folio?: string }
export type ReadingPosition = { sectionId: string; offset: number }

// Consume only this broken inline link, never following paragraphs. Until a
// destination closes, its printed URL is text rather than a guessed target.
const manuscriptParser = new Marked({ extensions: [{
  name: 'unfinishedLink', level: 'inline',
  start: source => source.indexOf('['),
  tokenizer(source) {
    if (source[0] !== '[') return
    let labelDepth = 1
    let labelEnd = -1
    for (let i = 1; i < source.length; i++) {
      if (source[i] === '\\') { i++; continue }
      if (source[i] === '[') labelDepth++
      if (source[i] === ']' && --labelDepth === 0) { labelEnd = i; break }
    }
    // A reference label must not be swallowed while searching for a later ](.
    if (labelEnd < 0 || source[labelEnd + 1] !== '(' || Lexer.lexInline(source)[0]?.type === 'link') return
    const destinationStart = labelEnd + 2
    const end = source.indexOf('\n', destinationStart)
    const raw = source.slice(0, end < 0 ? undefined : end)
    let depth = 1
    for (let i = destinationStart; i < raw.length; i++) {
      if (raw[i] === '\\') { i++; continue }
      if (raw[i] === '(') depth++
      if (raw[i] === ')' && --depth === 0) return
    }
    return { type: 'unfinishedLink', raw, tokens: this.lexer.inlineTokens(source.slice(1, labelEnd)), destination: raw.slice(destinationStart) }
  },
  renderer(token) {
    const destination = String(token.destination).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    return `<span class="incomplete-link">${this.parser.parseInline(token.tokens || [])}${destination ? ` (${destination})` : ''}</span>`
  },
}] })

export function romanFolio(value: number): string {
  let result = ''
  for (const [n, symbol] of [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']] as const) {
    while (value >= n) { result += symbol; value -= n }
  }
  return result
}

export function processRecordHtml(record: ProcessRecord, sectionId?: string, expanded = false): string {
  const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  if (sectionId) return `<details class="process-record" data-record="${escape(sectionId)}"${expanded ? ' open' : ''}><summary>Notes &amp; sources · ${expanded ? '收起过程附页' : '展开过程附页'}（示例）</summary>${expanded ? '<p>Editorial notes continue on the following leaves. 翻页阅读过程记录。</p>' : ''}</details>`
  return `<details class="process-record"><summary>Notes &amp; sources · 过程记录（示例）</summary><h6>Reasoning summary · 推理摘要示例</h6><p>先明确问题，再给出可尝试的小步骤。这是预写的摘要示例，不是模型的隐藏思维链。</p><h6>Tool record · 工具调用示例</h6><p><code>reference.lookup</code> — illustrative only; not executed. 参数：当前问题；示例结果：阅读笔记。没有执行工具或访问网页。</p><p>Model: ${escape(record.model)} · ${escape(record.effort)}. Local template; no model request.</p>${SOURCE_CARD_HTML}</details>`
}

export function safeMarkdown(markdown: string, streaming = false): string {
  // An unfinished fenced block stays literal until its closing fence arrives.
  const fences = [...markdown.matchAll(/^\s*(`{3,}|~{3,})/gm)]
  if (streaming && fences.length % 2) {
    const start = fences[fences.length - 1].index!
    const prefix = safeMarkdown(markdown.slice(0, start))
    const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    return `${prefix}<pre class="unfinished">${escape(markdown.slice(start))}</pre>`
  }
  const renderer = new Renderer()
  const renderLink = renderer.link
  renderer.link = function (token) {
    // Only bare GFM URLs need prose-boundary repair. Explicit Markdown links
    // keep their exact destinations, even when their labels are also URLs.
    if (!/^https?:\/\//i.test(token.raw)) return renderLink.call(this, token)
    const authority = token.raw.match(/^https?:\/\/[^/?#]*/i)?.[0] || ''
    const boundaries = [token.raw.search(/[“”‘’「」『』《》〈〉【】〔〕]/u), authority.search(/[，！？；：、]/u)].filter(index => index >= 0)
    // An ideographic stop can also be a legal IDN label separator. Preserve
    // recognized complete domains; otherwise end prose after a valid host.
    const host = token.raw.slice(0, boundaries.length ? Math.min(...boundaries) : undefined).match(/^https?:\/\/[^/?#]*/i)?.[0] || ''
    const publicHost = (url: string) => {
      try { const parsed = parseDomain(new URL(url).hostname); return parsed.isIcann && !!parsed.domain } catch { return false }
    }
    if (host.includes('。') && !publicHost(host)) {
      const stop = [...host.matchAll(/。/gu)].find(match => publicHost(host.slice(0, match.index)))
      if (stop) boundaries.push(stop.index!)
    }
    if (!boundaries.length) return renderLink.call(this, token)
    const end = Math.min(...boundaries)
    const clean = token.raw.slice(0, end)
    const suffix = token.raw.slice(end).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    return renderLink.call(this, { ...token, href: clean, text: clean, tokens: [{ type: 'text', raw: clean, text: clean }] }) + suffix
  }
  const html = DOMPurify.sanitize(manuscriptParser.parse(markdown, { async: false, renderer }) as string, {
    ALLOWED_TAGS: ['p', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 'blockquote', 'ul', 'ol', 'li', 'pre', 'code', 'a', 'hr', 'del', 'span'],
    ALLOWED_ATTR: ['href', 'title', 'class', 'start'],
  })
  const template = document.createElement('template')
  template.innerHTML = html
  template.content.querySelectorAll('.incomplete-link a').forEach(anchor => anchor.replaceWith(...Array.from(anchor.childNodes)))
  template.content.querySelectorAll('pre').forEach(pre => { if (!pre.textContent?.trim()) pre.remove() })
  // Sanitizing an unsupported HTML container can leave bare text or inline
  // nodes at the root. Normalize those into blocks so pagination cannot skip it.
  let paragraph: HTMLParagraphElement | null = null
  for (const node of Array.from(template.content.childNodes)) {
    const inline = node.nodeType === Node.TEXT_NODE || (node instanceof Element && node.matches('a,strong,em,code,del,br,span'))
    if (!inline) { paragraph = null; continue }
    if (!paragraph && !node.textContent?.trim() && node.nodeType === Node.TEXT_NODE) continue
    if (!paragraph) { paragraph = document.createElement('p'); template.content.insertBefore(paragraph, node) }
    paragraph.append(node)
  }
  template.content.querySelectorAll('a').forEach(anchor => {
    if (!isHttpUrl(anchor.getAttribute('href') || '')) anchor.removeAttribute('href')
  })
  return template.innerHTML
}

export function isHttpUrl(url: string): boolean {
  try { return ['http:', 'https:'].includes(new URL(url).protocol) } catch { return false }
}

export function stoppedManuscript(markdown: string): string {
  const fences = [...markdown.matchAll(/^\s*(`{3,}|~{3,})/gm)]
  const close = fences.length % 2 ? `\n${fences.at(-1)![1]}` : ''
  // Only complete inline styles: link repair can mistake malformed quoted
  // input for an interrupted destination and discard already-written paragraphs.
  const bound = remend(markdown + close, { links: false, images: false, katex: false, comparisonOperators: false, htmlTags: false, setextHeadings: false, singleTilde: false })
  return `${bound}\n\n*本轮已停笔。*`
}

// Trim a deep clone instead of Range.cloneContents, which loses ancestors when
// both boundaries are inside the same text node (e.g. a link-only paragraph).
export function sliceElement(element: Element, start: number, end: number): string {
  const clone = element.cloneNode(true) as Element
  const orderedLists = [...(clone.matches('ol') ? [clone] : []), ...clone.querySelectorAll('ol')]
  const listNumbers = new Map<Element, number>()
  for (const list of orderedLists) {
    const first = Number(list.getAttribute('start') || 1)
    Array.from(list.children).forEach((item, index) => listNumbers.set(item, first + index))
  }
  const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
  const itemStarts = new Map<Element, number>()
  const nodes: Node[] = []
  while (walker.nextNode()) nodes.push(walker.currentNode)
  let offset = 0
  for (const node of nodes) {
    if (node instanceof Element) {
      if (node.tagName === 'LI') itemStarts.set(node, offset)
      if (node.tagName === 'BR') {
        // Hard breaks consume a position just like a character. Keeping every
        // break in every fragment makes even one-character fragments overflow.
        if (offset < start || offset >= end) node.remove()
        offset += 1
      }
      continue
    }
    const text = node.textContent || ''
    const length = text.length
    node.textContent = text.slice(Math.max(0, start - offset), Math.max(0, end - offset))
    offset += length
  }
  // Empty list items would otherwise leave phantom bullets in later fragments.
  Array.from(clone.querySelectorAll('*')).reverse().forEach(child => {
    if (!child.textContent && !child.matches('br,hr') && !child.querySelector('br,hr')) child.remove()
  })
  for (const list of orderedLists) {
    const first = list.firstElementChild
    if (first) list.setAttribute('start', String(listNumbers.get(first) ?? 1))
  }
  for (const list of [...(clone.matches('ul,ol') ? [clone] : []), ...clone.querySelectorAll('ul,ol')]) {
    const first = list.firstElementChild
    if (first && (itemStarts.get(first) ?? start) < start) first.classList.add('continued-item')
  }
  if (start) clone.classList.add('continued')
  return clone.outerHTML
}

function fragmentLength(element: Element | DocumentFragment): number {
  return (element.textContent?.length || 0) + element.querySelectorAll('br').length
}

export function paginate(sections: Section[], probe: HTMLElement, height: number): BookPage[] {
  const pages: BookPage[] = []
  const fits = (html: string) => { probe.innerHTML = html; return probe.scrollHeight <= height + 1 }
  for (const section of sections) {
    probe.className = `prose pagination-probe ${section.role || ''}`
    const page = (html: string): BookPage => ({ sectionId: section.id, title: section.title, role: section.role, live: section.live, kind: section.kind, html })
    // Even array indices are left/verso; covers and chapter openings are recto.
    if ((section.kind === 'cover' || section.recto) && pages.length % 2 === 0) {
      pages.push({ sectionId: `blank-before-${section.id}`, title: '', html: '', kind: 'blank' })
    }
    if (section.kind === 'toc') {
      const count = sections.filter(item => item.id !== 'cover' && item.id !== 'contents').length
      const perLeaf = Math.max(1, Math.floor((height - 100) / 28))
      for (let start = 0; start < count; start += perLeaf) pages.push({ ...page(''), tocStart: start, tocEnd: start + perLeaf })
      continue
    }
    if (section.kind) { pages.push(page('')); continue }
    const template = document.createElement('template')
    template.innerHTML = safeMarkdown(section.markdown, section.live) + (section.source ? SOURCE_CARD_HTML : '') + (section.process ? processRecordHtml(section.process, section.id, section.processExpanded) : '')
    let current = ''
    const blocks = Array.from(template.content.children)
    for (const [blockIndex, block] of blocks.entries()) {
      const next = blocks[blockIndex + 1]
      const heading = /^H[1-6]$/.test(block.tagName)
      const shortEnding = blockIndex === blocks.length - 2 && next?.tagName === 'P' && fragmentLength(next) < 80
      // A closed editorial note is one folded object, not paginated hidden text.
      // Expanded content scrolls inside its paper leaf without losing any text.
      if (block.matches('details')) {
        if (current && !fits(current + block.outerHTML)) { pages.push(page(current)); current = '' }
        current += block.outerHTML
        continue
      }
      if (current && block.matches('.source-card') && !fits(current + block.outerHTML)) { pages.push(page(current)); current = '' }
      if (current && next && (heading || shortEnding)) {
        const following = shortEnding ? next.outerHTML : sliceElement(next, 0, Math.min(60, fragmentLength(next)))
        const together = block.outerHTML + following
        if (fits(together) && !fits(current + together)) { pages.push(page(current)); current = '' }
      }
      if (fits(current + block.outerHTML)) { current += block.outerHTML; continue }
      // Avoid orphan headings at the foot of the preceding page.
      if (/^H[1-6]$/.test(block.tagName) && current) { pages.push(page(current)); current = '' }
      let start = 0
      const total = fragmentLength(block)
      if (!total) continue
      while (start < total) {
        const rest = sliceElement(block, start, total)
        if (fits(current + rest)) { current += rest; break }
        let low = start, high = total
        while (low < high) {
          const middle = Math.ceil((low + high) / 2)
          if (fits(current + sliceElement(block, start, middle))) low = middle
          else high = middle - 1
        }
        if (low === start && current) { pages.push(page(current)); current = ''; continue }
        // Tiny viewports still make forward progress; the reader has a minimum paper height.
        const end = Math.max(start + 1, low)
        current += sliceElement(block, start, end)
        pages.push(page(current)); current = ''; start = end
      }
    }
    if (current) pages.push(page(current))
  }
  const cover = pages.findIndex(page => page.kind === 'cover')
  const numberingStart = cover < 0 ? 0 : cover + 2
  const offsets = new Map<string, number>()
  let frontNumber = 0, bodyNumber = 0
  for (const [index, page] of pages.entries()) {
    const section = sections.find(section => section.id === page.sectionId)
    if (section?.matter === 'front') {
      frontNumber++
      if (!section.hideFolio && page.kind !== 'blank') page.folio = romanFolio(frontNumber)
    } else if (page.kind === 'blank') {
      if (bodyNumber) bodyNumber++
      else if (frontNumber) frontNumber++
    } else if (section) page.folio = String(++bodyNumber)
    page.offset = page.tocStart ?? offsets.get(page.sectionId) ?? 0
    const template = document.createElement('template')
    template.innerHTML = page.html
    offsets.set(page.sectionId, page.offset + fragmentLength(template.content))
    if (index >= numberingStart) page.number = index - numberingStart + 1
  }
  probe.innerHTML = ''
  return pages
}

export function pageForSection(pages: BookPage[], id: string): number {
  return Math.max(0, pages.findIndex(page => page.sectionId === id))
}

export function pageForPosition(pages: BookPage[], position: ReadingPosition): number {
  let result = pageForSection(pages, position.sectionId)
  for (const [index, page] of pages.entries()) {
    if (page.sectionId === position.sectionId && (page.offset || 0) <= position.offset) result = index
  }
  return result
}

export function turnPage(index: number, direction: number, count: number, single: boolean): number {
  const step = single ? 1 : 2
  return Math.min(Math.max(0, index + direction * step), Math.max(0, single ? count - 1 : Math.floor((count - 1) / 2) * 2))
}

export function shouldSend(event: { key: string; shiftKey: boolean; isComposing: boolean; keyCode?: number }): boolean {
  return event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229
}
