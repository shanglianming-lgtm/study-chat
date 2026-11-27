import type { PageSide } from './deskReading'
import { INK_SPELL } from './inkSpell'

// Decorative echoes only: never split/move the real text, citation nodes, or
// focus targets. All DOM reads precede writes; the bounded echoes animate on
// the compositor and disappear when interrupted, scrolled, or unmounted.
export function inkFlight(origin: Element, panel: HTMLElement, side: PageSide, returning = false) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)')
  if (reduced.matches || typeof Element.prototype.animate !== 'function') return () => {}
  const sheet = panel.parentElement!
  const surface = sheet.closest('.desk-surface')
  const css = surface && getComputedStyle(surface).getPropertyValue('--desk-air-' + side).trim()
  const matrix = css ? new DOMMatrix(css) : null
  const bounds = sheet.getBoundingClientRect()
  const point = (x: number, y: number) => {
    if (matrix) {
      const m = matrix
      const a = m.m11 - x * m.m14, b = m.m21 - x * m.m24
      const c = m.m12 - y * m.m14, d = m.m22 - y * m.m24
      const e = x * m.m44 - m.m41, f = y * m.m44 - m.m42
      const det = a * d - b * c
      if (Math.abs(det) > 1e-8) return { x: (e * d - f * b) / det, y: (a * f - c * e) / det }
    }
    return {
      x: (x - bounds.left) * sheet.clientWidth / bounds.width,
      y: (y - bounds.top) * sheet.clientHeight / bounds.height,
    }
  }
  const clip = (origin.closest('.book-scroll') || origin.closest('.paper') || origin).getBoundingClientRect()
  const walker = document.createTreeWalker(origin, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  const glyphs: { text: string; x: number; y: number; font: string; size: number }[] = []
  let node: Node | null
  while (glyphs.length < 72 && (node = walker.nextNode())) {
    const parent = node.parentElement!
    if (parent.closest('[aria-hidden="true"], .katex-mathml')) continue
    // Memory/Profile excerpts are themselves buttons. Exclude only controls
    // nested inside a source, not the source's own accessible activation target.
    const control = parent.closest('button')
    if (control && control !== origin && origin.contains(control)) continue
    const style = getComputedStyle(parent)
    for (const { segment, index } of segmenter.segment(node.textContent || '')) {
      if (!segment.trim()) continue
      range.setStart(node, index)
      range.setEnd(node, index + segment.length)
      const r = range.getBoundingClientRect()
      if (!r.width || !r.height || r.bottom < clip.top || r.top > clip.bottom) continue
      const p = point(r.left, r.top)
      glyphs.push({ text: segment, ...p, font: style.font, size: parseFloat(style.fontSize) || 16 })
      if (glyphs.length === 72) break
    }
  }
  range.detach()
  if (!glyphs.length) return () => {}
  const left = Math.min(...glyphs.map(g => g.x))
  const right = Math.max(...glyphs.map(g => g.x + g.size))
  const middle = glyphs.reduce((sum, g) => sum + g.y, 0) / glyphs.length
  const landing = {
    x: panel.offsetLeft + panel.offsetWidth * .5,
    y: panel.offsetTop + Math.min(panel.offsetHeight * .42, glyphs[0].size * 3),
  }
  const layer = document.createElement('div')
  layer.className = 'ink-flight'
  layer.setAttribute('aria-hidden', 'true')
  layer.inert = true
  const animations: Animation[] = []
  if (!returning) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('viewBox', `0 0 ${sheet.clientWidth} ${sheet.clientHeight}`)
    svg.classList.add('ink-wake')
    for (const kind of ['haze', 'thread']) {
      const path = document.createElementNS(svg.namespaceURI, 'path')
      path.setAttribute('d', `M ${left - 8} ${middle + 5} Q ${(left + right) / 2} ${middle - 14} ${right + 10} ${middle - 3}`)
      path.setAttribute('pathLength', '1')
      path.setAttribute('class', kind)
      svg.append(path)
    }
    layer.append(svg)
  }
  // Paint a few nearby graphemes into each moving layer. Seventy-two separate
  // will-change text layers can stall the software compositor on their first
  // frame; small runs preserve the exact glyph positions without that burst.
  const runs: typeof glyphs[] = []
  for (const glyph of glyphs) {
    const run = runs.at(-1), previous = run?.at(-1)
    if (!run || run.length === 4 || previous!.font !== glyph.font ||
      Math.abs(previous!.y - glyph.y) > .5 || glyph.x < previous!.x || glyph.x - previous!.x > glyph.size * 3)
      runs.push([glyph])
    else run.push(glyph)
  }
  const echoes = runs.map((run, i) => {
    const g = run[0]
    const span = document.createElement('span')
    span.style.font = g.font
    span.style.lineHeight = '1'
    for (const glyph of run) {
      const letter = document.createElement('span')
      letter.textContent = glyph.text
      Object.assign(letter.style, { position: 'absolute', left: `${glyph.x - g.x}px`,
        top: `${glyph.y - g.y}px`, font: glyph.font, lineHeight: '1' })
      span.append(letter)
    }
    span.style.width = `${run.at(-1)!.x - g.x + run.at(-1)!.size}px`
    span.style.height = `${Math.max(...run.map(glyph => glyph.size))}px`
    const progress = (g.x - left) / Math.max(1, right - left)
    const drift = Math.sin(i * 2.4) * g.size * .6
    const endX = landing.x + (progress - .5) * Math.min(panel.offsetWidth * .7, right - left)
    const endY = landing.y + (i % 3 - 1) * g.size * .55
    const start = `translate3d(${g.x}px, ${g.y}px, 0) rotate(0deg) scale(1)`
    const crest = `translate3d(${g.x + (endX - g.x) * .4 + drift}px, ${g.y + (endY - g.y) * .45 - g.size * 1.8}px, 0) rotate(${drift * .7}deg) scale(1.08)`
    const end = `translate3d(${endX}px, ${endY}px, 0) rotate(${-drift}deg) scale(.7)`
    layer.append(span)
    return { span, progress, start, crest, end }
  })
  sheet.append(layer)
  for (const { span, progress, start, crest, end } of echoes) {
    animations.push(span.animate(returning ? [
      { transform: end, opacity: 0, color: '#b48b4e' },
      { transform: crest, opacity: .8, color: '#b48b4e', offset: .3 },
      { transform: start, opacity: .5, color: '#766044', offset: .85 },
      { transform: start, opacity: 0 },
    ] : [
      { transform: start, opacity: 0, color: '#ad8243' },
      { transform: start, opacity: .8, color: '#c39a58', offset: .12 },
      { transform: crest, opacity: .9, color: '#98713c', offset: .5 },
      { transform: end, opacity: 0, color: '#735331' },
    ], {
      duration: returning ? INK_SPELL.settle - 70 : 720,
      delay: returning ? (1 - progress) * 60 : INK_SPELL.contact + progress * INK_SPELL.brush,
      easing: returning ? 'cubic-bezier(.4, 0, .7, 1)' : 'cubic-bezier(.2, .65, .25, 1)',
      fill: 'both',
    }))
  }
  function cancel() {
    clearTimeout(timer)
    animations.forEach(a => a.cancel())
    layer.remove()
    reduced.removeEventListener('change', preference)
  }
  function preference() { if (reduced.matches) cancel() }
  const timer = setTimeout(cancel, returning ? INK_SPELL.settle : INK_SPELL.duration + 100)
  reduced.addEventListener('change', preference)
  return cancel
}
