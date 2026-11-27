/** Follow the last line, or preserve the paragraph the reader has scrolled to. */
export type ScrollMark = { turn?: string; offset?: number }
export function maintainReadingPosition(pane: HTMLElement, text: HTMLElement, mark?: ScrollMark) {
  let anchor = mark?.turn ? Array.from(text.children).find(el => (el as HTMLElement).dataset.turn === mark.turn) as HTMLElement | undefined : undefined
  let following = !anchor
  let lastTop = pane.scrollTop
  let offset = mark?.offset || 0

  function rememberScroll() {
    const top = pane.scrollTop
    // A scroll event can arrive after a second batch of ink has already increased scrollHeight.
    // Our last adjustment is not a reader gesture, even when it is no longer at the new bottom.
    if (Math.abs(top - lastTop) < 0.75) return
    lastTop = top
    following = pane.scrollHeight - pane.clientHeight - top < 3
    if (following) {
      if (mark) delete mark.turn
      return
    }
    anchor = Array.from(text.children).find((child) => {
      const turn = child as HTMLElement
      return turn.offsetTop + turn.offsetHeight > top
    }) as HTMLElement | undefined
    if (anchor) {
      offset = top - anchor.offsetTop
      if (mark) { mark.turn = anchor.dataset.turn; mark.offset = offset }
    }
  }

  function align() {
    const bottom = Math.max(0, pane.scrollHeight - pane.clientHeight)
    // The browser clamps scrollTop if text was erased or the paper grew taller.
    lastTop = Math.min(lastTop, bottom)
    rememberScroll()
    if (following) pane.scrollTop = bottom
    else if (anchor?.parentElement === text) pane.scrollTop = anchor.offsetTop + offset
    lastTop = pane.scrollTop
  }

  align()
  const observer = new ResizeObserver(align)
  observer.observe(text)
  observer.observe(pane)
  pane.addEventListener('scroll', rememberScroll)
  return () => {
    observer.disconnect()
    pane.removeEventListener('scroll', rememberScroll)
  }
}
