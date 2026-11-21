// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { isHttpUrl, pageForPosition, pageForSection, paginate, processRecordHtml, romanFolio, safeMarkdown, shouldSend, sliceElement, stoppedManuscript, turnPage } from './book'
import { conversationSections, mockReply } from './content'

describe('safe manuscript rendering', () => {
  it('binds unfinished inline emphasis and code as printed text rather than raw delimiters', () => {
    for (const [source, selector, expected] of [['- **允许答案变', 'strong', '允许答案变'], ['留一点 *空间', 'p em', '空间'], ['代码 `partial', 'p code', 'partial']]) {
      const element = document.createElement('div')
      element.innerHTML = safeMarkdown(stoppedManuscript(source))
      expect(element.querySelector(selector)?.textContent).toBe(expected)
      expect(element.textContent).toContain('本轮已停笔。')
    }
    const element = document.createElement('div')
    element.innerHTML = safeMarkdown(stoppedManuscript('```ts\nconst literal = "**not formatting"\n```'))
    expect(element.querySelector('pre code')?.textContent).toBe('const literal = "**not formatting"\n')
  })
  it('preserves later generated paragraphs when quoted input contains an unfinished link', () => {
    const reply = mockReply('来源 [中文来源](https://exampl', '模型', '强度')
    const partial = reply.slice(0, reply.indexOf('可以试试这样的记录方式：')) + '- **允许答案变'
    const bound = stoppedManuscript(partial)
    expect(bound).toContain('来源 [中文来源](https://exampl')
    expect(bound).toContain('给这个念头一点空间')
    const element = document.createElement('div')
    element.innerHTML = safeMarkdown(bound)
    expect(element.textContent).toContain('中文来源')
    expect(element.textContent).toContain('允许答案变')
    expect(element.querySelector('strong')?.textContent).toBe('先描述，再判断。')
    expect(element.querySelectorAll('strong')[3]?.textContent).toBe('允许答案变')
  })
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
  it('keeps publishing openings recto, uses roman front matter, and restarts body folios', () => {
    const probe = document.createElement('div')
    const pages = paginate([
      { id: 'half', title: 'Half Title', kind: 'cover', matter: 'front', hideFolio: true, markdown: '' },
      { id: 'title', title: 'Title Page', kind: 'title', matter: 'front', recto: true, hideFolio: true, markdown: '' },
      { id: 'imprint', title: 'Copyright', kind: 'imprint', matter: 'front', hideFolio: true, markdown: '' },
      { id: 'toc', title: 'Contents', kind: 'toc', matter: 'front', recto: true, markdown: '' },
      { id: 'chapter', title: 'Chapter One', recto: true, markdown: '# Body' },
    ], probe, 400)
    for (const id of ['half', 'title', 'toc', 'chapter']) expect(pageForSection(pages, id) % 2).toBe(1)
    expect(pages[pageForSection(pages, 'title')].folio).toBeUndefined()
    expect(pages[pageForSection(pages, 'toc')].folio).toBe('v')
    expect(pages[pageForSection(pages, 'chapter')].folio).toBe('1')
    expect(romanFolio(49)).toBe('xlix')
  })
  it('keeps a collapsed process record whole and escapes its metadata', () => {
    const probe = document.createElement('div')
    const pages = paginate([{ id: 'reply', title: 'Response', markdown: '正文', process: { model: '<img src=x onerror=alert(1)>', effort: 'standard' } }], probe, 400)
    const result = document.createElement('div')
    result.innerHTML = pages.map(page => page.html).join('')
    expect(result.querySelectorAll('details')).toHaveLength(1)
    expect(result.querySelector('details')?.open).toBe(false)
    expect(result.querySelector('details')?.textContent).toContain('展开过程附页')
    expect(result.querySelector('img')).toBeNull()
    expect(processRecordHtml({ model: 'local', effort: 'standard' })).not.toContain(' open')
  })
  it('keeps a closing curly quote outside an automatically linked hostname', () => {
    const result = document.createElement('div')
    result.innerHTML = safeMarkdown('你写下：“https://example.com”')
    expect(result.querySelector('a')?.getAttribute('href')).toBe('https://example.com')
    expect(result.querySelector('a')?.textContent).toBe('https://example.com')
    expect(result.textContent).toContain('https://example.com”')
  })
  it('keeps an entire quoted Chinese sentence outside an echoed auto-link', () => {
    const result = document.createElement('div')
    result.innerHTML = safeMarkdown('请看这个网址 https://example.com”，如何把读到的内容写成一页思考笔记？')
    expect(result.querySelector('a')?.getAttribute('href')).toBe('https://example.com')
    expect(result.querySelector('a')?.textContent).toBe('https://example.com')
    expect(result.textContent).toContain('”，如何把读到的内容写成一页思考笔记？')
    result.innerHTML = safeMarkdown('[明确链接](https://example.com/中文)，以及 https://example.com/path?q=%20”')
    expect(result.querySelector('a')?.getAttribute('href')).toBe('https://example.com/%E4%B8%AD%E6%96%87')
    expect(result.querySelectorAll('a')[1]?.getAttribute('href')).toBe('https://example.com/path?q=%20')
  })
  it('unfolds sample process records into independent paginated editorial sections', () => {
    const message = { id: 'a1', role: 'assistant' as const, content: '已完成', process: { model: 'Study · Quiet', effort: '深入推理' } }
    expect(conversationSections([message])).toHaveLength(1)
    const unfolded = conversationSections([message], new Set(['a1']))
    expect(unfolded).toHaveLength(2)
    expect(unfolded[1].id).toBe('a1-notes')
    expect(unfolded[1].markdown).toContain('not executed')
    expect(unfolded[1].markdown).toContain('Study · Quiet')
  })
  it('preserves valid Chinese punctuation in bare URL queries/paths and explicit destinations', () => {
    const result = document.createElement('div')
    result.innerHTML = safeMarkdown('https://example.com/?q=你好，世界\n\nhttps://example.com/你好，世界\n\n[https://example.com/?q=你好，世界](https://example.com/?q=你好，世界)\n\n[https://example.com/带”引号](https://example.com/带”引号)')
    const anchors = [...result.querySelectorAll('a')]
    expect(anchors).toHaveLength(4)
    expect(new URL(anchors[0].href).searchParams.get('q')).toBe('你好，世界')
    expect(decodeURI(anchors[1].getAttribute('href')!)).toBe('https://example.com/你好，世界')
    expect(new URL(anchors[2].href).searchParams.get('q')).toBe('你好，世界')
    expect(decodeURI(anchors[3].getAttribute('href')!)).toBe('https://example.com/带”引号')
  })
  it('separates Chinese full-stop prose without damaging recognized IDN separators or queries', () => {
    const result = document.createElement('div')
    result.innerHTML = safeMarkdown('见https://example.com。谢谢\n\n“https://www.例子。中国”\n\nhttps://example.com/?q=你好。谢谢\n\n[https://example.com。谢谢](https://example.com。谢谢)')
    const anchors = [...result.querySelectorAll('a')]
    expect(anchors[0].getAttribute('href')).toBe('https://example.com')
    expect(result.textContent).toContain('https://example.com。谢谢')
    expect(new URL(anchors[1].href).hostname).toBe(new URL('https://www.例子。中国').hostname)
    expect(new URL(anchors[2].href).searchParams.get('q')).toBe('你好。谢谢')
    expect(new URL(anchors[3].href).hostname).toBe(new URL('https://example.com。谢谢').hostname)
  })
  it('does not bind an empty framed code block when stopped at an opening fence', () => {
    expect(safeMarkdown(stoppedManuscript('```typescript\n'))).not.toContain('<pre>')
  })
  it('retains leading code indentation when the code frame cannot fit under prose', () => {
    const probe = document.createElement('div')
    Object.defineProperty(probe, 'scrollHeight', { get: () => Array.from(probe.children).reduce((sum, node) => sum + (node.tagName === 'PRE' ? 40 : 0) + (node.textContent?.length || 0), 0) })
    const markdown = 'p'.repeat(25) + '\n\n```ts\n    const n = 1\n```'
    const pages = paginate([{ id: 'code', title: 'Code', markdown }], probe, 50)
    const result = document.createElement('div')
    result.innerHTML = pages.map(page => page.html).join('')
    expect([...result.querySelectorAll('pre')].map(pre => pre.textContent).join('')).toBe('    const n = 1\n')
  })
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
  it('marks only a split item continuation, not the following genuine list item', () => {
    for (const tag of ['ul', 'ol']) {
      const element = document.createElement(tag)
      element.innerHTML = '<li>一二三四</li><li>五六</li>'
      const result = document.createElement('div')
      result.innerHTML = sliceElement(element, 2, 6)
      expect(result.querySelector('li')?.classList.contains('continued-item')).toBe(true)
      expect(result.querySelectorAll('li')[1].classList.contains('continued-item')).toBe(false)
      expect(result.textContent).toBe('三四五六')
      result.innerHTML = sliceElement(element, 4, 6)
      expect(result.querySelector('li')?.classList.contains('continued-item')).toBe(false)
    }
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
  it('quotes complete question Markdown without cutting a link at the old excerpt limit', () => {
    const destination = 'https://example.com/读书?q=你好，世界'
    const question = `${'先慢慢读这一页。'.repeat(16)}\n[阅读来源](${destination})`
    const result = document.createElement('div')
    result.innerHTML = safeMarkdown(mockReply(question, '模型', '强度'))
    expect(decodeURI(result.querySelector('blockquote a')!.getAttribute('href')!)).toBe(destination)
    expect(result.querySelector('blockquote')!.textContent).toContain('阅读来源')
    expect(result.textContent).not.toContain('[阅读来源](')
  })
})
