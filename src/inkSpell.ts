// The hovering cue leads; the book answers by lifting its own ink. `contact`
// is the ink's response delay, not a physical fingertip touching the leaf.
export const INK_SPELL = {
  contact: 200,
  brush: 460,
  rise: 760,
  gesture: 880,
  duration: 1320,
  settle: 420,
} as const

function ease(value: number) {
  const t = Math.max(0, Math.min(1, value))
  return t * t * t * (t * (t * 6 - 15) + 10)
}

export function inkHoverPose(ms: number) {
  const pass = ease(ms / INK_SPELL.gesture)
  const leave = ease((ms - 500) / 380)
  return {
    pass,
    leave,
    // One small upward arc at the OUTER margin, not a wipe across the ink.
    // The palm/forearm remain outside the leaf; only relaxed fingers enter.
    edge: .99 - .035 * Math.sin(Math.PI * pass) + .10 * leave,
    along: .055 - .13 * pass,
    height: .022 + .016 * leave,
    opacity: ease(ms / 100) * (1 - ease((ms - 560) / 320)),
  }
}
