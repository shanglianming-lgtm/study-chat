import * as THREE from 'three'

// Crop the drawing surface, not the hand. A viewport-sized transparent WebGL
// layer (especially with CSS filters) is costly in software compositors even
// when its backing buffer has a low pixel ratio.
export function handViewport(bounds: THREE.Box3, world: THREE.Matrix4, camera: THREE.Camera, width: number, height: number) {
  const project = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(world)
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
  for (const x of [bounds.min.x, bounds.max.x])
    for (const y of [bounds.min.y, bounds.max.y])
      for (const z of [bounds.min.z, bounds.max.z]) {
        const p = new THREE.Vector4(x, y, z, 1).applyMatrix4(project)
        // A box crossing the near plane needs real clipping; retain the full
        // view for that rare entry/exit pose instead of cropping visible skin.
        if (p.w <= 0 || p.z < -p.w) return { x: 0, y: 0, width, height }
        const px = (p.x / p.w + 1) * width / 2, py = (1 - p.y / p.w) * height / 2
        left = Math.min(left, px); right = Math.max(right, px)
        top = Math.min(top, py); bottom = Math.max(bottom, py)
      }
  if (right <= 0 || bottom <= 0 || left >= width || top >= height) return null
  // Quantization avoids reallocating the canvas by single pixels each frame.
  left = Math.max(0, Math.floor((left - 8) / 32) * 32)
  top = Math.max(0, Math.floor((top - 8) / 32) * 32)
  right = Math.min(width, Math.ceil((right + 8) / 32) * 32)
  bottom = Math.min(height, Math.ceil((bottom + 8) / 32) * 32)
  return { x: left, y: top, width: right - left, height: bottom - top }
}
