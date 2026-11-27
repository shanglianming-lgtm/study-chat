// One score for the physical hand, its wake, and the ink leaving the paper.
// The hand must touch down before the letters move, not chase an open overlay.
export const INK_SPELL = {
  contact: 200,
  brush: 460,
  rise: 760,
  duration: 1320,
  settle: 420,
} as const

function ease(value: number) {
  const t = Math.max(0, Math.min(1, value))
  return t * t * t * (t * (t * 6 - 15) + 10)
}

export function inkBrushPose(ms: number) {
  const approach = ease(ms / INK_SPELL.contact)
  // Continue across the line instead of stopping over a fingertip and then
  // reversing toward the wrist. Ink delays also progress left-to-right.
  const sweep = Math.max(0, Math.min(1, (ms - INK_SPELL.contact) / INK_SPELL.brush))
  const lift = ease((ms - INK_SPELL.contact - INK_SPELL.brush - 40) / 500)
  return {
    // Drift only a little after the pass: an unbounded travel sent the palm
    // off the right leaf while the ink was still rising under its fingertips.
    travel: sweep - .5 + .08 * lift,
    sweep,
    lift,
    height: .009 + .012 * (1 - approach) + .028 * lift,
    opacity: ease(ms / 120) * (1 - ease((ms - INK_SPELL.duration + 180) / 180)),
  }
}
