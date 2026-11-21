import { useLayoutEffect, useRef, type RefObject } from 'react'

export type Journey = { direction: 'out' | 'back'; origin: DOMRect }

/** A single hinged volume stays visible from the shelf to the desk and reader. */
export default function BookJourney({ journey, shelf, desk, reader, onReveal, onFinish }: {
  journey: Journey
  shelf: RefObject<HTMLButtonElement | null>
  desk: RefObject<HTMLDivElement | null>
  reader: RefObject<HTMLDivElement | null>
  onReveal: () => void
  onFinish: (direction: Journey['direction']) => void
}) {
  const volume = useRef<HTMLDivElement>(null)
  const cover = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!volume.current || !cover.current || !shelf.current || !desk.current) return
    let cancelled = false
    const animations: Animation[] = []
    const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    const move = async (element: HTMLElement, frames: Keyframe[], duration: number) => {
      if (cancelled) return
      const animation = element.animate(frames, { duration, fill: 'forwards', easing: 'cubic-bezier(.3,.05,.2,1)' })
      animations.push(animation)
      try { await animation.finished } catch { /* unmount cancels the journey */ }
    }
    const spine = journey.direction === 'out' ? journey.origin : shelf.current.getBoundingClientRect()
    const desktop = desk.current.getBoundingClientRect()
    const shelfPose = `translate(${spine.x}px,${spine.y}px) scale(${spine.width / 120},${spine.height / 170})`
    const deskPose = `translate(${desktop.x + desktop.width * .52 - 60}px,${desktop.y + desktop.height * .22 - 85}px) perspective(900px) rotateX(48deg) rotateZ(-16deg)`
    const readingPose = (rect: DOMRect) => `translate(${rect.x + rect.width / 2}px,${rect.y}px) scale(${rect.width / 240},${rect.height / 170})`
    const book = volume.current
    const lid = cover.current

    void (async () => {
      if (journey.direction === 'out') {
        lid.style.transform = 'rotateY(0deg)'
        await move(book, [
          { transform: shelfPose },
          { transform: `translate(${spine.x - 24}px,${spine.y - 12}px) scale(.8,1)`, offset: .3 },
          { transform: deskPose },
        ], 800)
        if (cancelled) return
        await move(lid, [{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(-180deg)' }], 380)
        if (cancelled) return
        onReveal()
        await frame()
        await frame()
        if (cancelled) return
        const target = reader.current?.getBoundingClientRect()
        if (target) await move(book, [{ transform: deskPose }, { transform: readingPose(target) }], 420)
      } else {
        lid.style.transform = 'rotateY(-180deg)'
        await move(book, [{ transform: readingPose(journey.origin) }, { transform: deskPose }], 500)
        if (cancelled) return
        await move(lid, [{ transform: 'rotateY(-180deg)' }, { transform: 'rotateY(0deg)' }], 380)
        if (cancelled) return
        await move(book, [{ transform: deskPose }, { transform: shelfPose }], 750)
      }
      if (!cancelled) onFinish(journey.direction)
    })()
    return () => { cancelled = true; animations.forEach(animation => animation.cancel()) }
  }, [journey, shelf, desk, reader, onReveal, onFinish])

  return <div className="book-transfer" ref={volume} aria-hidden="true">
    <div className="transfer-page"><span>在这里，慢下来</span><i /><i /><i /><i /></div>
    <div className="transfer-lid" ref={cover}>
      <div className="transfer-cover"><small>书房文库 / 001</small><strong>与自己的<br />漫长对话</strong><span>书房 Chat</span></div>
      <div className="transfer-inside"><small>与自己的漫长对话</small><i /><i /><i /></div>
    </div>
  </div>
}
