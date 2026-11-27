import * as THREE from 'three'

const smooth = THREE.MathUtils.smootherstep

/** Lift out of the stand, clear the shelf front, then bank towards the desk. */
export function sampleRegisterFlight(
  object: THREE.Object3D,
  dock: THREE.Vector3,
  orientation: THREE.Quaternion,
  desk: THREE.Vector3,
  flat: THREE.Quaternion,
  phase: number,
) {
  const lift = smooth(phase, 0, 0.13)
  const draw = smooth(phase, 0.07, 0.39)
  const cross = smooth(phase, 0.37, 1)
  object.position.copy(dock)
  object.position.y += 0.048 * lift
  object.position.z += 0.42 * draw
  object.position.lerp(desk, cross)
  object.position.y += 0.19 * Math.sin(Math.PI * cross)
  object.quaternion.slerpQuaternions(orientation, flat, smooth(phase, 0.39, 0.92))
}
