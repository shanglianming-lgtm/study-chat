import DOMPurify from 'dompurify'
import { marked } from 'marked'
import type { Section } from './content'

export type BookPage = { sectionId: string; title: string; html: string; kind?: 'cover' | 'toc'; role?: 'user' | 'assistant' }

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
  template.content.querySelectorAll('a').forEach(anchor => {
    if (!isHttpUrl(anchor.getAttribute('href') || '')) anchor.removeAttribute('href')
  })
  return template.innerHTML
}

export function isHttpUrl(url: string): boolean {
  try { return ['http:', 'https:'].includes(new URL(url).protocol) } catch { return false }
}

// Trim a deep clone instead of Range.cloneContents, which loses ancestors when
// both boundaries are inside the same text node (e.g. a link-only paragraph).
export function sliceElement(element: Element, start: number, end: number): string {
  const clone = element.cloneNode(true) as Element
  const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT)
  let offset = 0, node: Node | null
  while ((node = walker.nextNode())) {
    const text = node.textContent || ''
    const length = text.length
    node.textContent = text.slice(Math.max(0, start - offset), Math.max(0, end - offset))
    offset += length
  }
  // Empty list items would otherwise leave phantom bullets in later fragments.
  Array.from(clone.querySelectorAll('*')).reverse().forEach(child => {
    if (!child.textContent && !child.matches('br,hr') && !child.querySelector('br,hr')) child.remove()
  })
  if (start) clone.classList.add('continued')
  return clone.outerHTML
}

export function paginate(sections: Section[], probe: HTMLElement, height: number): BookPage[] {
  const pages: BookPage[] = []
  const fits = (html: string) => { probe.innerHTML = html; return probe.scrollHeight <= height + 1 }
  for (const section of sections) {
    probe.className = `prose pagination-probe ${section.role || ''}`
    const page = (html: string): BookPage => ({ sectionId: section.id, title: section.title, role: section.role, kind: section.kind, html })
    if (section.kind) { pages.push(page('')); continue }
    const template = document.createElement('template')
    template.innerHTML = safeMarkdown(section.markdown)
    let current = ''
    for (const block of Array.from(template.content.children)) {
      if (fits(current + block.outerHTML)) { current += block.outerHTML; continue }
      // Avoid orphan headings at the foot of the preceding page.
      if (/^H[1-6]$/.test(block.tagName) && current) { pages.push(page(current)); current = '' }
      let start = 0
      const total = block.textContent?.length || 0
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
  probe.innerHTML = ''
  return pages
}

export function pageForSection(pages: BookPage[], id: string): number {
  return Math.max(0, pages.findIndex(page => page.sectionId === id))
}

export function turnPage(index: number, direction: number, count: number, single: boolean): number {
  const step = single ? 1 : 2
  return Math.min(Math.max(0, index + direction * step), Math.max(0, single ? count - 1 : Math.floor((count - 1) / 2) * 2))
}

export function shouldSend(event: { key: string; shiftKey: boolean; isComposing: boolean; keyCode?: number }): boolean {
  return event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229
}
