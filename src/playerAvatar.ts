import * as THREE from 'three'

/** Pose deltas are measured in the standing model's axes. The original VRoid bones
 * have different rolls on the left and right, so convert the axes once at bind time. */
function jointPitch(bone: THREE.Bone, bend = new THREE.Vector3(1, 0, 0), turn = new THREE.Vector3(0, 1, 0)) {
  const inverse = bone.getWorldQuaternion(new THREE.Quaternion()).invert()
  const x = bend.clone().applyQuaternion(inverse)
  const y = turn.clone().applyQuaternion(inverse)
  const rest = bone.quaternion.clone(),
    delta = new THREE.Quaternion()
  return (pitch: number, turnIn = 0) => {
    bone.quaternion.copy(rest)
    if (turnIn) bone.quaternion.multiply(delta.setFromAxisAngle(y, turnIn))
    bone.quaternion.multiply(delta.setFromAxisAngle(x, pitch))
  }
}

export function createPlayerAvatar(model: THREE.Group, standingEyes: number) {
  model.updateMatrixWorld(true)
  const bone = (name: string) => {
    const joint = model.getObjectByName(name)
    if (!(joint instanceof THREE.Bone)) throw new Error('Missing player bone: ' + name)
    return joint
  }
  const eyes = bone('J_Adj_L_FaceEye')
    .getWorldPosition(new THREE.Vector3())
    .lerp(bone('J_Adj_R_FaceEye').getWorldPosition(new THREE.Vector3()), 0.5)
  // The VRoid eye pivots sit behind the visible irises.
  eyes.z += 0.049
  const size = standingEyes / eyes.y
  const hip = bone('J_Bip_L_UpperLeg').getWorldPosition(new THREE.Vector3())
  const eyeAboveSeat = (eyes.y - hip.y + 0.065) * size
  const forearm = bone('J_Bip_R_LowerArm'),
    wrist = bone('J_Bip_R_Hand'),
    indexKnuckle = bone('J_Bip_R_Index1'),
    littleKnuckle = bone('J_Bip_R_Little1')
  const point = (joint: THREE.Bone) => joint.getWorldPosition(new THREE.Vector3())
  const across = point(indexKnuckle).sub(point(littleKnuckle)).normalize()
  const palmNormal = across.clone().cross(point(bone('J_Bip_R_Middle1')).sub(point(wrist))).normalize()
  const fingers = ['Index', 'Middle', 'Ring', 'Little'].map((name) => ({
    base: jointPitch(bone('J_Bip_R_' + name + '1'), across, palmNormal),
    middle: jointPitch(bone('J_Bip_R_' + name + '2'), across, palmNormal),
  }))
  const bendWrist = jointPitch(wrist, across, palmNormal)
  const forearmAxis = wrist.position.clone().normalize(),
    palmRoll = new THREE.Quaternion()
  const legsAndArms = (side: 'L' | 'R') => {
    const limb = (name: string) => jointPitch(bone('J_Bip_' + side + '_' + name))
    return {
      thigh: limb('UpperLeg'),
      shin: limb('LowerLeg'),
      foot: limb('Foot'),
      arm: limb('UpperArm'),
      elbow: limb('LowerArm'),
    }
  }
  const left = legsAndArms('L'),
    right = legsAndArms('R'),
    spine = jointPitch(bone('J_Bip_C_Spine'))
  model.traverse((node) => {
    if (node.userData.firstPersonHidden) node.visible = false
    if (!(node instanceof THREE.Mesh)) return
    const materials = Array.isArray(node.material) ? node.material : [node.material]
    if (materials.every((material) => material.userData.firstPersonHidden)) node.visible = false
    // The room caches its static shadow map. A moving body must never leave a baked silhouette.
    node.castShadow = false
    node.receiveShadow = true
    if (node instanceof THREE.SkinnedMesh) node.frustumCulled = false
  })

  model.name = 'Local player'
  model.scale.setScalar(size)
  const forward = new THREE.Vector3(),
    offset = new THREE.Vector3(),
    castingPalm = new THREE.Vector3()
  const up = new THREE.Vector3(0, 1, 0),
    heading = new THREE.Quaternion()
  const coverTilt = new THREE.Euler(0, 0, 0, 'YXZ'),
    coverRotation = new THREE.Quaternion()
  let phase = 0,
    stride = 0,
    wristSide = 0,
    wristHeight = 0

  return {
    size,
    castingPalm,
    get stepping() {
      return stride > 0
    },
    seatedEye(seat: THREE.Vector3, target: THREE.Vector3, result: THREE.Vector3) {
      forward.subVectors(target, seat).setY(0).normalize()
      result.copy(seat).addScaledVector(forward, (eyes.z - hip.z) * size)
      result.y += eyeAboveSeat
    },
    update(
      camera: THREE.PerspectiveCamera,
      eyePosition: THREE.Vector3,
      travel: number,
      dt: number,
      seated: number,
      casting: number,
      reduceMotion: boolean,
      flourish = 0,
      aim?: THREE.Vector2
    ) {
      camera.getWorldDirection(forward)
      const yaw = Math.atan2(-forward.x, -forward.z)
      heading.setFromAxisAngle(up, yaw)
      model.rotation.y = yaw + Math.PI
      offset.copy(eyes).multiplyScalar(size).applyQuaternion(model.quaternion)
      model.position.copy(eyePosition).sub(offset)
      // Pitch about the neck and lean over the dress when examining the body.
      // Only the rendered eye advances; the feet and movement origin stay put.
      const lean = THREE.MathUtils.smoothstep(-forward.y, 0.22, 0.97) * (1 - seated)
      camera.position.copy(eyePosition).addScaledVector(forward.setY(0).normalize(), 0.29 * lean)
      camera.position.y -= 0.035 * lean
      camera.updateMatrixWorld()

      const previousContact = Math.floor((phase + Math.PI / 2) / Math.PI)
      const moving = Math.abs(travel) > 0.00001
      if (moving) phase += (travel * Math.PI * 2) / 1.36
      const wanted = moving ? Math.min(1, Math.abs(travel) / (Math.max(0.001, dt) * 1.7)) : 0
      stride = reduceMotion ? 0 : THREE.MathUtils.damp(stride, wanted, 14, dt)
      if (stride < 0.006 && !moving) stride = 0
      const step = Math.sin(phase) * stride * (1 - seated)
      // Heel contact is the lowest point of the eye trajectory. The head stays level
      // while the shoulders counter-rotate and the pelvis transfers weight laterally.
      const weight = stride * (1 - seated)
      camera.position.x += Math.cos(yaw) * .012 * step
      camera.position.z -= Math.sin(yaw) * .012 * step
      camera.position.y += .016 * Math.cos(2 * phase) * weight
      camera.updateMatrixWorld()
      // Tip the torso over the knees during the weight transfer, then straighten on the cushion.
      spine(.014 * weight + .11 * Math.sin(Math.PI * seated), -.035 * step)
      const gesture = reduceMotion ? 0 : flourish
      const turnIn = 0.35 + 0.17 * (1 - THREE.MathUtils.smoothstep(camera.aspect, 0.55, 1))
      const aimSide = (aim?.x ?? 0) * (0.025 + 0.17 * THREE.MathUtils.smoothstep(camera.aspect, 0.63, 1.5))
      const aimHeight = aim?.y ?? 0
      wristSide = aimSide
      wristHeight = aimHeight
      function pose(side: typeof left, swing: number, spell: number) {
        const knee = 0.45 * Math.max(0, -swing)
        side.thigh(-0.4 * swing - 1.22 * seated)
        side.shin(knee + 1.32 * seated)
        side.foot(0.2 * swing - knee * 0.55 - 0.1 * seated)
        const reach = -1.18 - 0.27 * gesture + 0.095 * swing - 0.115 * aimHeight
        side.arm(THREE.MathUtils.lerp(0.24 * swing - 0.16 * seated, reach, spell),
          (turnIn + 0.22 * gesture + 0.055 * swing - aimSide) * spell)
        side.elbow(THREE.MathUtils.lerp(-0.13 * Math.max(0, -swing) - 0.91 * seated,
          -0.49 + 0.22 * gesture - 0.06 * swing - 0.035 * aimHeight, spell))
      }
      pose(left, step, 0)
      pose(right, -step, casting)
      forearm.quaternion.multiply(palmRoll.setFromAxisAngle(forearmAxis, (1.54 - 0.72 * gesture) * casting))
      bendWrist((-0.065 - 0.19 * gesture) * casting, 0.15 * gesture * casting)
      fingers.forEach((finger, i) => {
        const beckon = THREE.MathUtils.smoothstep(gesture, i * 0.11, 0.68 + i * 0.09)
        const curl = (0.07 + i * 0.073 + (0.32 + i * 0.064) * beckon) * casting
        finger.base(curl, (1.5 - i) * (0.025 - 0.055 * beckon) * casting)
        finger.middle(curl * 0.72)
      })
      model.updateMatrixWorld(true)
      // Halfway across the palm and between the wrist crease and the roots of the fingers.
      indexKnuckle.getWorldPosition(castingPalm)
      castingPalm.lerp(littleKnuckle.getWorldPosition(offset), 0.5)
      castingPalm.lerp(wrist.getWorldPosition(offset), 0.40)
      return moving && seated === 0 && previousContact !== Math.floor((phase + Math.PI / 2) / Math.PI)
    },
    hoverTarget(center: THREE.Vector3, rotation: THREE.Quaternion) {
      coverTilt.set(0.82 + 0.055 * wristHeight, 0.26 + 0.50 * wristSide, -0.042 - 0.12 * wristSide)
      rotation.copy(heading).multiply(coverRotation.setFromEuler(coverTilt))
      center.copy(castingPalm)
      center.y += 0.226 * size
    },
  }
}
