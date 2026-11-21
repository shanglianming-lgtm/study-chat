// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { isHttpUrl, pageForPosition, pageForSection, paginate, safeMarkdown, shouldSend, sliceElement, stoppedManuscript, turnPage } from './book'
import { conversationSections, mockReply } from './content'

describe('safe manuscript rendering', () => {
  it('binds a stop notice outside an unfinished code fence without losing partial code', () => {
    const element = document.createElement('div')
    element.innerHTML = safeMarkdown(stoppedManuscript('前文\n\n```typescript\nconst reflection = {'))
    expect(element.querySelector('pre code')?.textContent).toContain('const reflection = {')
    expect(element.querySelector('pre')?.textContent).not.toContain('本轮已停笔')
    expect(element.querySelector('p em')?.textContent).toBe('本轮已停笔。')
  })
  it('renders paragraphs, lists, fenced code and HTTP links', () => {
    const html = safeMarkdown('一段正文\n\n- 列表\n\n```ts\nconst n = 1\n```\n\n[链接](https://example.com)')
    expect(html).toContain('<p>一段正文</p>')
    expect(html).toContain('<ul>')
    expect(html).toContain('<pre><code')
    expect(html).toContain('href="https://example.com"')
  })
  it('does not execute or retain HTML, script URLs, images or event handlers', () => {
    const html = safeMarkdown('<script>alert(1)</script><img src="https://tracking.invalid/x" onerror="alert(1)">\n\n[bad](javascript:alert) [local](file:///etc/passwd)')
    expect(html).not.toMatch(/<script|<img|onerror|href="javascript:|href="file:\/\//)
  })
  it('renders an unclosed fence literally while streaming, with angle brackets escaped', () => {
    const html = safeMarkdown('前文\n\n```ts\n<div>not HTML', true)
    expect(html).toContain('class="unfinished"')
    expect(html).toContain('```ts')
    expect(html).toContain('&lt;div&gt;')
    expect(html).not.toContain('<code')
  })
  it('turns a closed streamed fence back into code', () => {
    expect(safeMarkdown('```ts\nx\n```', true)).toContain('<pre><code')
  })
  it('only accepts absolute HTTP and HTTPS URLs', () => {
    expect(isHttpUrl('https://example.com')).toBe(true)
    expect(isHttpUrl('http://example.com')).toBe(true)
    for (const value of ['javascript:alert(1)', 'file:///tmp/x', 'data:text/plain,x', '/path', '//example.com']) expect(isHttpUrl(value)).toBe(false)
  })
})

describe('composition and page navigation', () => {
  it('sends Enter but not Shift+Enter or IME confirmation', () => {
    expect(shouldSend({ key: 'Enter', shiftKey: false, isComposing: false })).toBe(true)
    expect(shouldSend({ key: 'Enter', shiftKey: true, isComposing: false })).toBe(false)
    expect(shouldSend({ key: 'Enter', shiftKey: false, isComposing: true })).toBe(false)
    expect(shouldSend({ key: 'Enter', shiftKey: false, isComposing: false, keyCode: 229 })).toBe(false)
  })
  it('clamps page turns and respects single-page or spread mode', () => {
    expect(turnPage(0, -1, 9, false)).toBe(0)
    expect(turnPage(0, 1, 9, false)).toBe(2)
    expect(turnPage(8, 1, 9, false)).toBe(8)
    expect(turnPage(0, 1, 9, true)).toBe(1)
    expect(turnPage(8, 1, 9, true)).toBe(8)
  })
  it('preserves stable message identifiers independent of pagination', () => {
    const result = conversationSections([{ id: 'message-a', role: 'assistant', content: '回答' }])
    expect(result[0].id).toBe('message-a')
    const pages = [{ sectionId: 'chapter', title: '', html: '' }, { sectionId: 'message-a', title: '', html: '' }]
    expect(pageForSection(pages, 'message-a')).toBe(1)
  })
})

describe('DOM pagination', () => {
  it('continues ordered-list numbering after removing earlier list items', () => {
    const element = document.createElement('ol')
    element.innerHTML = '<li>一</li><li>二</li><li>三</li><li>四</li>'
    const result = document.createElement('div')
    result.innerHTML = sliceElement(element, 3, 4)
    expect(result.querySelector('ol')?.start).toBe(4)
    expect(result.querySelector('li')?.textContent).toBe('四')
    element.setAttribute('start', '5')
    result.innerHTML = sliceElement(element, 2, 4)
    expect(result.querySelector('ol')?.start).toBe(7)
    element.setAttribute('start', '0')
    result.innerHTML = sliceElement(element, 0, 1)
    expect(result.querySelector('ol')?.start).toBe(0)
    result.innerHTML = sliceElement(element, 1, 2)
    expect(result.querySelector('ol')?.start).toBe(1)
  })
  it('measures the demo source card as part of its section and keeps the explicit link', () => {
    const probe = document.createElement('div')
    const pages = paginate([{ id: 'source', title: '来源', source: true, markdown: '正文' }], probe, 400)
    const result = document.createElement('div')
    result.innerHTML = pages.map(page => page.html).join('')
    expect(result.querySelector('.source-card small')?.textContent).toBe('演示')
    expect(result.querySelector('.source-icon')?.getAttribute('href')).toBe('https://example.com')
  })
  it('preserves inline links when a paragraph spans pages', () => {
    const element = document.createElement('p')
    element.innerHTML = '一二<a href="https://example.com">三四五六</a>七八'
    expect(sliceElement(element, 3, 7)).toBe('<p class="continued"><a href="https://example.com">四五六</a>七</p>')
  })
  it('preserves ancestors when a fragment stays inside one linked text node', () => {
    const element = document.createElement('p')
    element.innerHTML = '<a href="https://example.com"><strong>一二三四五六七八</strong></a>'
    expect(sliceElement(element, 2, 5)).toBe('<p class="continued"><a href="https://example.com"><strong>三四五</strong></a></p>')
  })
  it('preserves code characters and whitespace across fragments', () => {
    const element = document.createElement('pre')
    element.innerHTML = '<code>let a = 1;\n  let b = 2;</code>'
    const container = document.createElement('div')
    container.innerHTML = sliceElement(element, 0, 8) + sliceElement(element, 8, element.textContent!.length)
    expect(container.textContent).toBe(element.textContent)
  })
  it('counts and slices hard breaks instead of repeating every break per page', () => {
    const element = document.createElement('p')
    element.innerHTML = '一<br>二<br>三<br>四'
    expect(sliceElement(element, 2, 5)).toBe('<p class="continued">二<br>三</p>')
    const probe = document.createElement('div')
    Object.defineProperty(probe, 'scrollHeight', { get() { return (probe.querySelectorAll('br').length + 1) * 20 } })
    const input = '一  \n二  \n三  \n四  \n五  \n六'
    const pages = paginate([{ id: 'breaks', title: '换行', markdown: input }], probe, 60)
    expect(pages.length).toBeLessThanOrEqual(3)
    expect(pages.every(page => { probe.innerHTML = page.html; return probe.scrollHeight <= 61 })).toBe(true)
    const joined = document.createElement('div')
    joined.innerHTML = pages.map(page => page.html).join('')
    expect(joined.textContent?.replace(/\s/g, '')).toBe('一二三四五六')
  })
  it('uses measured capacity, does not lose text, and reflows to more pages', () => {
    const probe = document.createElement('div')
    Object.defineProperty(probe, 'scrollHeight', { get() { return Math.ceil((probe.textContent?.length || 0) / 10) * 20 } })
    const text = '长段落与代码都需要保留。'.repeat(15)
    const input = [{ id: 'long', title: '长文', markdown: text }]
    const big = paginate(input, probe, 100)
    const small = paginate(input, probe, 60)
    expect(small.length).toBeGreaterThan(big.length)
    const joined = document.createElement('div')
    joined.innerHTML = small.map(page => page.html).join('')
    expect(joined.textContent).toBe(text)
    expect(small.every(page => page.sectionId === 'long')).toBe(true)
  })
  it('leaves the cover unnumbered and starts recto chapters on odd right-hand folios', () => {
    const probe = document.createElement('div')
    const pages = paginate([{ id: 'cover', title: '', kind: 'cover', markdown: '' }, { id: 'a', title: 'A', recto: true, markdown: '正文' }, { id: 'b', title: 'B', recto: true, markdown: '另一章' }], probe, 400)
    expect(pages[1].kind).toBe('cover')
    expect(pages[1].number).toBeUndefined()
    for (const id of ['a', 'b']) {
      const index = pageForSection(pages, id)
      expect(index % 2).toBe(1)
      expect(pages[index].number! % 2).toBe(1)
    }
    expect(pages[pageForSection(pages, 'a')].number).toBe(1)
  })
  it('keeps the same within-chapter text position when page capacity changes', () => {
    const probe = document.createElement('div')
    Object.defineProperty(probe, 'scrollHeight', { get() { return Math.ceil((probe.textContent?.length || 0) / 10) * 20 } })
    const sections = [{ id: 'long', title: '长文', markdown: '阅读位置不能跳回章节开头。'.repeat(30) }]
    const before = paginate(sections, probe, 100)
    const position = { sectionId: 'long', offset: before[3].offset! }
    const after = paginate(sections, probe, 60)
    const index = pageForPosition(after, position)
    expect(index).toBeGreaterThan(0)
    expect(after[index].offset).toBeLessThanOrEqual(position.offset)
    expect(after[index + 1].offset).toBeGreaterThan(position.offset)
    expect(pageForPosition(before, position)).toBe(3)
  })
  it('keeps a short copyright ending with the preceding paragraph when they fit together', () => {
    const probe = document.createElement('div')
    Object.defineProperty(probe, 'scrollHeight', { get() {
      return [...probe.children].reduce((height, block) => height + Math.ceil((block.textContent?.length || 0) / 10) * 20, 0)
    } })
    const previous = '排版与对话始终通过标识定位。'.repeat(2)
    const pages = paginate([{ id: 'copyright', title: '版权', markdown: '前文'.repeat(40) + '\n\n' + previous + '\n\n© 2026 书房' }], probe, 200)
    expect(pages.at(-1)?.html).toContain(previous)
    expect(pages.at(-1)?.html).toContain('© 2026 书房')
  })
  it('retains top-level text left behind by sanitized HTML containers', () => {
    const probe = document.createElement('div')
    const pages = paginate([{ id: 'html', title: 'HTML', markdown: '<div>hello <strong>there</strong></div>' }], probe, 400)
    const result = document.createElement('div')
    result.innerHTML = pages.map(page => page.html).join('')
    expect(result.textContent).toContain('hello there')
    expect(result.querySelector('strong')?.textContent).toBe('there')
  })
  it('the mock is deterministic and identifies itself as simulated', () => {
    expect(mockReply('问题', '模型', '强度')).toBe(mockReply('问题', '模型', '强度'))
    expect(mockReply('问题', '模型', '强度')).toContain('并未调用真实模型')
  })
})
