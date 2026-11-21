// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { isHttpUrl, pageForSection, paginate, safeMarkdown, shouldSend, sliceElement, turnPage } from './book'
import { conversationSections, mockReply } from './content'

describe('safe manuscript rendering', () => {
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
  it('keeps special front matter and starts each chapter separately', () => {
    const probe = document.createElement('div')
    const pages = paginate([{ id: 'cover', title: '', kind: 'cover', markdown: '' }, { id: 'a', title: 'A', markdown: '正文' }, { id: 'b', title: 'B', markdown: '另一章' }], probe, 400)
    expect(pages.map(page => page.sectionId)).toEqual(['cover', 'a', 'b'])
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
