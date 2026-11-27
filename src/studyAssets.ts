import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js'

type AssetTargets = {
  scene: THREE.Scene
  sofa: THREE.Group
  floor: THREE.MeshStandardMaterial
  wood: THREE.MeshStandardMaterial[]
  fabric: THREE.MeshStandardMaterial[]
  textures: THREE.Texture[]
  software: boolean
}

/** Local, credited CC0 assets. Geometry stays available if any asset fails. */
export function loadStudyAssets(target: AssetTargets) {
  let disposed = false
  let linen: THREE.Texture | undefined
  const loader = new THREE.TextureLoader()
  const ownedMaterials = new Set<THREE.Material>()
  const map = async (path: string, color = false, repeat = 1) => {
    const texture = await loader.loadAsync(`/assets/materials/${path}.jpg`)
    if (disposed) { texture.dispose(); return null }
    texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.setScalar(repeat); texture.anisotropy = 4
    target.textures.push(texture); return texture
  }
  const surface = async (prefix: string, materials: THREE.MeshStandardMaterial[], strength: number, repeat = 1) => {
    const [color, normal, roughness] = await Promise.all([map(`${prefix}-color`, true, repeat), target.software ? null : map(`${prefix}-normal`, false, repeat), target.software ? null : map(`${prefix}-roughness`, false, repeat)])
    if (disposed || !color) return
    materials.forEach(material => {
      material.map = color; material.normalMap = normal; material.normalScale.setScalar(strength)
      material.roughnessMap = roughness; material.roughness = .95; material.needsUpdate = true
    })
    return color
  }
  const ready = Promise.allSettled([
    surface('oak', target.wood, .16),
    surface('floor', [target.floor], .22, 2.4),
    surface('linen', target.fabric, .24, 2).then(color => { linen = color }),
    target.software ? Promise.resolve() : new HDRLoader().loadAsync('/assets/lighting/garden.hdr').then(hdr => {
      if (disposed) { hdr.dispose(); return }
      hdr.mapping = THREE.EquirectangularReflectionMapping; target.textures.push(hdr)
      target.scene.environment = hdr; target.scene.environmentIntensity = .075
      target.scene.environmentRotation.y = -.2
    }),
    new GLTFLoader().loadAsync('/assets/sofa/Sofa_01.gltf').then(gltf => {
      const model = gltf.scene
      model.traverse(o => {
        if (!(o instanceof THREE.Mesh)) return
        o.castShadow = o.receiveShadow = true
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          ownedMaterials.add(m)
          if (m instanceof THREE.MeshStandardMaterial) { m.normalScale.setScalar(.65); m.envMapIntensity = .7 }
          for (const v of Object.values(m)) if (v instanceof THREE.Texture && !target.textures.includes(v)) {
            if (disposed) v.dispose(); else { v.anisotropy = 4; target.textures.push(v) }
          }
          // glTF defaults metallicFactor to 1, then masks it to zero in ORM.
          // Removing that map must not turn the fabric into unlit metal.
          if (target.software && m instanceof THREE.MeshStandardMaterial) { m.normalMap = null; m.roughnessMap = null; m.metalnessMap = null; m.metalness = 0; m.roughness = .9 }
        }
      })
      if (disposed) { model.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose() }); ownedMaterials.forEach(m => m.dispose()); return }
      const bounds = new THREE.Box3().setFromObject(model), size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3())
      // Preserve the navigation footprint, with the scanned sofa resting on the floor.
      model.scale.set(2.5 / size.x, 1.15 / size.y, 1.04 / size.z)
      model.position.set(-center.x * model.scale.x, -bounds.min.y * model.scale.y + .035, -center.z * model.scale.z)
      target.sofa.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose() }); target.sofa.clear(); target.sofa.add(model)
    }),
  ]).then(results => {
    if (!disposed) for (const result of results) if (result.status === 'rejected') console.warn('A local study asset could not load; procedural fallback retained.', result.reason)
  })
  return { ready, get linen() { return linen }, dispose: () => { disposed = true; ownedMaterials.forEach(m => m.dispose()) } }
}
