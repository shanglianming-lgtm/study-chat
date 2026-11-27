import * as THREE from 'three'
import { drawSpineTitle } from './spineTitle'
import { paperStock } from './paperStock'
import type { BookPose } from './bookFlight'

function surfaces(root: THREE.Object3D) {
  const result = new Set<THREE.MeshStandardMaterial>()
  root.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return
    for (const m of Array.isArray(node.material) ? node.material : [node.material]) {
      if (m instanceof THREE.MeshStandardMaterial) result.add(m)
    }
  })
  return result
}

function paperGrain(anisotropy: number) {
  const sheet = paperStock()?.sheet
  if (!sheet) return null
  const map = new THREE.CanvasTexture(sheet)
  map.wrapS = map.wrapT = THREE.RepeatWrapping
  map.repeat.set(2.7, 4.1)
  map.colorSpace = THREE.SRGBColorSpace
  map.anisotropy = anisotropy
  return map
}

export function finishFolio(renderer: THREE.WebGLRenderer, scene: THREE.Scene, book: THREE.Group,
  wearer: THREE.Group, linen?: THREE.Texture) {
  // Capture the actual window and lamps once, before the wearer is added. The room lighting is static.
  let reflection: THREE.WebGLRenderTarget | undefined
  if (renderer.extensions.has('EXT_color_buffer_float')) {
    const probe = new THREE.PMREMGenerator(renderer)
    const visible = book.visible
    book.visible = false
    try {
      reflection = probe.fromScene(scene, 0, 0.12, 25, { size: 64, position: new THREE.Vector3(0.2, 1.4, 0.3) })
    } catch (error) {
      console.warn('Could not capture room reflections for the folio.', error)
    } finally {
      book.visible = visible
      probe.dispose()
    }
  }
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
  let ticket: THREE.Texture | null = null
  let ticketName: string | undefined
  let ticketInk: THREE.MeshStandardMaterial | undefined
  const grain = paperGrain(anisotropy)
  for (const m of surfaces(book)) {
    if (m.map) m.map.anisotropy = anisotropy
    if (m.normalMap) {
      m.normalMap.anisotropy = anisotropy
      m.normalScale.multiplyScalar(1.65)
    }
    if (reflection) { m.envMap = reflection.texture; m.envMapIntensity = 0.68 }
    if (m.name.includes('printed front')) {
      // The warm ink of the original cover catches light differently from the dyed linen.
      m.onBeforeCompile = shader => {
        if (linen) {
          shader.uniforms.studyLinen = { value: linen }
          shader.fragmentShader = 'uniform sampler2D studyLinen;\n' + shader.fragmentShader
        }
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
            float warmInk = smoothstep(0.008, 0.065, diffuseColor.r - diffuseColor.g)
                          * smoothstep(0.06, 0.20, diffuseColor.r - diffuseColor.b);
            ${linen ? `float yarn = dot(texture2D(studyLinen, vMapUv * vec2(0.76, 1.14)).rgb, vec3(0.21, 0.72, 0.07));
            diffuseColor.rgb *= mix(clamp(1.0 + 1.75 * (yarn - 0.39), 0.79, 1.21), 1.0, warmInk * 0.75);` : ''}
            roughnessFactor = mix(0.82, 0.36, warmInk);`)
          .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
            metalnessFactor = 0.48 * warmInk;`)
      }
      m.customProgramCacheKey = () => linen ? 'study-printed-linen' : 'study-printed-cover'
    } else if (m.name.includes('unprinted warm white') && grain) {
      m.map = grain
      m.bumpMap = grain
      m.bumpScale = 0.000055
      m.roughness = 0.94
      m.onBeforeCompile = shader => {
        shader.vertexShader = 'attribute float paperSky; varying float vPaperSky;\n' + shader.vertexShader.replace('#include <begin_vertex>',
          '#include <begin_vertex>\nvPaperSky = paperSky;')
        shader.fragmentShader = 'varying float vPaperSky;\n' + shader.fragmentShader.replace('#include <aomap_fragment>',
          '#include <aomap_fragment>\nreflectedLight.indirectDiffuse *= vPaperSky;')
      }
      m.customProgramCacheKey = () => 'folio-sky-visibility'
    } else if (m.name.includes('gathered signatures')) {
      // Larger folded gatherings are visible on the fore-edge; individual leaves resolve only up close.
      m.onBeforeCompile = shader => {
        shader.vertexShader = 'attribute float signatureDepth; varying vec3 paperEdge;\n' + shader.vertexShader.replace('#include <begin_vertex>',
          '#include <begin_vertex>\npaperEdge = vec3(position.x, signatureDepth, position.z);')
        shader.fragmentShader = 'varying vec3 paperEdge;\n' + shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
          float section = paperEdge.y / 0.00265 + 0.13 * sin(paperEdge.x * 85.0 + paperEdge.z * 62.0);
          float ridge = 0.5 + 0.5 * cos(6.283185 * section);
          float resolved = 1.0 - smoothstep(0.25, 0.95, fwidth(section));
          diffuseColor.rgb *= 1.04 - 0.25 * smoothstep(0.59, 0.96, ridge) * resolved;`)
      }
      m.customProgramCacheKey = () => 'folio-cut-gatherings'
      if (reflection) m.envMapIntensity = 0.98
    } else if (m.name.startsWith('Ticket')) {
      ticketInk = m
    } else if (m.name.startsWith('Ink')) {
      m.metalness = 0.42
      m.roughness = 0.39
    }
    m.needsUpdate = true
  }

  const center = { value: new THREE.Vector3() }, area = { value: 0 }
  for (const skin of surfaces(wearer)) {
    if (!skin.name.startsWith('Skin')) continue
    skin.emissiveIntensity = 0.22
    if (reflection) { skin.envMap = reflection.texture; skin.envMapIntensity = 0.30 }
    // The hovering cover blocks a small part of the sky seen by the palm.
    // Apply its solid angle to diffuse fill; direct light keeps its own shadows.
    skin.onBeforeCompile = shader => {
      shader.uniforms.studyCoverCenter = center
      shader.uniforms.studyCoverArea = area
      shader.fragmentShader = 'uniform vec3 studyCoverCenter;\nuniform float studyCoverArea;\n' + shader.fragmentShader
      shader.fragmentShader = shader.fragmentShader.replace('#include <aomap_fragment>', `#include <aomap_fragment>
        vec3 toCover = (viewMatrix * vec4(studyCoverCenter, 1.0)).xyz + vViewPosition;
        float d2 = max(dot(toCover, toCover), 0.00001);
        float facing = max(0.0, dot(normal, toCover * inversesqrt(d2)));
        reflectedLight.indirectDiffuse *= 1.0 - facing * studyCoverArea / (d2 + studyCoverArea);`)
    }
    skin.customProgramCacheKey = () => 'study-palm-occlusion'
    skin.needsUpdate = true
  }
  return {
    setTitle(name: string) {
      if (ticketName === name || !ticketInk) return
      const next = drawSpineTitle(name)
      if (!next) return
      next.flipY = false
      next.anisotropy = anisotropy
      ticket?.dispose()
      ticketInk.map = ticket = next
      ticketInk.needsUpdate = true
      ticketName = name
    },
    shadePalm(pose: BookPose, active: boolean) {
      center.value.copy(pose.center)
      area.value = active ? 0.012 * pose.scale * pose.scale : 0
    },
    dispose() { reflection?.dispose(); ticket?.dispose(); grain?.dispose() },
  }
}
