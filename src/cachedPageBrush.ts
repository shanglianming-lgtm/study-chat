import * as THREE from 'three'
import { paperProjection, type DeskReading } from './deskReading'
import type { HandSignal } from './readingHand'
import { INK_SPELL } from './inkSpell'
import type { createPageBrush } from './pageBrush'

// Tangent projection is exact at the palm and avoids the expensive perspective
// raster path in CPU compositors. The hand stays almost parallel to the leaf;
// perspective depth is only approximated in this software-only cached layer.
export function palmAffine(matrix: THREE.Matrix4, x: number, y: number) {
  const e = matrix.elements, w = e[3] * x + e[7] * y + e[15]
  const px = (e[0] * x + e[4] * y + e[12]) / w, py = (e[1] * x + e[5] * y + e[13]) / w
  const a = (e[0] - px * e[3]) / w, b = (e[1] - py * e[3]) / w
  const c = (e[4] - px * e[7]) / w, d = (e[5] - py * e[7]) / w
  return [a, b, c, d, px - a * x - c * y, py - b * x - d * y]
}

// Software compositors repeatedly read back a changing WebGL canvas. The
// near-parallel, fixed-pose brush can instead reuse the same model's shaded
// palm, projected onto its local X/Z plane, and animate that cached layer.
// Hardware rendering and the articulated action gestures remain true 3D.
export function cachedPageBrush(renderer: THREE.WebGLRenderer, scene: THREE.Scene, hand: THREE.Group,
  meshes: THREE.Mesh[], bounds: THREE.Box3, palm: THREE.Vector3, sample: ReturnType<typeof createPageBrush>) {
  const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return
  const span = bounds.getSize(new THREE.Vector3()), density = Math.min(3200, 1536 / span.z)
  canvas.width = Math.max(1, Math.ceil(span.x * density))
  canvas.height = Math.max(1, Math.ceil(span.z * density))
  const camera = new THREE.OrthographicCamera(bounds.min.x, bounds.max.x, -bounds.min.z, -bounds.max.z, .01, 4)
  camera.position.set(0, 2, 0)
  camera.up.set(0, 0, -1)
  camera.lookAt(0, 0, 0)
  const scale = hand.scale.clone(), ratio = renderer.getPixelRatio()
  try {
    hand.scale.setScalar(1)
    for (const mesh of meshes) {
      (mesh.material as THREE.MeshStandardMaterial).opacity = 1
      mesh.morphTargetInfluences?.forEach((_, i, morphs) => { morphs[i] = i === 1 ? 1 : 0 })
    }
    renderer.setPixelRatio(1)
    renderer.setSize(canvas.width, canvas.height)
    renderer.render(scene, camera)
    ctx.drawImage(renderer.domElement, 0, 0)
  } finally {
    hand.scale.copy(scale)
    renderer.setPixelRatio(ratio)
  }
  // An immutable decoded image avoids Canvas2D's own GPU mailbox/readback on
  // software compositors. Decode during reader setup, not the first swipe.
  const bitmapWidth = canvas.width, bitmapHeight = canvas.height
  const layer = document.createElement('img')
  layer.src = canvas.toDataURL('image/png')
  void layer.decode().catch(() => {})
  layer.alt = ''
  layer.className = 'reading-hand reading-hand--cached'
  layer.setAttribute('aria-hidden', 'true')
  layer.draggable = false
  layer.hidden = true
  Object.assign(layer.style, { width: `${bitmapWidth}px`, height: `${bitmapHeight}px`, transformOrigin: '0 0', willChange: 'transform, opacity' })
  document.body.append(layer)
  const plane = new THREE.Matrix4().set(
    span.x / bitmapWidth, 0, 0, bounds.min.x,
    0, 0, 1, 0,
    0, span.z / bitmapHeight, 0, bounds.min.z,
    0, 0, 0, 1
  )
  let animation: Animation | undefined
  function hide() { animation?.cancel(); animation = undefined; layer.hidden = true }
  return {
    play(signal: HandSignal, rig: DeskReading, camera: THREE.PerspectiveCamera, width: number, height: number, elapsed: number) {
      hide()
      const frames: Keyframe[] = []
      for (let ms = 0; ms <= INK_SPELL.duration; ms += 40) {
        const opacity = sample(hand, rig, signal.side, signal.u, signal.v, signal.width ?? .36, ms)
        hand.updateMatrixWorld(true)
        const surface = new THREE.Matrix4().multiplyMatrices(hand.matrixWorld, plane)
        const matrix = paperProjection(camera, surface, width, height)
        const affine = palmAffine(matrix, (palm.x - bounds.min.x) * bitmapWidth / span.x, (palm.z - bounds.min.z) * bitmapHeight / span.z)
        frames.push({ offset: ms / INK_SPELL.duration, transform: `matrix(${affine.join(',')})`, opacity })
      }
      layer.hidden = false
      animation = layer.animate(frames, { duration: INK_SPELL.duration, fill: 'both' })
      animation.currentTime = Math.max(0, elapsed)
    },
    hide,
    dispose() { hide(); layer.remove() },
  }
}
