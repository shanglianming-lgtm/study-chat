import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'

const width = 1.22, thresholdZ = 3.5

/** True when the standing player's footprint clears the slab and its handle. */
export function doorClearsPerson(angle: number, x: number, z: number) {
  const dx = x + width / 2, dz = z - thresholdZ
  const ux = Math.cos(angle), uz = -Math.sin(angle)
  const along = THREE.MathUtils.clamp(dx * ux + dz * uz, 0, width)
  return Math.hypot(dx - along * ux, dz - along * uz) > .25
}

export const doorSwing = 1.69
export const closingSeconds = 1.02
export function closingAngle(progress: number) {
  // The closer catches the weight of the panel just before it meets the jamb.
  const t = THREE.MathUtils.clamp(progress, 0, 1)
  return doorSwing * (1 - THREE.MathUtils.smootherstep(t, 0, 1))
}

/** The landing and the study share a threshold at z=3.5. The door swings into the room. */
export function makeStudyDoor(scene: THREE.Scene, onTextureReady: () => void) {
  const hall = new THREE.Group(),
    leaf = new THREE.Group()
  hall.position.z = thresholdZ
  hall.add(leaf)
  scene.add(hall)
  const height = 2.45
  leaf.position.x = -width / 2
  const color = (tint: string, metalness = 0, roughness = 0.7) =>
    new THREE.MeshStandardMaterial({ color: tint, metalness, roughness })
  const green = color('#90aa9b'),
    inset = color('#8da390'),
    mould = color('#acb9a6'),
    trim = color('#cbbd9e')
  const brass = color('#ceb079', 0.55, 0.34),
    darkBrass = color('#857047', 0.4),
    wall = color('#dfd2b8')
  const wainscot = color('#8b8d79'),
    bead = color('#a4a48e'),
    stone = color('#bbab92'),
    joint = color('#90816f')
  let disposed = false
  const grain = new THREE.TextureLoader().load('/assets/materials/oak-color.jpg', () => {
    if (!disposed) onTextureReady()
  })
  grain.colorSpace = THREE.SRGBColorSpace
  grain.wrapS = grain.wrapT = THREE.RepeatWrapping
  grain.repeat.set(0.9, 1.5)
  for (const m of [green, inset, mould]) {
    m.map = grain
    m.emissive.set('#28322c')
    m.emissiveIntensity = 0.7
  }
  const block = (
    parent: THREE.Object3D,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    material: THREE.Material,
    radius = 0
  ) => {
    const mesh = new THREE.Mesh(
      radius ? new RoundedBoxGeometry(w, h, d, 2, radius) : new THREE.BoxGeometry(w, h, d),
      material
    )
    mesh.position.set(x, y, z)
    mesh.castShadow = mesh.receiveShadow = true
    parent.add(mesh)
    return mesh
  }
  // Outside reveals, plaster, painted dado and skirting are real geometry as the camera passes them.
  for (const sign of [-1, 1]) {
    const center = sign * (2.1 + width / 2)
    block(hall, center, 1.79, 0.08, 4.2, 3.58, 0.1, wall)
    block(hall, center, 0.48, 0.148, 4.2, 0.96, 0.07, wainscot)
    for (let n = 0; n < 7; n++) block(hall, sign * (0.8 + n * 0.64), 0.46, 0.192, 0.038, 0.86, 0.022, bead)
    block(hall, center, 0.96, 0.171, 4.2, 0.065, 0.095, bead, 0.009)
    block(hall, center, 0.07, 0.194, 4.2, 0.14, 0.1, bead, 0.008)
    block(hall, sign * (width / 2 + 0.053), height / 2, 0.04, 0.105, height + 0.08, 0.215, trim, 0.008)
    block(hall, sign * (width / 2 + 0.092), height / 2, 0.156, 0.03, height + 0.15, 0.048, trim, 0.006)
  }
  block(hall, 0, 3.03, 0.07, 1.44, 1.13, 0.12, wall)
  block(hall, 0, height + 0.055, 0.045, 1.43, 0.11, 0.22, trim, 0.014)
  block(hall, 0, height + 0.122, 0.132, 1.51, 0.042, 0.12, trim, 0.008)
  block(hall, 0, 0.014, 0.055, width, 0.028, 0.27, darkBrass, 0.005)
  block(hall, 0, -0.065, 2.02, 10, 0.12, 4.2, stone)
  for (let i = -5; i <= 5; i++) block(hall, i * 0.62, -0.002, 2, 0.004, 0.003, 4, joint)
  for (let i = 0; i <= 6; i++) block(hall, 0, -0.002, i * 0.62, 10, 0.003, 0.004, joint)
  block(leaf, width / 2, height / 2, 0, width - 0.01, height - 0.015, 0.075, green, 0.008)
  function panel(x: number, y: number, w: number, h: number, face: number) {
    block(leaf, x, y, face * 0.043, w, h, 0.022, mould, 0.009)
    block(leaf, x, y, face * 0.054, w - 0.04, h - 0.04, 0.014, inset, 0.006)
    block(leaf, x, y, face * 0.063, w - 0.085, h - 0.085, 0.017, green, 0.012)
  }
  for (const face of [-1, 1]) {
    for (const x of [0.329, 0.891]) {
      panel(x, 1.7, 0.488, 1.17, face)
      panel(x, 0.584, 0.488, 0.77, face)
    }
    const plate = block(leaf, 1.063, 1.055, face * 0.066, 0.064, 0.22, 0.028, darkBrass, 0.013)
    const boss = new THREE.Mesh(new THREE.SphereGeometry(0.041, 16, 12), brass)
    boss.scale.set(1, 1, 0.83)
    boss.position.set(0, 0.018, face * 0.03)
    plate.add(boss)
    block(leaf, 1.004, 1.077, face * 0.13, 0.164, 0.031, 0.035, brass, 0.014)
  }
  const label = document.createElement('canvas')
  label.width = 640
  label.height = 248
  const ctx = label.getContext('2d')!
  ctx.fillStyle = '#35473e'
  ctx.fillRect(0, 0, 640, 248)
  ctx.strokeStyle = '#cbb789'
  ctx.lineWidth = 4
  ctx.strokeRect(10, 10, 620, 228)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = '104px "SimSun", "Noto Serif SC", serif'
  ctx.fillStyle = '#eee1be'
  ctx.fillText('书 房', 320, 127)
  const signTexture = new THREE.CanvasTexture(label)
  signTexture.colorSpace = THREE.SRGBColorSpace
  block(leaf, width / 2, 1.77, 0.085, 0.373, 0.15, 0.03, darkBrass, 0.013)
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(0.356, 0.138),
    new THREE.MeshStandardMaterial({ map: signTexture, roughness: 0.66 })
  )
  sign.position.set(width / 2, 1.77, 0.102)
  leaf.add(sign)

  const milk = new THREE.MeshStandardMaterial({
    color: '#fff0cd',
    emissive: '#ffc77b',
    emissiveIntensity: 0.8,
    roughness: 0.55,
  })
  for (const x of [-1.28, 1.28]) {
    block(hall, x, 1.81, 0.16, 0.095, 0.2, 0.09, darkBrass, 0.02)
    block(hall, x, 1.81, 0.233, 0.038, 0.038, 0.17, brass, 0.008)
    const globe = new THREE.Mesh(new THREE.SphereGeometry(0.112, 24, 16), milk)
    globe.scale.set(1, 1.22, 1)
    globe.position.set(x, 1.92, 0.31)
    hall.add(globe)
    const lamp = new THREE.PointLight('#ffdfaf', 1.7, 4)
    lamp.position.set(x, 1.92, 0.43)
    hall.add(lamp)
  }
  const fill = new THREE.PointLight('#fff2d9', 12, 8)
  fill.position.set(-0.4, 2.72, 2.4)
  hall.add(fill)
  return {
    leaf,
    dispose() {
      disposed = true
      grain.dispose()
      signTexture.dispose()
      const materials = new Set<THREE.Material>()
      hall.traverse((n) => {
        if (n instanceof THREE.Mesh) {
          n.geometry.dispose()
          materials.add(n.material)
        }
      })
      materials.forEach((m) => m.dispose())
      hall.removeFromParent()
    },
  }
}
