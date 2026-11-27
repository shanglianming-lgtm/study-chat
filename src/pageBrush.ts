import * as THREE from 'three'
import type { DeskReading, PageSide } from './deskReading'
import { inkBrushPose } from './inkSpell'

/** A relaxed palm passes parallel to the actual leaf, not tip-first at a
 * screen coordinate. The palm's outer edge, not the index tip, carries ink. */
export function createPageBrush(palm: THREE.Vector3) {
  const origin = new THREE.Vector3(), right = new THREE.Vector3(), down = new THREE.Vector3()
  const normal = new THREE.Vector3(), target = new THREE.Vector3(), offset = new THREE.Vector3()
  const basis = new THREE.Matrix4(), turn = new THREE.Quaternion(), wrist = new THREE.Euler(0, 0, 0, 'YXZ')
  return (hand: THREE.Object3D, rig: Pick<DeskReading, 'worldPoint'>, side: PageSide,
    u: number, v: number, width: number, ms: number) => {
    const pose = inkBrushPose(ms)
    const span = THREE.MathUtils.clamp(width, .22, .72)
    rig.worldPoint(side, 0, 0, 0, origin)
    rig.worldPoint(side, 1, 0, 0, right).sub(origin).normalize()
    rig.worldPoint(side, 0, 1, 0, down).sub(origin).normalize()
    normal.crossVectors(down, right).normalize()
    rig.worldPoint(side, u + span * pose.travel, v + .008 * Math.sin(Math.PI * pose.sweep), pose.height, target)
    hand.quaternion.setFromRotationMatrix(basis.makeBasis(right, normal, down))
    // Fingers remain together and point obliquely along the leaf. Only after
    // the pass does the wrist roll away; there is no touchdown or pinch beat.
    wrist.set(.015 + .10 * pose.lift, .42 + .06 * pose.sweep + .08 * pose.lift,
      .025 * Math.sin(Math.PI * pose.sweep) + .18 * pose.lift, 'YXZ')
    hand.quaternion.multiply(turn.setFromEuler(wrist))
    hand.position.copy(target).sub(offset.copy(palm).multiply(hand.scale).applyQuaternion(hand.quaternion))
    return pose.opacity
  }
}
