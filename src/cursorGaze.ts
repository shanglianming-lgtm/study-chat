const radians = Math.PI / 180
const frequency = 12
const maxYawRate = 54 * radians
const maxPitchRate = 32 * radians

function cursorPosition(value: number) {
  const distance = Math.min(1, Math.abs(value))
  return Math.sign(value) * Math.max(0, (distance - 0.1) / 0.9)
}

function strength(value: number, start = 0) {
  const t = Math.max(0, Math.min(1, (Math.abs(value) - start) / (1 - start)))
  return Math.sign(value) * t * t * (3 - 2 * t)
}

type Axis = { position: number; speed: number; target: number }

// A critically damped pointer keeps the first few pixels of a glance gentle.
function advance(axis: Axis, dt: number) {
  if (axis.position === axis.target && axis.speed === 0) return false
  const distance = axis.position - axis.target
  const impulse = axis.speed + frequency * distance
  const decay = Math.exp(-frequency * dt)
  axis.position = axis.target + (distance + impulse * dt) * decay
  axis.speed = (axis.speed - frequency * impulse * dt) * decay
  if (Math.abs(axis.position - axis.target) < 0.00025 && Math.abs(axis.speed) < 0.002) {
    axis.position = axis.target
    axis.speed = 0
  }
  return true
}

export function createCursorGaze() {
  const horizontal: Axis = { position: 0, speed: 0, target: 0 }
  const vertical: Axis = { position: 0, speed: 0, target: 0 }
  const frame = { glanceChanged: false, turn: 0, tilt: 0 }

  return {
    get yaw() { return -strength(horizontal.position) * 9 * radians },
    get pitch() { return strength(vertical.position) * 5 * radians },
    aim(x: number, y: number) {
      horizontal.target = cursorPosition(x)
      vertical.target = cursorPosition(y)
    },
    reset() {
      for (const axis of [horizontal, vertical]) axis.position = axis.speed = axis.target = 0
      frame.glanceChanged = false
      frame.turn = frame.tilt = 0
    },
    update(dt: number) {
      const oldX = horizontal.position, oldY = vertical.position
      const xChanged = advance(horizontal, dt), yChanged = advance(vertical, dt)
      frame.glanceChanged = xChanged || yChanged
      // Integrate a turn into the player's bearing on every frame, including when the mouse is still.
      // The horizontal edge begins about 14% in from either side; the vertical edge is narrower.
      frame.turn = -maxYawRate * dt * (strength(oldX, 0.69) + strength(horizontal.position, 0.69)) / 2
      frame.tilt = maxPitchRate * dt * (strength(oldY, 0.80) + strength(vertical.position, 0.80)) / 2
      return frame
    },
  }
}
