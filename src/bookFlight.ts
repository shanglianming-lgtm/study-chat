import * as THREE from 'three'

// All flight paths and rotations are about the cover's centre. The GLB pivots at its spine.
export const closedCoverCenter = new THREE.Vector3(0.079, 0.015, 0)
export const bookPose = () => ({ center: new THREE.Vector3(), rotation: new THREE.Quaternion(), scale: 1 })
export type BookPose = ReturnType<typeof bookPose>

export function readBookPose(book: THREE.Object3D, pose: BookPose) {
  pose.scale = book.scale.x
  pose.rotation.copy(book.quaternion)
  pose.center.copy(closedCoverCenter).multiplyScalar(pose.scale).applyQuaternion(pose.rotation).add(book.position)
}

export function placeBook(book: THREE.Object3D, pose: BookPose) {
  book.scale.setScalar(pose.scale)
  book.quaternion.copy(pose.rotation)
  book.position.copy(closedCoverCenter).multiplyScalar(-pose.scale).applyQuaternion(pose.rotation).add(pose.center)
}

export function shelfFlightTiming(phase: number) {
  const ease = THREE.MathUtils.smootherstep
  return {
    reach: ease(phase, 0, 0.45),
    beckon: ease(phase, 0.02, 0.36) * (1 - ease(phase, 0.43, 0.86)),
    release: ease(phase, 0.10, 0.42),
    flight: ease(phase, 0.27, 1),
    turn: ease(phase, 0.32, 0.92),
    settle: Math.sin(Math.PI * ease(phase, 0.63, 1)),
  }
}

export function createShelfFlight() {
  const bank = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0)
  return (dock: BookPose, hand: BookPose, facing: THREE.Vector3, right: THREE.Vector3,
    timing: ReturnType<typeof shelfFlightTiming>, result: BookPose) => {
    const { flight, release, turn, settle } = timing
    const arch = Math.sin(Math.PI * flight) * (1.16 - 0.45 * flight)
    const distance = dock.center.distanceTo(hand.center)
    result.center.lerpVectors(dock.center, hand.center, flight)
      .addScaledVector(facing, 0.36 * release * (1 - flight))
      .addScaledVector(right, -Math.min(0.14, distance * 0.10) * arch)
    result.center.y += Math.min(0.23, distance * 0.16) * arch
    result.rotation.slerpQuaternions(dock.rotation, hand.rotation, turn)
    result.rotation.premultiply(bank.setFromAxisAngle(right, -0.13 * arch + 0.058 * settle))
    result.rotation.premultiply(bank.setFromAxisAngle(up, 0.22 * arch))
    result.scale = THREE.MathUtils.lerp(dock.scale, hand.scale, flight)
  }
}

/** A critically damped position spring. Velocity survives input changes and falls to zero at rest. */
export function createBookFollower() {
  const center = new THREE.Vector3(), velocity = new THREE.Vector3()
  const error = new THREE.Vector3(), impulse = new THREE.Vector3()
  const previousVelocity = new THREE.Vector3()
  const rotation = new THREE.Quaternion(), steering = new THREE.Quaternion()
  const lean = new THREE.Quaternion(), bank = new THREE.Euler(0, 0, 0, 'YXZ')
  let initialized = false, moving = false, boardLift = 0
  function reset(pose: BookPose) {
    center.copy(pose.center)
    rotation.copy(pose.rotation)
    steering.copy(pose.rotation)
    velocity.set(0, 0, 0)
    boardLift = 0
    moving = false
    initialized = true
  }
  return {
    reset,
    get moving() { return moving },
    get boardLift() { return boardLift },
    update(target: BookPose, right: THREE.Vector3, dt: number, reduced: boolean, result: BookPose) {
      if (reduced || !initialized) reset(target)
      const frequency = 12
      const decay = Math.exp(-frequency * dt)
      error.subVectors(center, target.center)
      previousVelocity.copy(velocity)
      impulse.copy(velocity).addScaledVector(error, frequency).multiplyScalar(dt)
      center.copy(target.center).addScaledVector(error.add(impulse), decay)
      velocity.addScaledVector(impulse, -frequency).multiplyScalar(decay)
      // A loose front board follows a change of velocity, then closes under its own weight.
      const acceleration = dt > 0 ? velocity.distanceTo(previousVelocity) / dt : 0
      const lift = Math.min(0.078, acceleration * 0.013)
      boardLift = reduced ? 0 : THREE.MathUtils.damp(boardLift, lift, lift > boardLift ? 9 : 6, dt)
      if (boardLift < 0.0005 && lift < 0.0005) boardLift = 0

      // Preserve the initial lag while keeping the folio within reach through a sudden about-face.
      error.subVectors(center, target.center)
      const lag = error.length()
      if (lag > 0.065) error.multiplyScalar((0.065 + 0.06 * Math.tanh((lag - 0.065) / 0.06)) / lag)
      result.center.copy(target.center).add(error)
      steering.slerp(target.rotation, 1 - decay)
      rotation.slerp(steering, 1 - decay)
      const angle = rotation.angleTo(target.rotation)
      moving = lag > 0.0001 || velocity.lengthSq() > 1e-7 || angle > 0.0005 || boardLift > 0
      result.rotation.copy(rotation)
      if (angle > 0.5) result.rotation.slerp(target.rotation, 1 - 0.5 / angle)
      if (!reduced) {
        const lateral = error.dot(right)
        const depth = error.x * right.z - error.z * right.x
        bank.set(-0.68 * depth, 0, 1.10 * lateral)
        result.rotation.multiply(lean.setFromEuler(bank))
      }
      result.scale = target.scale
    },
  }
}
