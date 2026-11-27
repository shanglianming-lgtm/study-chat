import { MathUtils } from 'three'

export const deskJourneyMs = 2750
export const flatDeskJourneyMs = 760

// The same positions are traversed in reverse when the reader stands up.
export function deskSeatPose(time: number) {
  const phase = (start: number, end: number) => MathUtils.smootherstep(time, start, end)
  return {
    approach: phase(0, 0.50),
    faceDesk: phase(0, 0.45),
    landing: phase(0.04, 0.38),
    contact: phase(0.32, 0.38),
    handRaised: 1 - phase(0.32, 0.50),
    seated: phase(0.43, 0.77),
    settle: Math.sin(Math.PI * phase(0.72, 0.88)),
    opening: phase(0.68, 0.96),
    lean: phase(0.70, 1),
  }
}
