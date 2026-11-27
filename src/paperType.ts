import { safeMarkdown } from './book'

const segmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' })
export function sentenceRanges(text: string) {
  const spans = [...segmenter.segment(text)].filter((s) => s.segment.trim())
  return spans.map((s) => ({
    start: s.index + s.segment.length - s.segment.trimStart().length,
    end: s.index + s.segment.trimEnd().length,
  }))
}
// Work on the sanitized printed DOM so that italics, code, lists and links
// retain their original elements even when a sentence crosses inline markup.
export function setType(
  text: string,
  user: boolean,
  hot: number,
  refs: Set<number>,
  live: boolean,
  tailRefs: number[] = []
) {
  const page = document.createElement('div')
  if (user) {
    const p = document.createElement('p')
    p.textContent = text
    page.append(p)
  } else page.innerHTML = safeMarkdown(text, live)
  const blockSelector = 'p,li,h1,h2,h3,h4,h5,h6,pre,td,th'
  const nodes: Text[] = [],
    walker = document.createTreeWalker(page, NodeFilter.SHOW_TEXT)
  while (walker.nextNode())
    if (walker.currentNode.textContent?.trim()) nodes.push(walker.currentNode as Text)
  const groups: { block: Element; nodes: Text[]; text: string }[] = []
  for (const n of nodes) {
    const block = n.parentElement!.closest(blockSelector) || n.parentElement!
    let group = groups.at(-1)
    if (group?.block !== block) {
      group = { block, nodes: [], text: '' }
      groups.push(group)
    }
    group.nodes.push(n)
    group.text += n.data
  }
  const sentences = groups.flatMap((group, i) => sentenceRanges(group.text).map((span) => ({ ...span, i })))
  const first = sentences[0],
    last = sentences.at(-1),
    plainLength = nodes.reduce((n, t) => n + t.length, 0)
  let printed = 0
  groups.forEach((group, i) => {
    group.block.classList.add('ink-block')
    group.block.setAttribute('data-passage', String(i))
    let offset = 0
    for (const node of group.nodes) {
      const start = offset,
        end = start + node.length,
        links = !!node.parentElement?.closest('a')
      const bounds = new Set([0, node.length]),
        references: { start: number; end: number; n: number }[] = []
      if (!links)
        for (const match of node.data.matchAll(/\[(\d+)\]/g)) {
          if (refs.has(+match[1])) {
            references.push({ start: match.index!, end: match.index! + match[0].length, n: +match[1] })
            bounds.add(match.index!)
            bounds.add(match.index! + match[0].length)
          }
        }
      for (const r of [user ? undefined : first, last])
        if (r?.i === i) for (const p of [r.start, r.end]) if (p > start && p < end) bounds.add(p - start)
      for (const h of [hot, Math.ceil(hot / 2)]) {
        const p = plainLength - h - printed
        if (p > 0 && p < node.length && !references.some((r) => p > r.start && p < r.end)) bounds.add(p)
      }
      const cuts = [...bounds].sort((a, b) => a - b),
        frag = document.createDocumentFragment()
      for (let j = 1; j < cuts.length; j++) {
        const at = cuts[j - 1],
          value = node.data.slice(at, cuts[j]),
          pos = start + at,
          ref = references.find((r) => r.start === at)
        const isFirst = !user && first?.i === i && pos >= first.start && pos < first.end,
          isLast = last?.i === i && pos >= last.start && pos < last.end
        const action = ref
          ? 'ref'
          : isFirst && isLast
            ? 'both'
            : isFirst
              ? 'process'
              : isLast
                ? 'actions'
                : 'lift'
        const span = document.createElement('span')
        span.textContent = value
        if (!links) {
          span.dataset.ink = action
          if (ref) {
            span.dataset.ref = String(ref.n)
            span.className = 'ink-citation'
          }
          const begins = ref || (isFirst && pos === first.start) || (isLast && pos === last.start)
          if (begins) {
            span.tabIndex = 0
            span.setAttribute('role', 'button')
            span.setAttribute(
              'aria-description',
              ref
                ? '文件引用 ' + ref.n
                : action === 'both'
                  ? '过程与本句操作'
                  : action === 'process'
                    ? '查看生成过程'
                    : '本句操作'
            )
            if (ref) span.setAttribute('aria-label', '文件引用 ' + ref.n)
          }
        }
        if (hot && printed + at >= plainLength - hot)
          span.classList.add(printed + at >= plainLength - hot / 2 ? 'ink-new' : 'ink-cooling')
        frag.append(span)
      }
      node.replaceWith(frag)
      printed += node.length
      offset = end
    }
  })
  const tail = groups.at(-1)?.block || page
  for (const n of tailRefs) {
    if (text.includes('[' + n + ']')) continue
    const link = document.createElement('button')
    link.className = 'ink-citation appended'
    link.dataset.ink = 'ref'
    link.dataset.ref = String(n)
    link.setAttribute('aria-label', '文件引用 ' + n)
    link.textContent = '[' + n + ']'
    tail.append(link)
  }
  return page.innerHTML
}
