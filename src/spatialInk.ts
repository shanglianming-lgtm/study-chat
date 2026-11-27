import * as THREE from 'three'
import type { DeskReading, PageSide } from './deskReading'
import { carryInk, inkLife, smoothstep, wakeInk, type InkGlyph, type InkPoint } from './inkLifecycle'

type Glyph = InkGlyph & { range: Range; left: number; top: number; size: number; font: string }
type Options = { animate: boolean; paused?: boolean; debug?: boolean; ephemeral?: boolean }
type Target = {
  host: HTMLElement; paper: HTMLElement; side: PageSide; options: Options; glyphs: Glyph[]
  canvas: HTMLCanvasElement; context: CanvasRenderingContext2D; refresh: () => void; dispose: () => void
  width: number; height: number; startedAt: number; debugRevision: number; debugTime: number
  painted: boolean; dryCount: number
  clip: { left: number; top: number; right: number; bottom: number }
}
export type InkHandPose = (side: PageSide, u: number, v: number, alpha: number) => { tip: THREE.Vector3; palm: THREE.Vector3 }
export type InkDebugState = { enabled: boolean; progress: number; mode: 'scrub' | 'stream'; text: string; revision: number }
const sample = '星河凝作墨，万物入书来。'
let debugState: InkDebugState = { enabled: false, progress: 0, mode: 'scrub', text: sample, revision: 0 }
const subscribers = new Set<() => void>()
export const inkDebug = {
  subscribe(fn: () => void) { subscribers.add(fn); return () => { subscribers.delete(fn) } },
  snapshot: () => debugState,
  set(patch: Partial<InkDebugState>) {
    debugState = { ...debugState, ...patch, revision: debugState.revision + 1 }
    subscribers.forEach(fn => fn())
  },
  sample,
}

// Invert the actual CSS perspective mapping, not a screen-space bounding-box
// approximation. The canvas and printed DOM share this same model leaf.
function paperPoint(paper: HTMLElement, side: PageSide, x: number, y: number) {
  const surface = paper.closest('.desk-surface')
  const css = surface && getComputedStyle(surface).getPropertyValue('--desk-' + side).trim()
  if (css) {
    const m = new DOMMatrix(css)
    const a = m.m11 - x * m.m14, b = m.m21 - x * m.m24
    const c = m.m12 - y * m.m14, d = m.m22 - y * m.m24
    const e = x * m.m44 - m.m41, f = y * m.m44 - m.m42, det = a * d - b * c
    if (Math.abs(det) > 1e-8) return { x: (e * d - f * b) / det, y: (a * f - c * e) / det }
  }
  const box = paper.getBoundingClientRect()
  return { x: (x - box.left) * paper.offsetWidth / box.width, y: (y - box.top) * paper.offsetHeight / box.height }
}
function readingClip(host: HTMLElement, paper: HTMLElement) {
  const pane = host.closest<HTMLElement>('.book-scroll')
  if (!pane) return { left: 0, top: 0, right: paper.offsetWidth, bottom: paper.offsetHeight }
  let left = pane.clientLeft, top = pane.clientTop, element: HTMLElement | null = pane
  // Untransformed offset coordinates share the canvas's paper-local basis.
  // Do not mistake the scroll viewport's screen-space AABB for its bounds on
  // a perspective-projected leaf, and do not subtract its own scroll offset.
  while (element && element !== paper) {
    left += element.offsetLeft
    top += element.offsetTop
    const parent = element.offsetParent as HTMLElement | null
    if (parent && parent !== paper) { left -= parent.scrollLeft; top -= parent.scrollTop }
    element = parent
  }
  return { left: Math.max(0, left), top: Math.max(0, top),
    right: Math.min(paper.offsetWidth, left + pane.clientWidth), bottom: Math.min(paper.offsetHeight, top + pane.clientHeight) }
}
const targets = new Set<Target>()
let highlightsDirty = true
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
let cursor: { target: Target; point: InkPoint; last: number } | null = null
const local = new THREE.Vector3()

function highlight(now: number) {
  if (typeof Highlight === 'undefined' || !CSS.highlights || !highlightsDirty) return
  highlightsDirty = false
  const hidden: Range[] = [], dry: Range[] = []
  for (const target of targets) {
    const clock = target.options.debug && debugState.mode === 'scrub' ? target.debugTime : now
    for (const glyph of target.glyphs) {
      if (glyph.activatedAt === null || clock - glyph.activatedAt < 1200) hidden.push(glyph.range)
      else dry.push(glyph.range)
    }
  }
  const pending = new Highlight(...hidden), cooled = new Highlight(...dry)
  pending.priority = 2
  cooled.priority = 1
  CSS.highlights.set('book-ink-pending', pending)
  CSS.highlights.set('book-ink-dry', cooled)
}

function paint(target: Target, now: number, reduced: boolean) {
  const { context: ctx, canvas, width, height } = target
  const lives = target.glyphs.map(glyph => inkLife(glyph.activatedAt, now))
  const phases = [0, 0, 0, 0]
  lives.forEach(life => { phases[life.phase]++ })
  if (target.dryCount !== phases[3]) { target.dryCount = phases[3]; highlightsDirty = true }
  const states = phases.join(',')
  if (canvas.dataset.inkStates !== states) canvas.dataset.inkStates = states
  const hot = lives.some((life, i) => (life.phase === 1 || life.phase === 2) && visible(target, target.glyphs[i]))
  if (!hot && !target.painted) return
  ctx.clearRect(0, 0, width, height)
  ctx.save()
  ctx.beginPath()
  ctx.rect(target.clip.left, target.clip.top, target.clip.right - target.clip.left, target.clip.bottom - target.clip.top)
  ctx.clip()
  let painted = false
  for (let i = 0; i < target.glyphs.length; i++) {
    const glyph = target.glyphs[i], life = lives[i]
    if (life.phase === 0 || life.phase === 3 || !visible(target, glyph)) continue
    painted = true
    ctx.save()
    ctx.font = glyph.font
    ctx.textBaseline = 'alphabetic'
    const ascent = ctx.measureText(glyph.text).fontBoundingBoxAscent || glyph.size * .8
    ctx.translate(glyph.left, glyph.top + life.y)
    ctx.scale(life.scale, life.scale)
    ctx.globalAlpha = life.alpha
    ctx.fillStyle = life.color
    ctx.shadowColor = '#FFB800'
    ctx.shadowBlur = 25 * life.glow
    ctx.fillText(glyph.text, 0, ascent)
    if (life.phase === 1) ctx.fillText(glyph.text, 0, ascent)
    ctx.restore()
    const age = (now - glyph.activatedAt!) / 600
    if (!reduced && age >= 0 && age < 1) {
      for (let n = 0; n < 2; n++) {
        const seed = i * 2.399 + n * 1.73
        ctx.save()
        ctx.globalAlpha = (1 - age) * .9
        ctx.fillStyle = '#FFD700'
        ctx.shadowColor = '#FFB800'
        ctx.shadowBlur = 6 * (1 - age)
        ctx.beginPath()
        ctx.arc(glyph.x + Math.sin(seed + age * 7) * (2 + age * 5),
          glyph.y - age * (18 + 7 * Math.sin(seed)), (1.1 + .3 * Math.cos(seed)) * (1 - age), 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      }
    }
  }
  ctx.restore()
  canvas.hidden = !painted
  target.painted = painted
}

function register(host: HTMLElement, side: PageSide, options: Options) {
  const paper = host.closest<HTMLElement>('.paper')
  // Keep the accessible printed text as a functional fallback on old engines.
  if (!options.animate || !paper || !paper.closest('.desk-surface') || typeof Highlight === 'undefined' || !CSS.highlights) return () => {}
  const canvas = document.createElement('canvas'), context = canvas.getContext('2d')
  if (!context) return () => {}
  canvas.className = 'spatial-ink-canvas'
  canvas.hidden = true
  canvas.setAttribute('aria-hidden', 'true')
  canvas.inert = true
  paper.append(canvas)
  let disposed = false
  const target: Target = { host, paper, side, options, canvas, context, glyphs: [], width: 0, height: 0,
    startedAt: performance.now(), debugRevision: -1, debugTime: performance.now(), painted: false, dryCount: -1,
    clip: readingClip(host, paper), refresh, dispose }
  targets.add(target)
  function refresh() {
    if (disposed || !host.isConnected) return
    const previous = target.glyphs, next: Glyph[] = []
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT)
    let node: Node | null
    while ((node = walker.nextNode())) {
      const parent = node.parentElement!
      // Original citation elements, symbols, styling and focus targets are
      // deliberately excluded, not wrapped, cloned, replaced or recolored.
      if (parent.closest('.ink-citation,[aria-hidden="true"],.katex-mathml')) continue
      const control = parent.closest('button')
      if (control && control !== host && host.contains(control)) continue
      const style = getComputedStyle(parent), size = parseFloat(style.fontSize) || 16
      const font = style.font || `${style.fontWeight} ${size}px ${style.fontFamily}`
      for (const { segment, index } of segmenter.segment(node.textContent || '')) {
        if (!segment.trim()) continue
        const range = document.createRange()
        range.setStart(node, index)
        range.setEnd(node, index + segment.length)
        const box = range.getBoundingClientRect()
        if (!box.width || !box.height) continue
        const a = paperPoint(paper!, side, box.left, box.top), b = paperPoint(paper!, side, box.right, box.bottom)
        next.push({ text: segment, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2,
          left: a.x, top: a.y, size, font, range, activatedAt: options.animate ? null : performance.now() - 1200 })
      }
    }
    target.glyphs = carryInk(previous, next)
    target.width = paper!.offsetWidth
    target.height = paper!.offsetHeight
    target.clip = readingClip(host, paper!)
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5)
    canvas.width = Math.ceil(target.width * ratio)
    canvas.height = Math.ceil(target.height * ratio)
    canvas.style.width = target.width + 'px'
    canvas.style.height = target.height + 'px'
    context!.setTransform(ratio, 0, 0, ratio, 0, 0)
    target.painted = false
    highlightsDirty = true
    target.debugRevision = -1
    highlight(performance.now())
  }
  const mutation = new MutationObserver(refresh), resize = new ResizeObserver(refresh)
  mutation.observe(host, { childList: true, characterData: true, subtree: true })
  resize.observe(host)
  resize.observe(paper)
  window.addEventListener('resize', refresh)
  window.addEventListener('scroll', refresh, true)
  document.fonts?.ready.then(refresh)
  refresh()
  function dispose() {
    if (disposed) return
    disposed = true
    mutation.disconnect()
    resize.disconnect()
    window.removeEventListener('resize', refresh)
    window.removeEventListener('scroll', refresh, true)
    canvas.remove()
    targets.delete(target)
    highlightsDirty = true
    if (cursor?.target === target) cursor = null
    highlight(performance.now())
  }
  return dispose
}

function visible(target: Target, glyph: Glyph) {
  return glyph.x > target.clip.left && glyph.x < target.clip.right && glyph.y > target.clip.top && glyph.y < target.clip.bottom
}
function onPaper(rig: DeskReading, side: PageSide, world: THREE.Vector3, target: Target) {
  rig.pagePoint(side, world, local)
  return { x: local.x * target.width, y: local.y * target.height }
}

export const bookInk = {
  register,
  inspect() {
    return [...targets].map(target => ({ debug: !!target.options.debug, side: target.side,
      glyphs: target.glyphs.map(g => ({ text: g.text, x: g.x, pageY: g.y, activatedAt: g.activatedAt,
        ...inkLife(g.activatedAt, target.options.debug && debugState.mode === 'scrub' ? target.debugTime : performance.now()) })) }))
  },
  replay(origin: Element, side: PageSide) {
    for (const target of [...targets]) if (target.options.ephemeral) target.dispose()
    const host = (origin.closest('.ink-block') || origin) as HTMLElement
    return register(host, side, { animate: true, ephemeral: true })
  },
  frame(now: number, rig: DeskReading, pose: InkHandPose) {
    if (!targets.size) return null
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    let hand: ReturnType<InkHandPose> | null = null
    let manual = false
    const debug = [...targets].find(t => t.options.debug && debugState.enabled)
    if (debug && debugState.mode === 'scrub' && debug.glyphs.length) {
      manual = true
      const glyphs = debug.glyphs, first = glyphs[0], last = glyphs.at(-1)!
      const start = first.x - 12, end = last.x + 12, duration = 6000, elapsed = duration * debugState.progress
      const sampleAt = (time: number) => {
        const x = start + (end - start) * time / duration
        const actual = pose(debug.side, x / debug.width, first.y / debug.height, 1)
        return { actual, point: onPaper(rig, debug.side, actual.tip, debug) }
      }
      if (debug.debugRevision !== debugState.revision) {
        glyphs.forEach(g => { g.activatedAt = null })
        const base = now - elapsed
        let previous = sampleAt(0).point
        // Scrubbing replays the same world-space spatial detector with an
        // inspectable clock; it does NOT assign activation from character i.
        for (let t = 0; t < elapsed; t += 16) {
          const current = sampleAt(t).point
          wakeInk(glyphs, previous, current, 10, base + t)
          previous = current
        }
        const final = sampleAt(elapsed)
        wakeInk(glyphs, previous, final.point, 10, now)
        debug.debugTime = now
        debug.debugRevision = debugState.revision
      }
      hand = sampleAt(elapsed).actual
    } else {
      const active = [...targets].reverse().find(t => !t.options.paused && (!debugState.enabled || t.options.debug) &&
        t.glyphs.some(g => g.activatedAt === null && visible(t, g)))
      if (active && !reduced) {
        const next = active.glyphs.find(g => g.activatedAt === null && visible(active, g))!
        const entering = cursor?.target !== active
        if (entering) cursor = { target: active, point: { x: next.x - 18, y: next.y }, last: now }
        if (!cursor) return null
        const previous = { ...cursor.point }, distance = Math.hypot(next.x - previous.x, next.y - previous.y)
        const travel = Math.min(1, (now - cursor.last) * .09 / Math.max(1, distance))
        cursor.point.x += (next.x - cursor.point.x) * travel
        cursor.point.y += (next.y - cursor.point.y) * travel
        cursor.last = now
        hand = pose(active.side, cursor.point.x / active.width, cursor.point.y / active.height,
          smoothstep(0, 140, now - active.startedAt))
        const actual = onPaper(rig, active.side, hand.tip, active)
        for (const target of targets)
          if (target.side === active.side && !target.options.paused && (!debugState.enabled || target.options.debug))
            wakeInk(target.glyphs, entering ? actual : previous, actual, 10, now)
        cursor.point = actual
      }
    }
    for (const target of [...targets]) {
      if (!target.host.isConnected) { target.dispose(); continue }
      if (reduced && !manual) target.glyphs.forEach(g => { g.activatedAt = now - 1200 })
      paint(target, target.options.debug && manual ? target.debugTime : now, reduced)
      if (target.options.ephemeral && target.glyphs.every(g => g.activatedAt !== null && now - g.activatedAt >= 1200)) target.dispose()
    }
    highlight(now)
    return hand ? { ...hand, manual } : null
  },
  stop() { cursor = null },
}
