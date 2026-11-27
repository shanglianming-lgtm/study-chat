import type { Vector3 } from 'three'

/** Velocities are in world-space metres per second. A blocked axis sheds its momentum. */
export function createStudyWalk() {
  let vx = 0, vz = 0
  return {
    stop() { vx = vz = 0 },
    advance(eye: Vector3, yaw: number, forward: number, side: number, dt: number,
      canStand: (x: number, z: number) => boolean) {
      if (dt <= 0) return 0
      const length = Math.max(1, Math.hypot(forward, side))
      const along = forward * (forward >= 0 ? 1.52 : 1.04) / length, across = side * 1.22 / length
      const sin = Math.sin(yaw), cos = Math.cos(yaw)
      const targetX = cos * across - sin * along, targetZ = -sin * across - cos * along
      const change = Math.hypot(targetX - vx, targetZ - vz)
      const ramp = (forward || side) ? 5.6 : 8.8
      const rising = Math.min(dt, change / ramp)
      const blend = change ? Math.min(1, dt * ramp / change) : 1
      const nextX = vx + (targetX - vx) * blend, nextZ = vz + (targetZ - vz) * blend
      const dx = nextX * dt + (vx - nextX) * rising / 2
      const dz = nextZ * dt + (vz - nextZ) * rising / 2
      const startX = eye.x, startZ = eye.z
      vx = nextX
      vz = nextZ
      if (dx && canStand(eye.x + dx, eye.z)) eye.x += dx
      else if (dx) vx = 0
      if (dz && canStand(eye.x, eye.z + dz)) eye.z += dz
      else if (dz) vz = 0
      const movedX = eye.x - startX, movedZ = eye.z - startZ
      return Math.hypot(movedX, movedZ) * (-sin * movedX - cos * movedZ < -1e-5 ? -1 : 1)
    },
  }
}
