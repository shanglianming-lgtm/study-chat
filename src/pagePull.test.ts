import { expect, it } from 'vitest'
import { pullProgress, stepPaper } from './pagePull'

it('requires sustained inward travel on both paper sizes and allows bringing the sheet back', () => {
  for (const width of [280, 580]) {
    for (const single of [false, true]) {
      expect(pullProgress(-width, width, single)).toBe(pullProgress(6, width, single))
      expect(pullProgress(width * .4, width, single)).toBeLessThan(.5)
      expect(pullProgress(width * (single ? .8 : 1.2), width, single)).toBeGreaterThan(.5)
      expect(pullProgress(3 * width, width, single)).toBeLessThan(1)
    }
  }
})

it('retains inertia on reversal and settles at the same place at different refresh rates', () => {
  const evolve = (hz: number) => {
    let state = { position: 0, velocity: 0 }
    for (let i = 0; i < hz; i++) state = stepPaper(state.position, state.velocity, .7, 1/hz, 22)
    return state.position
  }
  expect(evolve(30)).toBeCloseTo(evolve(144), 8)
  const pull = stepPaper(0, 0, .8, .04, 22)
  const release = stepPaper(pull.position, pull.velocity, 0, .01, 12)
  expect(release.position).toBeGreaterThan(pull.position)
})
