// Distance is measured against the projected paper, so zoom and display density do not change the feel.
export function pullProgress(distance: number, width: number, single: boolean) {
  const travel = Math.max(0, distance - 8) / (Math.max(1, width) * (single ? 1.24 : 1.8))
  const t = Math.min(1, travel)
  return 0.018 + 0.964 * t * (0.84 + 0.16 * t)
}

export function stepPaper(position: number, velocity: number, target: number, dt: number, stiffness: number) {
  // Exact critically damped spring. Reversing a pull preserves the velocity of the leaf.
  const error = position - target
  const impulse = velocity + stiffness * error
  const decay = Math.exp(-stiffness * dt)
  return { position: target + (error + impulse * dt) * decay, velocity: (velocity - stiffness * impulse * dt) * decay }
}
