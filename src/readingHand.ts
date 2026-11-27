import * as THREE from 'three'
import type { HandAction } from './Correspondence'
import type { DeskReading, PageSide } from './deskReading'
import { INK_SPELL } from './inkSpell'
import { createPageBrush } from './pageBrush'

export type HandSignal = { action: HandAction; side: PageSide; u: number; v: number; width?: number; seq: number }
export function readingHand(avatar: THREE.Group) {
  avatar.updateMatrixWorld(true)
  const joint = (name: string) =>
    avatar.getObjectByName('J_Bip_R_' + name)!.getWorldPosition(new THREE.Vector3())
  const wrist = joint('Hand'),
    x = joint('Little1').sub(joint('Index1')).normalize(),
    z = wrist.clone().sub(joint('Middle1')).normalize()
  const y = z.clone().cross(x).normalize()
  z.crossVectors(x, y).normalize()
  const basis = new THREE.Matrix4().makeBasis(x, y, z).setPosition(wrist).invert(),
    tip = joint('Index3_end').applyMatrix4(basis)
  const digits = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'],
    joints = digits.map((d) => [1, 2, 3].map(n => joint(d + n).applyMatrix4(basis)))
  const palm = joints[1][0].clone().lerp(joints[4][0], .5).multiplyScalar(.58)
  palm.x += .012 // Carry the gesture on the little-finger edge of the palm.
  const sweepPalm = createPageBrush(palm)
  const hand = new THREE.Group(),
    poses = ['point', 'stroke', 'pinch', 'rewind', 'sweep'] as const
  hand.scale.setScalar(.76) // Keep the character branch's page-hand framing.
  const meshes: THREE.Mesh[] = []
  avatar.traverse((obj) => {
    if (
      !(obj instanceof THREE.SkinnedMesh) ||
      Array.isArray(obj.material) ||
      !obj.material.name.startsWith('Skin')
    )
      return
    const g = obj.geometry,
      weights = g.attributes.skinWeight,
      bones = g.attributes.skinIndex,
      positions = g.attributes.position,
      uv = g.attributes.uv
    const kept = new Map<number, {
      pos: THREE.Vector3; normal: THREE.Vector3; digit: number; bends: number[]
    }>()
    for (let i = 0; i < positions.count; i++) {
      let strongest = 0,
        name = ''
      for (let a = 0; a < 4; a++) {
        const w = weights.getComponent(i, a)
        if (w > strongest) {
          strongest = w
          name = obj.skeleton.bones[bones.getComponent(i, a)].name
        }
      }
      if (!/^J_Bip_R_(LowerArm|Hand|Thumb|Index|Middle|Ring|Little)/.test(name)) continue
      const pos = obj
        .getVertexPosition(i, new THREE.Vector3())
        .applyMatrix4(obj.matrixWorld)
        .applyMatrix4(basis)
      const tangent = new THREE.Vector3()
        .fromBufferAttribute(positions, i)
        .add(new THREE.Vector3().fromBufferAttribute(g.attributes.normal, i))
      const normal = obj
        .applyBoneTransform(i, tangent)
        .applyMatrix4(obj.matrixWorld)
        .applyMatrix4(basis)
        .sub(pos)
        .normalize()
      const digit = digits.findIndex((d) => name.includes(d))
      const bends = [1, 2, 3].map(segment => {
        let influence = 0
        for (let a = 0; a < 4; a++) {
          const boneName = obj.skeleton.bones[bones.getComponent(i, a)].name
          if (digit >= 0 && boneName.startsWith('J_Bip_R_' + digits[digit]) &&
            Number(boneName.match(/(\d)/)?.[1]) >= segment) influence += weights.getComponent(i, a)
        }
        return influence
      })
      kept.set(i, { pos, normal, digit, bends })
    }
    const ids: number[] = [],
      index: number[] = [],
      order = new Map<number, number>()
    for (let k = 0; k < (g.index?.count || positions.count); k += 3) {
      const tri = [0, 1, 2].map((j) => (g.index ? g.index.getX(k + j) : k + j))
      if (!tri.every((i) => kept.has(i))) continue
      for (const i of tri) {
        if (!order.has(i)) {
          order.set(i, ids.length)
          ids.push(i)
        }
        index.push(order.get(i)!)
      }
    }
    if (!ids.length) return
    const geo = new THREE.BufferGeometry()
    geo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        ids.flatMap((i) => kept.get(i)!.pos.toArray()),
        3
      )
    )
    if (uv)
      geo.setAttribute(
        'uv',
        new THREE.Float32BufferAttribute(
          ids.flatMap((i) => [uv.getX(i), uv.getY(i)]),
          2
        )
      )
    geo.setIndex(index)
    geo.setAttribute(
      'normal',
      new THREE.Float32BufferAttribute(
        ids.flatMap((i) => kept.get(i)!.normal.toArray()),
        3
      )
    )
    const curlAxis = new THREE.Vector3(1, 0, 0), thumbAxis = new THREE.Vector3(0, 1, 0)
    const morphs = poses.map(p => {
      const normals: number[] = []
      const positions = ids.flatMap(i => {
            const { pos, normal, digit, bends } = kept.get(i)!,
              point = pos.clone(), shade = normal.clone()
            if (digit >= 0) {
              const angle =
                  digit === 0
                    ? p === 'pinch'
                      ? 0.57
                      : 0.1
                    : p === 'point'
                      ? digit === 1
                        ? 0.06
                        : 1.03
                      : p === 'pinch'
                        ? digit === 1
                          ? 0.54
                          : 0.4
                        : p === 'rewind'
                          ? 0.48
                          : 0.13
              // Bend from the tip back to the root using the original skin
              // weights. No more rigid fingers hinging only at the knuckle.
              for (let segment = 2; segment >= 0; segment--) {
                const pivot = joints[digit][segment]
                const bend = -angle * bends[segment] * [0.55, 0.60, 0.35][segment]
                point.sub(pivot).applyAxisAngle(curlAxis, bend).add(pivot)
                shade.applyAxisAngle(curlAxis, bend)
              }
              if (digit === 0 && p === 'pinch') {
                point.sub(joints[0][0]).applyAxisAngle(thumbAxis, -0.35).add(joints[0][0])
                shade.applyAxisAngle(thumbAxis, -0.35)
              }
              if (digit > 0 && p === 'stroke') {
                const fanAxis = new THREE.Vector3(0, 0, 1), fan = (digit - 2.5) * .055
                point.sub(joints[digit][0]).applyAxisAngle(fanAxis, fan).add(joints[digit][0])
                shade.applyAxisAngle(fanAxis, fan)
              }
            }
            normals.push(...shade.toArray())
            return point.toArray()
      })
      return { position: new THREE.Float32BufferAttribute(positions, 3),
        normal: new THREE.Float32BufferAttribute(normals, 3) }
    })
    geo.morphAttributes.position = morphs.map(m => m.position)
    geo.morphAttributes.normal = morphs.map(m => m.normal)
    const mat = new THREE.MeshStandardMaterial({
      map: obj.material.map,
      color: obj.material.color,
      roughness: 0.83,
      side: THREE.DoubleSide,
      transparent: true,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.frustumCulled = false
    hand.add(mesh)
    meshes.push(mesh)
  })
  const scene = new THREE.Scene()
  const reduced = matchMedia('(prefers-reduced-motion: reduce)')
  scene.add(hand, new THREE.HemisphereLight(0xfff3d9, 0x87725f, 1.85))
  const sun = new THREE.DirectionalLight(0xffecd1, 1.55)
  sun.position.set(-2, 3, -1)
  scene.add(sun)
  let renderer: THREE.WebGLRenderer | undefined,
    start = 0,
    signal: HandSignal | undefined
  const location = new THREE.Vector3(),
    entry = new THREE.Vector3()
  function hide() {
    if (renderer) renderer.domElement.hidden = true
    signal = undefined
  }
  return {
    play(s: HandSignal, now: number) {
      if (meshes.length && !reduced.matches) {
        signal = s
        start = now
      }
    },
    draw(now: number, rig: DeskReading, camera: THREE.PerspectiveCamera, w: number, h: number) {
      if (!signal) return
      if (reduced.matches) { hide(); return }
      const brush = signal.action === 'stroke'
      const t = (now - start) / (brush ? INK_SPELL.duration : signal.action === 'sweep' ? 1000 : 850)
      if (t >= 1) {
        hide()
        return
      }
      // draw() already runs on requestAnimationFrame. A 24ms gate skipped
      // every other 60Hz frame and made even a smooth pose look like a jump.
      if (!renderer) {
        try {
          renderer = new THREE.WebGLRenderer({
            alpha: true,
            antialias: true,
            powerPreference: 'low-power',
            premultipliedAlpha: true,
          })
        } catch {
          signal = undefined
          return
        }
        renderer.toneMapping = THREE.ACESFilmicToneMapping
        renderer.setPixelRatio(Math.min(1.25, window.devicePixelRatio || 1))
        renderer.domElement.className = 'reading-hand'
        // Three's inline display:block would override hidden/reduced-motion CSS.
        renderer.domElement.style.removeProperty('display')
        renderer.domElement.setAttribute('aria-hidden', 'true')
        document.body.append(renderer.domElement)
      }
      renderer.domElement.hidden = false
      if (
        renderer.domElement.clientWidth !== w ||
        renderer.domElement.width !== Math.floor(w * renderer.getPixelRatio()) ||
        renderer.domElement.height !== Math.floor(h * renderer.getPixelRatio())
      )
        renderer.setSize(w, h, false)
      const action = signal.action,
        arc = Math.sin(Math.PI * t),
        ease = THREE.MathUtils.smootherstep(t, 0, 0.46) * (1 - THREE.MathUtils.smootherstep(t, 0.57, 1))
      let opacity = 1
      if (brush) {
        opacity = sweepPalm(hand, rig, signal.side, signal.u, signal.v, signal.width ?? .36, now - start)
      } else {
        const slide = action === 'sweep' ? 0.46 : action === 'rewind' ? -0.18 : 0.025
        rig.worldPoint(signal.side, signal.u + slide * (0.48 - t), signal.v, action === 'point' ? 0.009 : 0.016, location)
        rig.worldPoint('right', 1.45, 1.45, 0.046, entry)
        hand.rotation.set(-0.42 + 0.07 * arc,
          (signal.side === 'left' ? 0.83 : 0.46) + 0.16 * t,
          action === 'rewind' ? 0.44 * Math.sin(2 * Math.PI * t) : 0.08 * arc, 'YXZ')
        hand.position.lerpVectors(entry, location, ease).sub(tip.clone().multiply(hand.scale).applyQuaternion(hand.quaternion))
      }
      for (const mesh of meshes) {
        (mesh.material as THREE.MeshStandardMaterial).opacity = opacity
        mesh.morphTargetInfluences?.forEach((_, i, morphs) => {
          morphs[i] = brush
            ? poses[i] === 'stroke' ? 1 : 0
            : poses[i] === action ? arc : 0
        })
      }
      renderer.clear()
      renderer.render(scene, camera)
    },
    hide,
    dispose() {
      hide()
      renderer?.domElement.remove()
      renderer?.dispose()
      for (const m of meshes) {
        m.geometry.dispose()
        ;(m.material as THREE.Material).dispose()
      }
    },
  }
}
