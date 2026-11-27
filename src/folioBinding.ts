import * as THREE from 'three'

const flatPaper = { height: 0, across: 0, lengthwise: 0 }

// One side of a gathering as it rolls away from the sewing. The fuller pile
// has a wider shoulder. Both leaves meet at the same height with separate tangents.
function fold(distance: number, z: number, thickness: number, halfGutter: number, cutHeight: number) {
  const width = halfGutter * (0.66 + 0.34 * thickness)
  if (distance >= width) return flatPaper
  const t = Math.max(0, distance / width), v = 1 - t
  const depth = 0.00225 + 0.00064 * z / cutHeight
  const shoulder = 0.00022 + 0.00068 * thickness
  return {
    height: -depth * v ** 3 + 16 * shoulder * t * t * v * v,
    across: (3 * depth * v * v + 32 * shoulder * t * v * (1 - 2 * t)) / width,
    lengthwise: -0.00064 * v ** 3 / cutHeight,
  }
}

// Fraction of a diffuse hemisphere visible above the opposite leaf. Window
// and desk lights still illuminate the paper through its ordinary material.
const horizonSamples = [0.025, 0.18, 0.45, 0.75, 1]
function visibleSky(distance: number, z: number, sign: number, slope: number, volume: number,
  surface: typeof flatPaper, halfGutter: number, cutHeight: number) {
  const tangent = -sign * slope - surface.across
  let horizon = tangent
  for (const step of horizonSamples) {
    const across = step * halfGutter
    const other = fold(across, z, 1 - volume, halfGutter, cutHeight)
    horizon = Math.max(horizon, (other.height - surface.height) / (distance + across) - sign * slope)
  }
  return (1 + Math.cos(Math.atan(horizon) - Math.atan(tangent))) / 2
}

// Only the two outside corners of a bound sheet have a rounded trim. The GLB
// also rounds the two corners beside its detachable gutter for the closed pose.
function straightTrim(x: number, z: number, radius: number, halfLength: number) {
  if (x >= radius || Math.abs(z) < halfLength - radius - 0.0001) return z
  const inset = radius - Math.sqrt(Math.max(0, radius * radius - (radius - x) ** 2))
  return z + Math.sign(z) * inset
}

// The original folio clip stretches each little gutter as the covers open. Reuse its
// cut faces and edge topology, and keep the original coordinates for closing the book.
export function createReadingBinding(book: THREE.Group, cutWidth: number, cutHeight: number, halfGutter: number, spineX: number) {
  const centre = book.localToWorld(new THREE.Vector3(spineX, 0, 0))
  const pages = (['L', 'R'] as const).map((side, index) => {
    const sign = index === 0 ? -1 : 1
    const stack = book.getObjectByName('PaperStack_' + side) as THREE.Mesh
    const face = book.getObjectByName('PageFace_' + side) as THREE.Mesh
    const anchor = book.getObjectByName('PageAnchor_' + side)!
    const gutter = book.getObjectByName('Gutter_' + side)!
    const restHeight = anchor.position.y, restRotation = anchor.quaternion.clone()
    const facePosition = face.geometry.getAttribute('position')
    let innerCorner = cutHeight / 2
    for (let i = 0; i < facePosition.count; i++) {
      if (Math.abs(facePosition.getX(i)) < 1e-7) innerCorner = Math.min(innerCorner, cutHeight / 2 - Math.abs(facePosition.getZ(i)))
    }
    const lining = book.getObjectByName(index === 0 ? 'Endsheet_Front' : 'Endsheet_Back') as THREE.Mesh
    const liningPos = lining.geometry.getAttribute('position')
    const liningRest = Array.from({ length: liningPos.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(liningPos, i))
    const innerX = Math.min(...liningRest.map(p => p.x)), endZ = Math.max(...liningRest.map(p => p.z))
    const cornerZ = Math.max(...liningRest.filter(p => Math.abs(p.x - innerX) < 1e-7).map(p => p.z))
    const toSpine = lining.worldToLocal(centre.clone()).x - innerX
    // The pastedown continues into the joint beneath the sewn gatherings.
    function lineJoint(blend: number) {
      liningRest.forEach(({ x, y, z }, i) => {
        const inside = 1 - THREE.MathUtils.smoothstep(x - innerX, 0, 0.016)
        liningPos.setXYZ(i, x + toSpine * blend * inside, y,
          THREE.MathUtils.lerp(z, straightTrim(x - innerX, z, endZ - cornerZ, endZ), blend))
      })
      liningPos.needsUpdate = true
      lining.geometry.computeBoundingBox()
      lining.geometry.computeBoundingSphere()
    }
    const meshes: THREE.Mesh[] = [stack, face]
    gutter.traverse(node => { if (node instanceof THREE.Mesh) meshes.push(node) })

    // The edge and the white side of each folded gathering share cross sections.
    const profile = new Map<number, number>()
    let gutterWidth = 0, gutterLength = 0
    for (const mesh of meshes.slice(2)) {
      const p = mesh.geometry.getAttribute('position')
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i)
        profile.set(x, Math.max(profile.get(x) ?? 0, p.getY(i)))
        gutterWidth = Math.max(gutterWidth, Math.abs(x))
        gutterLength = Math.max(gutterLength, Math.abs(p.getZ(i)) * 2)
      }
    }
    const gutterScale = gutter.scale.x
    const parts = meshes.map(mesh => {
      const folded = mesh !== stack && mesh !== face
      const paper = (mesh.material as THREE.Material).name.includes('unprinted')
      const geometry = mesh.geometry as THREE.BufferGeometry
      const position = geometry.getAttribute('position') as THREE.BufferAttribute
      const normal = geometry.getAttribute('normal') as THREE.BufferAttribute
      // GLTFLoader can supply interleaved attributes. Keep a packed, immutable rest copy.
      const rest = new Float32Array(position.count * 3), normals = new Float32Array(rest.length)
      const edgeDepth = paper ? null : new THREE.Float32BufferAttribute(new Float32Array(position.count), 1)
      const sky = paper ? new THREE.Float32BufferAttribute(new Float32Array(position.count).fill(1), 1) : null
      const uv = paper ? geometry.getAttribute('uv') : null
      const layers = new Float32Array(position.count)
      for (let i = 0; i < position.count; i++) {
        const x = position.getX(i), y = position.getY(i)
        rest.set([x, y, position.getZ(i)], i * 3)
        normals.set([normal.getX(i), normal.getY(i), normal.getZ(i)], i * 3)
        layers[i] = THREE.MathUtils.clamp(y / (folded ? profile.get(x)! : restHeight), 0, 1)
        edgeDepth?.setX(i, y)
        if (uv) {
          const distance = folded ? halfGutter * (1 - Math.abs(x) / gutterWidth) : halfGutter + Math.abs(x)
          uv.setXY(i, 0.5 + sign * distance / cutWidth, 0.5 + position.getZ(i) / (folded ? gutterLength : cutHeight))
        }
      }
      if (uv) uv.needsUpdate = true
      if (edgeDepth) geometry.setAttribute('signatureDepth', edgeDepth)
      if (sky) geometry.setAttribute('paperSky', sky)
      return { geometry, position, normal, rest, normals, layers, edgeDepth, sky, folded, paper }
    })
    return { sign, anchor, restHeight, restRotation, gutterWidth, gutterLength, gutterScale, innerCorner, lineJoint, parts }
  })
  const bands: { node: THREE.Object3D; z: number }[] = []
  book.traverse(node => { if (node.name.startsWith('Headband_')) bands.push({ node, z: node.position.z }) })
  const halfBlock = pages[0].restHeight
  const halfSpan = halfGutter + cutWidth
  const cloth = book.getObjectByName('Spine_Cloth') as THREE.Mesh
  cloth.geometry.computeBoundingBox()
  const clothBounds = cloth.geometry.boundingBox!, clothMid = (clothBounds.min.y + clothBounds.max.y) / 2
  const restClothY = cloth.position.y, clothSpan = clothBounds.max.y - clothBounds.min.y
  const zAxis = new THREE.Vector3(0, 0, 1), tilt = new THREE.Quaternion()
  let previousBlend = 0, previousSlope = 0, readFraction = 0.5
  return {
    get slope() { return previousSlope * previousBlend },
    foldHeight(left: boolean, distance: number, z: number) {
      return fold(distance, z, left ? readFraction : 1 - readFraction, halfGutter, cutHeight).height
    },
    update(fraction: number, opening: number) {
      const blend = THREE.MathUtils.smootherstep(opening, 0.62, 1)
      const leftHeight = THREE.MathUtils.lerp(0.00035, 2 * halfBlock - 0.00035, fraction)
      const slope = (halfBlock - leftHeight) / halfSpan
      if (blend === previousBlend && (blend === 0 || slope === previousSlope)) return
      if (blend !== previousBlend) {
        // The linen wraps under both boards, including their rounded inner corners.
        cloth.scale.y = 1 + blend * 0.009 / clothSpan
        cloth.position.y = restClothY + clothMid * (1 - cloth.scale.y)
        for (const page of pages) page.lineJoint(blend)
      }
      previousBlend = blend; previousSlope = slope; readFraction = fraction
      for (const page of pages) {
        const { sign, anchor, restHeight, restRotation, gutterWidth, gutterLength, gutterScale } = page
        const outsideHeight = halfBlock + sign * slope * halfSpan
        const volume = sign < 0 ? fraction : 1 - fraction
        // Incline the paper over its whole width. The fore-edge retains the actual
        // amount read while both sheets arrive at the sewing at the same height.
        anchor.position.y = restHeight + sign * slope * (halfGutter + cutWidth / 2) * blend
        const pitch = Math.atan(slope * blend)
        anchor.quaternion.copy(tilt.setFromAxisAngle(zAxis, pitch)).multiply(restRotation)
        anchor.scale.x = Math.hypot(1, slope * blend)
        for (const part of page.parts) {
          const { geometry, rest, normals, position, normal, layers, edgeDepth, sky, folded, paper } = part
          const xScale = folded ? THREE.MathUtils.lerp(1, halfGutter / (gutterWidth * gutterScale), blend) : 1
          const zScale = folded ? THREE.MathUtils.lerp(1, cutHeight / gutterLength, blend) : 1
          for (let i = 0; i < position.count; i++) {
            const k = 3 * i, x = rest[k], y = rest[k + 1]
            const t = folded ? Math.min(1, Math.abs(x) / gutterWidth) : 0
            const distance = folded ? halfGutter * (1 - t) : halfGutter + Math.abs(x)
            const z = rest[k + 2]
            const trim = folded ? z * zScale : THREE.MathUtils.lerp(z, straightTrim(Math.abs(x), z, page.innerCorner, cutHeight / 2), blend)
            const roll = folded ? fold(distance, trim, volume, halfGutter, cutHeight) : flatPaper
            const height = halfBlock + sign * slope * distance + roll.height
            position.setXYZ(i, x * xScale, THREE.MathUtils.lerp(y, layers[i] * height, blend), trim)
            if (paper) {
              const gradient = slope + sign * roll.across
              const start = -normals[k] / normals[k + 1]
              const local = THREE.MathUtils.lerp(start, gradient * (folded ? halfGutter / gutterWidth : 1), blend) / xScale
              const along = THREE.MathUtils.lerp(-normals[k + 2] / normals[k + 1], roll.lengthwise * zScale, blend)
              const length = Math.hypot(1, local, along)
              normal.setXYZ(i, -local / length, 1 / length, -along / length)
              if (folded && sky) sky.setX(i, THREE.MathUtils.lerp(1, visibleSky(distance, trim, sign, slope, volume, roll, halfGutter, cutHeight), blend))
            } else if (edgeDepth) {
              const edgeHeight = THREE.MathUtils.lerp(halfBlock, outsideHeight, THREE.MathUtils.smoothstep(distance, 0, 2 * halfGutter))
              edgeDepth.setX(i, THREE.MathUtils.lerp(y, layers[i] * edgeHeight, blend))
            }
            if (blend === 0) normal.setXYZ(i, normals[k], normals[k + 1], normals[k + 2])
          }
          position.needsUpdate = true
          if (!paper && blend > 0) geometry.computeVertexNormals()
          normal.needsUpdate = true
          if (edgeDepth) edgeDepth.needsUpdate = true
          if (folded && sky) sky.needsUpdate = true
          geometry.computeBoundingBox(); geometry.computeBoundingSphere()
        }
      }
      // The sewn headbands sit just behind the cut edge of an open text block.
      for (const { node, z } of bands) node.position.z = z - Math.sign(z) * 0.0027 * blend
    },
  }
}
