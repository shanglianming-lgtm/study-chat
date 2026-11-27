import * as THREE from 'three'
import type { HandAction } from './Correspondence'
import type { DeskReading, PageSide } from './deskReading'
import { INK_SPELL } from './inkSpell'
import { createPageBrush } from './pageBrush'
import { handViewport } from './handViewport'

export type HandSignal = { action: HandAction; side: PageSide; u: number; v: number; width?: number; seq: number }
export function readingHand(avatar: THREE.Group, software = false) {
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
    knuckles = digits.map((d) => joint(d + '1').applyMatrix4(basis))
  const hand = new THREE.Group(),
    poses = ['point', 'stroke', 'pinch', 'rewind', 'sweep'] as const
  hand.scale.setScalar(.76) // Keep the character branch's page-hand framing.
  const meshes: THREE.Mesh[] = []
  const bounds = new THREE.Box3(), relaxedBounds = new THREE.Box3(), fingerBounds = new THREE.Box3()
  const cropCamera = new THREE.PerspectiveCamera()
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
    const kept = new Map<number, { pos: THREE.Vector3; normal: THREE.Vector3; digit: number }>()
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
      kept.set(i, { pos, normal, digit: digits.findIndex((d) => name.includes(d)) })
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
    geo.morphAttributes.position = poses.map(
      (p) =>
        new THREE.Float32BufferAttribute(
          ids.flatMap((i) => {
            const { pos, digit } = kept.get(i)!,
              point = pos.clone()
            if (digit >= 0) {
              const pivot = knuckles[digit],
                angle =
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
              point.sub(pivot).applyAxisAngle(new THREE.Vector3(1, 0, 0), -angle)
              if (digit === 0 && p === 'pinch') point.applyAxisAngle(new THREE.Vector3(0, 1, 0), -0.35)
              if (digit > 0 && p === 'stroke')
                point.applyAxisAngle(new THREE.Vector3(0, 0, 1), (digit - 2.5) * .055)
              point.add(pivot)
            }
            return point.toArray()
          }),
          3
        )
    )
    const mat = new THREE.MeshStandardMaterial({
      map: obj.material.map,
      color: obj.material.color,
      roughness: 0.83,
      side: THREE.DoubleSide,
      transparent: true,
      forceSinglePass: true,
    })
    geo.computeBoundingBox() // Includes every absolute morph target.
    bounds.union(geo.boundingBox!)
    relaxedBounds.union(new THREE.Box3().setFromBufferAttribute(
      geo.morphAttributes.position[poses.indexOf('stroke')] as THREE.BufferAttribute))
    const relaxed = geo.morphAttributes.position[poses.indexOf('stroke')] as THREE.BufferAttribute
    for (let i = 0; i < ids.length; i++)
      if (kept.get(ids[i])!.digit >= 0)
        fingerBounds.expandByPoint(new THREE.Vector3().fromBufferAttribute(relaxed, i))
    const mesh = new THREE.Mesh(geo, mat)
    mesh.frustumCulled = false
    hand.add(mesh)
    meshes.push(mesh)
  })
  // Use the actual relaxed silhouette, not an extended index bone: no other
  // fingertip should jut farther inward over the printed text.
  const hoverTip = new THREE.Vector3(knuckles[2].x, 0, relaxedBounds.min.z)
  const hover = createPageBrush(hoverTip)
  // A bone on the rendered hand follows the same relaxed-finger deformation
  // as the mesh. Spatial ink reads its WORLD position, not a CSS clock/ratio.
  const inkTip = new THREE.Bone(), inkPalm = new THREE.Bone()
  inkTip.name = 'Reading_Index3_end'
  inkTip.position.copy(tip).sub(knuckles[1]).applyAxisAngle(new THREE.Vector3(1, 0, 0), -.13)
    .applyAxisAngle(new THREE.Vector3(0, 0, 1), -1.5 * .055).add(knuckles[1])
  inkPalm.position.copy(knuckles[1]).lerp(knuckles[4], .5).multiplyScalar(.58)
  inkPalm.position.y -= .008 // Warm emitter just below the palm.
  hand.add(inkTip, inkPalm)
  const inkOrigin = new THREE.Vector3(), inkRight = new THREE.Vector3(), inkDown = new THREE.Vector3()
  const inkNormal = new THREE.Vector3(), inkTarget = new THREE.Vector3(), inkOffset = new THREE.Vector3()
  const inkBasis = new THREE.Matrix4(), inkTurn = new THREE.Quaternion().setFromEuler(new THREE.Euler(.06, .28, -.04, 'YXZ'))
  const scene = new THREE.Scene()
  const reduced = matchMedia('(prefers-reduced-motion: reduce)')
  scene.add(hand, new THREE.HemisphereLight(0xfff3d9, 0x87725f, 1.85))
  const sun = new THREE.DirectionalLight(0xffecd1, 1.55)
  sun.position.set(-2, 3, -1)
  scene.add(sun)
  let renderer: THREE.WebGLRenderer | undefined,
    unavailable = false,
    lastPaint = 0,
    start = 0,
    signal: HandSignal | undefined,
    inking = false,
    inkOpacity = 1
  const location = new THREE.Vector3(),
    entry = new THREE.Vector3()
  function hide() {
    if (renderer) renderer.domElement.hidden = true
    signal = undefined
    inking = false
  }
  return {
    write(side: PageSide, u: number, v: number, alpha: number, rig: DeskReading) {
      inking = true
      inkOpacity = alpha
      signal = { action: 'stroke', side, u, v, seq: 0 }
      rig.worldPoint(side, 0, 0, 0, inkOrigin)
      rig.worldPoint(side, 1, 0, 0, inkRight).sub(inkOrigin).normalize()
      rig.worldPoint(side, 0, 1, 0, inkDown).sub(inkOrigin).normalize()
      inkNormal.crossVectors(inkDown, inkRight).normalize()
      hand.quaternion.setFromRotationMatrix(inkBasis.makeBasis(inkRight, inkNormal, inkDown)).multiply(inkTurn)
      rig.worldPoint(side, u, v, .022, inkTarget)
      hand.position.copy(inkTarget).sub(inkOffset.copy(inkTip.position).multiply(hand.scale).applyQuaternion(hand.quaternion))
      hand.updateMatrixWorld(true)
      return { tip: inkTip.getWorldPosition(new THREE.Vector3()), palm: inkPalm.getWorldPosition(new THREE.Vector3()) }
    },
    endInk() { if (inking) hide() },
    play(s: HandSignal, now: number) {
      if (meshes.length && !unavailable && !reduced.matches) {
        inking = false
        signal = s
        start = now
        lastPaint = 0
      }
    },
    draw(now: number, rig: DeskReading, camera: THREE.PerspectiveCamera, w: number, h: number) {
      if (reduced.matches) { hide(); return }
      if (!meshes.length || unavailable) return
      if (!renderer) {
        try {
          renderer = new THREE.WebGLRenderer({
            alpha: true,
            antialias: false,
            powerPreference: 'low-power',
            premultipliedAlpha: true,
          })
        } catch {
          unavailable = true
          signal = undefined
          return
        }
        renderer.toneMapping = THREE.ACESFilmicToneMapping
        // Skin is a soft decorative overlay. On the software renderer avoid
        // multisampling millions of translucent PBR pixels on every frame.
        renderer.setPixelRatio(Math.min(software ? .5 : .75, window.devicePixelRatio || 1))
        renderer.domElement.className = 'reading-hand'
        // Preserve the character branch's hidden/narrow/reduced-motion fix.
        renderer.domElement.style.removeProperty('display')
        renderer.domElement.setAttribute('aria-hidden', 'true')
        renderer.domElement.hidden = true
        document.body.append(renderer.domElement)
        renderer.setSize(32, 32)
        // Warm the shader/buffers when the reader opens, not on the click.
        // Otherwise first-paint compilation can eat the entire lateral pass.
        for (const mesh of meshes) (mesh.material as THREE.MeshStandardMaterial).opacity = 0
        renderer.render(scene, camera)
      }
      if (!signal) return
      const brush = signal.action === 'stroke'
      const t = inking ? 0 : (now - start) / (brush ? INK_SPELL.gesture : signal.action === 'sweep' ? 1000 : 850)
      if (t >= 1) {
        hide()
        return
      }
      // draw() already runs on requestAnimationFrame; do not skip 60Hz frames.
      // GPU identity can be masked. Adapt the optional overlay to measured
      // frame gaps too, rather than silently staying on an expensive path.
      const paintClock = performance.now()
      if (lastPaint && paintClock - lastPaint > 60 && renderer.getPixelRatio() > .35)
        renderer.setPixelRatio(Math.max(.35, renderer.getPixelRatio() * .6))
      lastPaint = paintClock
      const action = signal.action,
        arc = Math.sin(Math.PI * t),
        ease = THREE.MathUtils.smootherstep(t, 0, 0.46) * (1 - THREE.MathUtils.smootherstep(t, 0.57, 1))
      let opacity = 1
      if (brush) {
        opacity = inking ? inkOpacity : hover(hand, rig, signal.side, signal.v, now - start)
      } else {
        const slide = action === 'sweep' ? 0.46 : action === 'rewind' ? -0.18 : 0.025
        rig.worldPoint(signal.side, signal.u + slide * (0.48 - t), signal.v, action === 'point' ? 0.009 : 0.016, location)
        rig.worldPoint('right', 1.45, 1.45, 0.046, entry)
        hand.rotation.set(-0.42 + 0.07 * arc,
          (signal.side === 'left' ? 0.83 : 0.46) + 0.16 * t,
          action === 'rewind' ? 0.44 * Math.sin(2 * Math.PI * t) : 0.08 * arc, 'YXZ')
        hand.position.lerpVectors(entry, location, ease).sub(tip.clone().multiply(hand.scale).applyQuaternion(hand.quaternion))
      }
      if (opacity < .001) { renderer.domElement.hidden = true; return }
      for (const mesh of meshes) {
        (mesh.material as THREE.MeshStandardMaterial).opacity = opacity
        mesh.morphTargetInfluences?.forEach((_, i, morphs) => {
          morphs[i] = brush
            ? poses[i] === 'stroke' ? 1 : 0
            : poses[i] === action ? arc : 0
        })
      }
      hand.updateMatrixWorld(true)
      // A hovering cue shows only fingers at the outside edge. Bounds for the
      // full forearm and unrelated poses inflated this canvas to 512px high.
      const rect = handViewport(brush ? fingerBounds : bounds, hand.matrixWorld, camera, w, h)
      renderer.domElement.hidden = !rect
      if (!rect) return
      renderer.domElement.style.transform = `translate(${rect.x}px,${rect.y}px)`
      if (renderer.domElement.style.width !== `${rect.width}px` || renderer.domElement.style.height !== `${rect.height}px`)
        renderer.setSize(rect.width, rect.height)
      cropCamera.copy(camera)
      cropCamera.setViewOffset(w, h, rect.x, rect.y, rect.width, rect.height)
      renderer.clear()
      renderer.render(scene, cropCamera)
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
