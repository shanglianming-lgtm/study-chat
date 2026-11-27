import { describe, expect, it } from 'vitest'
import { deskSeatPose } from './deskSeat'

describe('sitting down to read', () => {
  it('sets the closed book down and releases it before the reader settles over the pages', () => {
    expect(deskSeatPose(0)).toMatchObject({ landing: 0, seated: 0, handRaised: 1, opening: 0, lean: 0 })
    expect(deskSeatPose(.40)).toMatchObject({ landing: 1, contact: 1, seated: 0, opening: 0 })
    const lowering = deskSeatPose(.58)
    expect(lowering.seated).toBeGreaterThan(0)
    expect(lowering.seated).toBeLessThan(1)
    expect(lowering).toMatchObject({ approach: 1, handRaised: 0, landing: 1, lean: 0 })
    expect(deskSeatPose(1)).toMatchObject({ landing: 1, seated: 1, handRaised: 0, opening: 1, lean: 1 })
  })
  it('closes the book and stands before lifting it on the way back', () => {
    const standing = deskSeatPose(.40), lifting = deskSeatPose(.20)
    expect(standing).toMatchObject({ seated: 0, opening: 0, landing: 1 })
    expect(lifting).toMatchObject({ seated: 0, opening: 0, handRaised: 1 })
    expect(lifting.landing).toBeGreaterThan(0)
    expect(lifting.landing).toBeLessThan(1)
  })
})
