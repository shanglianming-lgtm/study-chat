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
    transparent: true, opacity: .16, blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  const cropUV = { value: new THREE.Vector4(0, 0, 1, 1) }
  const normalSign = { value: 1 }
  material.onBeforeCompile = shader => {
    shader.uniforms.lightCrop = cropUV
    shader.uniforms.lightNormalSign = normalSign
    shader.vertexShader = 'varying vec2 vLightUV;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>', '#include <begin_vertex>\nvLightUV = uv;')
    shader.fragmentShader = 'varying vec2 vLightUV; uniform vec4 lightCrop; uniform float lightNormalSign;\n' + shader.fragmentShader
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal *= lightNormalSign;')
      .replace(
      '#include <opaque_fragment>', `
        // Retain actual PointLight irradiance, including its weak values.
        // Feather only the small sampled region, never threshold it to black.
        vec2 sampleUV = (vLightUV - lightCrop.xy) / lightCrop.zw;
        float edge = min(min(sampleUV.x, 1.0-sampleUV.x), min(sampleUV.y, 1.0-sampleUV.y));
        diffuseColor.a *= smoothstep(0.0, 0.22, edge);
        #include <opaque_fragment>`)
  }
  material.customProgramCacheKey = () => 'scoped-real-point-light-v2'
  const leaf = new THREE.Mesh(geometry, material)
  scene.add(leaf, light)
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .01, 3)
  const center = new THREE.Vector3(), origin = new THREE.Vector3()
  const right = new THREE.Vector3(), up = new THREE.Vector3(), normal = new THREE.Vector3()
  const palmUV = new THREE.Vector3(), emitterOffset = new THREE.Vector3()
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
      const w = paper.offsetWidth, h = paper.offsetHeight
      if (!w || !h) { hide(); return }
      rig.worldPoint(side, 0, 1, 0, origin)
      rig.worldPoint(side, 1, 1, 0, right).sub(origin)
      rig.worldPoint(side, 0, 0, 0, up).sub(origin)
      const paperWidth = right.length(), paperHeight = up.length()
      rig.pagePoint(side, palm, palmUV)
      // Scope the diffuse sampling around the actual emitter rather than
      // compositing another whole-leaf texture on software GPUs.
      const rx = .045 / paperWidth, ry = .045 / paperHeight
      const u0 = Math.max(0, palmUV.x - rx), u1 = Math.min(1, palmUV.x + rx)
      const v0 = Math.max(0, palmUV.y - ry), v1 = Math.min(1, palmUV.y + ry)
      if (u1 <= u0 || v1 <= v0) { hide(); return }
      cropUV.value.set(u0, 1 - v1, u1 - u0, v1 - v0)
      const cw = Math.ceil((u1 - u0) * w), ch = Math.ceil((v1 - v0) * h)
      if (cw !== width || ch !== height) { renderer.setSize(cw, ch); width = cw; height = ch }
      canvas.style.transform = projection + ` translate(${u0 * w}px, ${v0 * h}px)`
      right.normalize(); up.normalize()
      normal.crossVectors(right, up).normalize()
      rig.worldPoint(side, .5, .5, 0, center)
      leaf.position.copy(center)
      leaf.quaternion.setFromRotationMatrix(basis.makeBasis(right, up, normal))
      leaf.scale.set(paperWidth, paperHeight, 1)
      light.position.copy(palm).addScaledVector(normal, -.01)
      emitterOffset.copy(light.position).sub(center)
      // Thin paper can be exported with a mirrored anchor. Match its lit
      // face to the actual emitter without changing its world location.
      normalSign.value = Math.sign(emitterOffset.dot(normal)) || 1
      if (import.meta.env.DEV) canvas.dataset.lightHeight = String(emitterOffset.dot(normal))
      camera.position.copy(center).add(normal)
      camera.up.copy(up)
      camera.lookAt(center)
      camera.left = (u0 - .5) * paperWidth; camera.right = (u1 - .5) * paperWidth
      camera.top = (.5 - v0) * paperHeight; camera.bottom = (.5 - v1) * paperHeight
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
