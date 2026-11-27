import * as THREE from 'three'
import type { DeskReading, PageSide } from './deskReading'
import { inkHoverPose } from './inkSpell'

/** A small air gesture beside the text, not a hand wiping or pressing it.
 * Anchor the longest relaxed finger; the palm stays beyond the outer edge. */
export function createPageBrush(fingertip: THREE.Vector3) {
  const origin = new THREE.Vector3(), right = new THREE.Vector3(), down = new THREE.Vector3()
  const normal = new THREE.Vector3(), target = new THREE.Vector3(), offset = new THREE.Vector3()
  const basis = new THREE.Matrix4(), turn = new THREE.Quaternion(), wrist = new THREE.Euler(0, 0, 0, 'YXZ')
  return (hand: THREE.Object3D, rig: Pick<DeskReading, 'worldPoint'>, side: PageSide,
    v: number, ms: number) => {
    const pose = inkHoverPose(ms)
    const direction = side === 'right' ? 1 : -1
    rig.worldPoint(side, 0, 0, 0, origin)
    rig.worldPoint(side, 1, 0, 0, right).sub(origin).normalize()
    rig.worldPoint(side, 0, 1, 0, down).sub(origin).normalize()
    normal.crossVectors(down, right).normalize()
    rig.worldPoint(side, side === 'right' ? pose.edge : 1 - pose.edge,
      THREE.MathUtils.clamp(v, .14, .86) + pose.along, pose.height, target)
    hand.quaternion.setFromRotationMatrix(basis.makeBasis(right, normal, down))
    // Fingers point inward from the outside margin. Keep them parallel to
    // the leaf throughout entry: no downward approach or fingertip jab.
    wrist.set(.02 + .04 * pose.leave, direction * Math.PI / 2,
      direction * (.012 * Math.sin(Math.PI * pose.pass) + .06 * pose.leave), 'YXZ')
    hand.quaternion.multiply(turn.setFromEuler(wrist))
    hand.position.copy(target).sub(offset.copy(fingertip).multiply(hand.scale).applyQuaternion(hand.quaternion))
    return pose.opacity
  }
}
