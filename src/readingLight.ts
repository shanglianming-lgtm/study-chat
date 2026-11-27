import * as THREE from 'three'
import type { DeskReading, PageSide } from './deskReading'

/** A real, light-only 3D pass on the existing leaf's world plane. The room is
 * static during writing: relighting its 84 draws for one moving point source
 * stalls software GPUs. Composite this small irradiance pass below the ink,
 * with the SAME physical leaf's projective matrix. It lives outside the CSS
 * paper's isolated stack so additive blending reaches the actual room. */
export function readingLight(software: boolean) {
  const scene = new THREE.Scene()
  const light = new THREE.PointLight(0xffaa33, 2, 3)
  const geometry = new THREE.PlaneGeometry(1, 1)
  // Incremental diffuse irradiance over an already-lit paper photograph.
  // Keep the prescribed source intensity; expose only its small contribution.
  const material = new THREE.MeshLambertMaterial({
    color: new THREE.Color(.003, .003, .003),
    transparent: true, opacity: .08, blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  const leaf = new THREE.Mesh(geometry, material)
  scene.add(leaf, light)
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .01, 3)
  const center = new THREE.Vector3(), origin = new THREE.Vector3()
  const right = new THREE.Vector3(), up = new THREE.Vector3(), normal = new THREE.Vector3()
  const basis = new THREE.Matrix4()
  let renderer: THREE.WebGLRenderer | undefined, unavailable = false
  let width = 0, height = 0
  const hide = () => { if (renderer) renderer.domElement.hidden = true }
  return {
    draw(paper: HTMLElement, side: PageSide, palm: THREE.Vector3, rig: DeskReading) {
      if (unavailable) return
      if (!paper.isConnected || matchMedia('(prefers-reduced-motion: reduce)').matches) { hide(); return }
      if (!renderer) {
        try {
          renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, powerPreference: 'low-power' })
        } catch { unavailable = true; return }
        renderer.setPixelRatio(software ? .35 : Math.min(devicePixelRatio || 1, 1))
        renderer.domElement.className = 'spatial-light-canvas'
        renderer.domElement.setAttribute('aria-hidden', 'true')
        document.body.append(renderer.domElement)
      }
      const canvas = renderer.domElement
      const projection = paper.closest<HTMLElement>('.desk-surface')?.style.getPropertyValue('--desk-' + side)
      if (!projection) { hide(); return }
      canvas.style.transform = projection
      const w = paper.offsetWidth, h = paper.offsetHeight
      if (!w || !h) { hide(); return }
      if (w !== width || h !== height) { renderer.setSize(w, h); width = w; height = h }
      rig.worldPoint(side, 0, 1, 0, origin)
      rig.worldPoint(side, 1, 1, 0, right).sub(origin)
      rig.worldPoint(side, 0, 0, 0, up).sub(origin)
      const paperWidth = right.length(), paperHeight = up.length()
      right.normalize(); up.normalize()
      normal.crossVectors(right, up).normalize()
      rig.worldPoint(side, .5, .5, 0, center)
      leaf.position.copy(center)
      leaf.quaternion.setFromRotationMatrix(basis.makeBasis(right, up, normal))
      leaf.scale.set(paperWidth, paperHeight, 1)
      light.position.copy(palm).addScaledVector(normal, -.01)
      camera.position.copy(center).add(normal)
      camera.up.copy(up)
      camera.lookAt(center)
      camera.left = -paperWidth / 2; camera.right = paperWidth / 2
      camera.top = paperHeight / 2; camera.bottom = -paperHeight / 2
      camera.updateProjectionMatrix()
      canvas.hidden = false
      renderer.render(scene, camera)
    },
    hide,
    dispose() {
      renderer?.domElement.remove()
      renderer?.dispose()
      renderer?.forceContextLoss()
      geometry.dispose()
      material.dispose()
    },
  }
}
