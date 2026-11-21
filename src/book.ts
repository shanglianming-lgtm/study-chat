import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { SOURCE_CARD_HTML, type Section } from './content'

export type BookPage = { sectionId: string; title: string; html: string; kind?: 'cover' | 'toc' | 'blank'; role?: 'user' | 'assistant'; offset?: number; number?: number }
export type ReadingPosition = { sectionId: string; offset: number }

export function safeMarkdown(markdown: string, streaming = false): string {
  // An unfinished fenced block stays literal until its closing fence arrives.
  const fences = [...markdown.matchAll(/^\s*(`{3,}|~{3,})/gm)]
  if (streaming && fences.length % 2) {
    const start = fences[fences.length - 1].index!
    const prefix = safeMarkdown(markdown.slice(0, start))
    const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    return `${prefix}<pre class="unfinished">${escape(markdown.slice(start))}</pre>`
  }
  const html = DOMPurify.sanitize(marked.parse(markdown, { async: false }) as string, {
    ALLOWED_TAGS: ['p', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 'blockquote', 'ul', 'ol', 'li', 'pre', 'code', 'a', 'hr', 'del'],
    ALLOWED_ATTR: ['href', 'title', 'class', 'start'],
  })
  const template = document.createElement('template')
  template.innerHTML = html
  // Sanitizing an unsupported HTML container can leave bare text or inline
  // nodes at the root. Normalize those into blocks so pagination cannot skip it.
  let paragraph: HTMLParagraphElement | null = null
  for (const node of Array.from(template.content.childNodes)) {
    const inline = node.nodeType === Node.TEXT_NODE || (node instanceof Element && node.matches('a,strong,em,code,del,br'))
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
  return `${markdown}${close}\n\n*本轮已停笔。*`
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
  const nodes: Node[] = []
  while (walker.nextNode()) nodes.push(walker.currentNode)
  let offset = 0
  for (const node of nodes) {
    if (node instanceof Element) {
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
    const page = (html: string): BookPage => ({ sectionId: section.id, title: section.title, role: section.role, kind: section.kind, html })
    // Even array indices are left/verso; covers and chapter openings are recto.
    if ((section.kind === 'cover' || section.recto) && pages.length % 2 === 0) {
      pages.push({ sectionId: `blank-before-${section.id}`, title: '', html: '', kind: 'blank' })
    }
    if (section.kind) { pages.push(page('')); continue }
    const template = document.createElement('template')
    template.innerHTML = safeMarkdown(section.markdown) + (section.source ? SOURCE_CARD_HTML : '')
    let current = ''
    const blocks = Array.from(template.content.children)
    for (const [blockIndex, block] of blocks.entries()) {
      const next = blocks[blockIndex + 1]
      const heading = /^H[1-6]$/.test(block.tagName)
      const shortEnding = blockIndex === blocks.length - 2 && next?.tagName === 'P' && fragmentLength(next) < 80
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
  for (const [index, page] of pages.entries()) {
    page.offset = offsets.get(page.sectionId) || 0
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
