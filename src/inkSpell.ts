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
  const sweep = ease((ms - INK_SPELL.contact) / INK_SPELL.brush)
  const lift = ease((ms - 500) / 380)
  const retreat = ease((ms - 900) / (INK_SPELL.duration - 900))
  return { reach: approach * (1 - retreat), sweep, lift, retreat }
}
