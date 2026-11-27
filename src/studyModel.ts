import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { batchStudy, cushionGeometry, roundedLoop, surfaceGeometry } from './studyGeometry'
import { loadStudyAssets } from './studyAssets'
import { furnishStudy } from './studyFurnishings'
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js'

type Point = [number, number, number]
/** Entirely local geometry/textures. Coordinates are meters, Y is up. */
export function buildStudy(software = false) {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#d7c8ae')
  scene.fog = new THREE.Fog('#dfd0b5', 12, 25)
  const textures: THREE.Texture[] = []
  let oak: THREE.Texture, weave: THREE.Texture, plaster: THREE.Texture, paper: THREE.Texture
  const woods = new Set(['#ba8e5c', '#977147', '#c49b65', '#9d784e', '#b58e55', '#b79764', '#9f754b', '#7b593c'])
  const fabrics = new Set(['#777f52', '#7f875a', '#7e8657', '#93996a', '#ddd0ac', '#aa7254', '#d5c2a0', '#dfcdb0', '#cbb795', '#d1bea0', '#cab999', '#b48263'])
  const walls = new Set(['#e7d6be', '#e5d2b7', '#e9dac3', '#dfccb0', '#e9dfcc'])
  const materials = new Map<string, THREE.MeshStandardMaterial>()
  const mat = (color: string) => {
    if (!materials.has(color)) {
      const map = color === '#efe5cb' ? paper : woods.has(color) ? oak : fabrics.has(color) ? weave : walls.has(color) ? plaster : undefined
      const brass = ['#9b814f', '#a68a50', '#a68a52', '#96805c', '#9d7d4b'].includes(color)
      // Keep grain/weave without costly screen-space bump derivatives.
      const tint = woods.has(color) ? (color === '#7b593c' ? '#ac9984' : color === '#977147' ? '#c5b49d' : '#fff8eb') : walls.has(color) ? '#efede6' : color
      const material = new THREE.MeshStandardMaterial({ color: tint, ...(map ? { map } : {}), roughness: brass ? .38 : woods.has(color) ? .65 : .95, metalness: brass ? .5 : 0 })
      material.name = color; materials.set(color, material)
    }
    return materials.get(color)!
  }
  const mesh = (geometry: THREE.BufferGeometry, color: string, p: Point, parent: THREE.Object3D = scene) => {
    const m = new THREE.Mesh(geometry, mat(color)); m.position.set(...p); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m
  }
  const box = (s: Point, p: Point, c: string, parent: THREE.Object3D = scene, round = 0) => {
    // Millimetre book bands/board edges are subpixel at the walking distance;
    // do not spend hundreds of triangles rounding each one on CPU backends.
    if (software && round < .009) round = 0
    return mesh(round ? new RoundedBoxGeometry(...s, software ? 1 : 2, round) : new THREE.BoxGeometry(...s), c, p, parent)
  }
  // Static corner occlusion is baked into room vertices, not a fullscreen pass.
  const roomOcclusion = (m: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>) => {
    m.updateMatrixWorld(true)
    const positions = m.geometry.getAttribute('position'), normals = m.geometry.getAttribute('normal'), colors = []
    const p = new THREE.Vector3(), n = new THREE.Vector3(), normalMatrix = new THREE.Matrix3().getNormalMatrix(m.matrixWorld)
    for (let i = 0; i < positions.count; i++) {
      p.fromBufferAttribute(positions, i).applyMatrix4(m.matrixWorld); n.fromBufferAttribute(normals, i).applyNormalMatrix(normalMatrix)
      const distances = [Math.abs(n.x) < .5 ? 4 - Math.abs(p.x) : 10, Math.abs(n.y) < .5 ? Math.min(p.y, 3.6 - p.y) : 10, Math.abs(n.z) < .5 ? 3.5 - Math.abs(p.z) : 10]
      const value = Math.max(.45, 1 - distances.reduce((a, d) => a + .26 * Math.exp(-Math.max(0, d) / .38), 0))
      colors.push(value, value, value)
    }
    m.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); m.material.vertexColors = true
    return m
  }
  const roomPanel = (s: Point, p: Point, c: string) => roomOcclusion(mesh(new THREE.BoxGeometry(...s, ...s.map(v => Math.max(1, Math.ceil(v * 5))) as Point), c, p))
  const cylinder = (r: number, r2: number, h: number, p: Point, c: string, parent: THREE.Object3D = scene) => mesh(new THREE.CylinderGeometry(r, r2, h, 20), c, p, parent)
  const ball = (p: Point, s: Point, c: string, parent: THREE.Object3D = scene) => { const m = mesh(new THREE.SphereGeometry(1, 12, 8), c, p, parent); m.scale.set(...s); return m }
  const soft = (s: Point, p: Point, c: string, parent: THREE.Object3D, puff = .025) => mesh(cushionGeometry(...s, puff), c, p, parent)
  const tube = (points: Point[], r: number, c: string, parent: THREE.Object3D = scene) => mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p))), Math.max(12, points.length * 6), r, 5, false), c, [0, 0, 0], parent)
  const piping = (w: number, h: number, r: number, p: Point, c: string, parent: THREE.Object3D, plane: 'xy' | 'xz' = 'xy') => mesh(new THREE.TubeGeometry(roundedLoop(w, h, r, plane), 56, .005, 5, true), c, p, parent)
  const turned = (profile: [number, number][], p: Point, c: string, parent: THREE.Object3D = scene, segments = 28) => mesh(new THREE.LatheGeometry(profile.map(v => new THREE.Vector2(...v)), segments), c, p, parent)
  const joint = (a: Point, b: Point, r1: number, r2: number, c: string, parent: THREE.Object3D = scene) => {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b), direction = end.clone().sub(start)
    const m = cylinder(r2, r1, direction.length(), start.clone().add(end).multiplyScalar(.5).toArray() as Point, c, parent)
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()); return m
  }
  const texture = (w: number, h: number, paint: (ctx: CanvasRenderingContext2D) => void) => {
    const image = document.createElement('canvas'); image.width = w; image.height = h
    const ctx = image.getContext('2d')!; paint(ctx)
    const map = new THREE.CanvasTexture(image); map.colorSpace = THREE.SRGBColorSpace; textures.push(map)
    return { map, repaint: () => { paint(ctx); map.needsUpdate = true } }
  }
  // Deterministic, local surface detail: no texture downloads or extra lights.
  const noise = (n: number) => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v) }
  oak = texture(512, 256, ctx => {
    ctx.fillStyle = '#f1e6d5'; ctx.fillRect(0, 0, 512, 256)
    for (let i = 0; i < 130; i++) { const y = i * 2; ctx.strokeStyle = `rgba(89,65,39,${.04 + noise(i) * .14})`; ctx.lineWidth = .4 + noise(i + 3); ctx.beginPath(); ctx.moveTo(0, y); ctx.bezierCurveTo(150, y + noise(i + 7) * 15, 350, y - noise(i + 9) * 18, 512, y + 3); ctx.stroke() }
  }).map
  weave = texture(256, 256, ctx => {
    ctx.fillStyle = '#f2efdf'; ctx.fillRect(0, 0, 256, 256)
    for (let i = 0; i < 256; i += 2) { ctx.fillStyle = i % 4 ? '#665d5112' : '#fffdf818'; ctx.fillRect(i, 0, 1, 256); ctx.fillRect(0, i, 256, 1) }
  }).map
  paper = texture(64, 512, ctx => {
    ctx.fillStyle = '#faf4df'; ctx.fillRect(0, 0, 64, 512)
    for (let y = 0; y < 512; y += 3) { ctx.fillStyle = y % 9 ? '#aa91602b' : '#8e784243'; ctx.fillRect(0, y, 64, .65) }
  }).map
  plaster = texture(128, 128, ctx => {
    ctx.fillStyle = '#fffdf8'; ctx.fillRect(0, 0, 128, 128)
    for (let i = 0; i < 3200; i++) { ctx.fillStyle = `rgba(115,99,74,${noise(i) * .025})`; ctx.fillRect(noise(i + 1) * 128, noise(i + 2) * 128, 1, 1) }
  }).map
  for (const map of [oak, weave, plaster]) { map.wrapS = map.wrapT = THREE.RepeatWrapping }
  const wood = '#ba8e5c', darkWood = '#977147', linen = '#dfcdb0'
  scene.add(new THREE.HemisphereLight('#edf2f3', '#d0c8b9', software ? .72 : .38))
  // Avoid LTC integration on CPU renderers; sun, lamps and baked grounding stay.
  if (!software) {
    RectAreaLightUniformsLib.init()
    const windowLight = new THREE.RectAreaLight('#f4f5ef', .9, 2.8, 2.05)
    windowLight.position.set(2.15, 2.05, -3.28); windowLight.lookAt(2.15, 2.05, 0); scene.add(windowLight)
  }
  const sun = new THREE.DirectionalLight('#fff7e5', 3.5); sun.position.set(4.5, 5.2, -7); sun.target.position.set(-.6, 0, .8); sun.castShadow = true
  sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: .5, far: 22 }); sun.shadow.normalBias = .015; sun.shadow.intensity = .85; scene.add(sun, sun.target)
  // Enclosed human-scale room, not an orbitable cutaway diorama.
  box([8.2, .18, 7.2], [0, -.12, 0], darkWood)
  const grain = texture(128, 512, ctx => {
    ctx.fillStyle = '#bf996f'; ctx.fillRect(0, 0, 128, 512)
    for (let i = 0; i < 65; i++) { ctx.strokeStyle = i % 3 ? '#a47c4b33' : '#e2c19955'; ctx.lineWidth = .5; ctx.beginPath(); ctx.moveTo(i * 2, 0); ctx.bezierCurveTo(i * 2 + 12, 160, i * 2 - 8, 340, i * 2 + 2, 512); ctx.stroke() }
  })
  const floorMat = new THREE.MeshStandardMaterial({ map: grain.map, roughness: .67 })
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 7, 40, 35), floorMat)
  floor.rotation.x = -Math.PI / 2; floor.position.y = .005; floor.receiveShadow = true; scene.add(floor); roomOcclusion(floor)
  // An actual opening lets window light enter; an opaque wall behind the sky
  // would shadow the whole interior and flatten all of the material detail.
  // Leave the supplied pierced wall's full bay open, including its window reveal.
  roomPanel([4.278, 3.6, .16], [-1.961, 1.8, -3.5], '#e7d6be')
  roomPanel([.178, 3.6, .16], [4.011, 1.8, -3.5], '#e7d6be')
  roomPanel([3.744, .50, .16], [2.05, 3.35, -3.5], '#e7d6be')
  roomPanel([.16, 3.6, 7.2], [-4, 1.8, 0], '#e5d2b7')
  roomPanel([.16, 3.6, 7.2], [4, 1.8, 0], '#e9dac3'); roomPanel([3.49, 3.6, .16], [-2.355, 1.8, 3.5], '#dfccb0')
  roomPanel([3.49, 3.6, .16], [2.355, 1.8, 3.5], '#dfccb0')
  roomPanel([1.22, 1.15, .16], [0, 3.025, 3.5], '#dfccb0')
  box([8, .12, .08], [0, .1, -3.38], '#bca17d'); box([.08, .12, 7], [-3.88, .1, 0], '#bca17d'); box([.08, .12, 7], [3.88, .1, 0], '#bca17d')
  roomPanel([8.1, .08, 7.1], [0, 3.62, 0], '#f0efeb')
  const rail = cylinder(.018, .018, 3.8, [2.1, 3.3, -3.14], '#96805c'); rail.rotation.z = Math.PI / 2
  for (const x of [.17, 4.01]) ball([x, 3.3, -3.14], [.048, .048, .048], '#96805c')
  const curtainMat = mat(linen); curtainMat.side = THREE.DoubleSide
  for (const [side, sign] of [[.57, -1], [3.65, 1]]) {
    // One continuous hanging cloth surface: gathered waist, pleats and hem.
    const drape = (u: number, v: number) => {
      const gather = Math.exp(-(((v - .59) / .13) ** 2))
      const width = .53 - .19 * gather
      return new THREE.Vector3(side + (u - .5) * width + sign * .07 * gather, 3.23 - v * 3.08 + Math.cos(u * Math.PI * 10) * .012 * v, -3.12 + Math.cos(u * Math.PI * 10 + v * .25) * (.045 - gather * .018) + Math.sin(v * Math.PI) * .018)
    }
    mesh(surfaceGeometry(44, 22, drape), linen, [0, 0, 0])
    for (const edge of [0, 1]) tube(Array.from({ length: 25 }, (_, i) => drape(edge, i / 24).toArray() as Point), .006, '#cbb795')
    tube(Array.from({ length: 45 }, (_, i) => drape(i / 44, .985).toArray() as Point), .008, '#cbb795')
    const tie = Array.from({ length: 21 }, (_, i) => { const p = drape(i / 20, .59); p.z += .017; return p.toArray() as Point })
    tube(tie, .015, '#a68a52')
    for (let i = 0; i < 6; i++) {
      const ring = mesh(new THREE.TorusGeometry(.027, .005, 5, 14), '#96805c', [side - .22 + i * .088, 3.29, -3.14]); ring.rotation.y = Math.PI / 2
      box([.022, .07, .018], [side - .22 + i * .088, 3.23, -3.12], linen, scene, .007)
    }
  }
  // Left: upholstered sage sofa, pillows, throw, side table, floor lamp, framed print.
  const sofa = new THREE.Group(); sofa.position.set(-3.28, 0, -.05); sofa.rotation.y = Math.PI / 2; scene.add(sofa)
  box([2.47, .15, .98], [0, .31, 0], darkWood, sofa, .055)
  soft([2.48, .27, 1.02], [0, .46, -.01], '#777f52', sofa)
  soft([2.5, .69, .22], [0, .94, -.43], '#7f875a', sofa)
  for (const sign of [-1, 1]) {
    const x = sign * 1.2
    soft([.27, .48, 1.13], [x, .73, .015], '#7e8657', sofa, .035)
    const armSeam = piping(1.02, .4, .15, [x + sign * .118, .73, .015], '#93996a', sofa)
    armSeam.rotation.y = Math.PI / 2
    for (const z of [-.36, .36]) {
      joint([x, .32, z], [x + sign * .035, .055, z + Math.sign(z) * .045], .055, .033, darkWood, sofa)
      cylinder(.035, .037, .025, [x + sign * .035, .048, z + Math.sign(z) * .045], '#9b814f', sofa)
    }
  }
  for (const x of [-.57, .57]) {
    soft([1.08, .205, .88], [x, .665, .045], '#93996a', sofa, .036)
    piping(1.045, .845, .12, [x, .727, .045], '#b4bb8c', sofa, 'xz')
    const back = new THREE.Group(); back.position.set(x, 1.005, -.35); back.rotation.x = -.12; sofa.add(back)
    soft([1.075, .57, .205], [0, 0, 0], '#7f875a', back, .035)
    piping(1.04, .54, .12, [0, 0, .012], '#a4ad7d', back)
  }
  for (const [x, z, color] of [[-.68, -.12, '#ddd0ac'], [.48, -.1, '#aa7254']] as const) {
    const pillow = new THREE.Group(); pillow.position.set(x, 1.035, z); pillow.rotation.set(-.19, x * .1, x > 0 ? -.16 : .17); sofa.add(pillow)
    soft([.51, .49, .17], [0, 0, 0], color, pillow, .04)
    piping(.48, .46, .115, [0, 0, 0], color === '#ddd0ac' ? '#b9aa89' : '#d09a7d', pillow)
    ball([0, 0, .116], [.018, .018, .006], color, pillow)
  }
  // A continuous blanket folds over the cushion edge instead of two slabs.
  const throwPoint = (u: number, v: number) => {
    const fall = Math.max(0, (v - .65) / .35)
    return new THREE.Vector3(.68 + (u - .5) * .49, .815 - fall * .48 + Math.sin(u * 5 * Math.PI + v) * .012, -.35 + Math.min(v, .65) * 1.35 + Math.sin(fall * Math.PI / 2) * .025)
  }
  mat('#d5c2a0').side = THREE.DoubleSide
  mesh(surfaceGeometry(18, 22, throwPoint), '#d5c2a0', [0, 0, 0], sofa)
  for (let i = 0; i < 13; i++) { const p = throwPoint(i / 12, 1); tube([p.toArray() as Point, [p.x + .008, p.y - .045, p.z + .005]], .003, '#c2ab83', sofa) }
  turned([[0, 0], [.31, 0], [.39, .015], [.4, .032], [.395, .055], [0, .055]], [-2.65, .535, 1.78], wood)
  turned([[.24, 0], [.27, .04], [.14, .12], [.085, .37], [.15, .51]], [-2.65, .025, 1.78], darkWood)
  cylinder(.095, .08, .15, [-2.72, .66, 1.78], '#e6d7b9'); box([.3, .045, .23], [-2.43, .61, 1.73], '#7d8865', scene, .008)
  turned([[0, 0], [.21, 0], [.25, .014], [.25, .035], [.22, .055], [.06, .07], [.033, .095]], [-3.3, .025, -1.85], '#9d7d4b')
  cylinder(.017, .02, 1.77, [-3.3, .99, -1.85], '#a68a52')
  for (const y of [.16, 1.65, 1.79]) turned([[.025, 0], [.035, .007], [.035, .025], [.025, .033]], [-3.3, y, -1.85], '#9b814f')
  const shade = turned([[.39, 0], [.396, .012], [.274, .475], [.263, .49], [.252, .49], [.262, .466], [.38, .012], [.39, 0]], [-3.3, 1.8, -1.85], '#efdeba', scene, 48)
  shade.material = new THREE.MeshStandardMaterial({ color: '#efdfbd', map: weave, roughness: .94, side: THREE.DoubleSide, emissive: '#ffda95', emissiveIntensity: .55 })
  materials.set('lamp-shade', shade.material)
  for (const [r, y] of [[.39, 1.81], [.263, 2.285]]) { const hem = mesh(new THREE.TorusGeometry(r, .008, 5, 48), '#d3ba8e', [-3.3, y, -1.85]); hem.rotation.x = Math.PI / 2 }
  tube([[-3.3, .045, -1.85], [-3.54, .025, -1.92], [-3.78, .025, -2.15], [-3.86, .12, -2.2]], .007, '#514c40')
  const glow = new THREE.PointLight('#ffe5b2', software ? 4 : 2.4, 0, 2); glow.position.set(-3.3, 1.94, -1.85); scene.add(glow)
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(.065, 12, 8), new THREE.MeshBasicMaterial({ color: '#ffedba' })); bulb.position.copy(glow.position); scene.add(bulb)
  box([.055, 1.15, 1.32], [-3.87, 2.15, -.05], '#b58e55', scene, .012); box([.04, 1.02, 1.19], [-3.835, 2.15, -.05], '#f0e6cd')
  const botanical = texture(256, 320, ctx => {
    ctx.fillStyle = '#eee5cf'; ctx.fillRect(0, 0, 256, 320)
    for (let stem = 0; stem < 3; stem++) {
      ctx.strokeStyle = '#788064'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(130, 282); ctx.quadraticCurveTo(86 + stem * 35, 170, 65 + stem * 60, 35); ctx.stroke()
      for (let i = 0; i < 8; i++) { const y = 60 + i * 25, x = 65 + stem * 60 + (130 - 65 - stem * 60) * i / 9; ctx.fillStyle = i % 2 ? '#899478' : '#a3a98a'; ctx.beginPath(); ctx.ellipse(x + (i % 2 ? 11 : -11), y, 20, 7, i % 2 ? -.6 : .6, 0, Math.PI * 2); ctx.fill() }
    }
    ctx.fillStyle = '#6d715c'; ctx.textAlign = 'center'; ctx.font = '13px serif'; ctx.fillText('HERBARIUM · 018', 128, 309)
  })
  const print = new THREE.Mesh(new THREE.PlaneGeometry(.78, .85), new THREE.MeshStandardMaterial({ map: botanical.map, roughness: .95 })); print.position.set(-3.81, 2.15, -.05); print.rotation.y = Math.PI / 2; scene.add(print)
  // Woven rugs and desk under the large window.
  const rug = (s: Point, p: Point, color: string, bodies: number[][], feet: number[][]) => {
    const detail = software ? 24 : 48
    const m = mesh(new THREE.BoxGeometry(...s, detail, 1, detail), color, p), positions = m.geometry.getAttribute('position'), colors = []
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i) + p[0], z = positions.getZ(i) + p[2]
      let value = 1
      for (const [cx, cz, rx, rz, strength] of bodies) value *= 1 - strength * Math.exp(-(((x - cx) / rx) ** 4 + ((z - cz) / rz) ** 4) * 1.5)
      for (const [cx, cz] of feet) value *= 1 - .65 * Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / .018)
      colors.push(value, value, value)
    }
    m.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); m.material.vertexColors = true
  }
  // Grounding is baked into the rug itself: it cannot disappear behind a
  // slightly raised fabric surface or depend on transparent-plane sorting.
  rug([2.55, .018, 3.4], [-2.28, .035, .12], '#cab999', [[-3.25, -.15, .66, 1.38, .55], [-2.65, 1.78, .4, .4, .45]], [[-2.82, -1.2], [-2.82, .92], [-2.65, 1.78]])
  rug([2.9, .018, 2.15], [2.18, .035, -1.94], '#b48263', [[2.17, -2.7, 1.35, .6, .42], [2.15, -1.55, .52, .5, .5]], [[.905, -2.275], [3.435, -2.275], [1.8, -1.87], [2.5, -1.87], [1.8, -1.23], [2.5, -1.23]])
  const lamp = new THREE.Group(); lamp.position.set(1.63, 1.008, -2.91); scene.add(lamp)
  turned([[0, 0], [.175, 0], [.203, .012], [.21, .033], [.19, .06], [.08, .073], [.04, .09]], [0, 0, 0], '#9b814f', lamp)
  tube([[0, .07, 0], [0, .25, 0], [-.05, .46, .015], [-.04, .57, .015]], .018, '#9b814f', lamp)
  tube([[-.26, .59, .015], [-.26, .51, -.035], [0, .49, -.035], [.22, .51, -.035], [.22, .59, .015]], .012, '#9b814f', lamp)
  const enamel = new THREE.MeshStandardMaterial({ color: '#547754', roughness: .28, metalness: .04, side: THREE.DoubleSide, emissive: '#a8c371', emissiveIntensity: .35 }); enamel.name = 'Illuminated green lamp hood'
  const hood = new THREE.Mesh(surfaceGeometry(12, 28, (u, v) => new THREE.Vector3((u - .5) * .5 - .02, .59 + Math.sin(v * Math.PI) * .135, .015 + Math.cos(v * Math.PI) * .14)), enamel); hood.castShadow = hood.receiveShadow = true; lamp.add(hood)
  for (const x of [-.27, .23]) {
    tube(Array.from({ length: 21 }, (_, i) => [x, .59 + Math.sin(i / 20 * Math.PI) * .135, .015 + Math.cos(i / 20 * Math.PI) * .14] as Point), .008, '#a68a50', lamp)
    ball([x, .6, .015], [.024, .024, .024], '#9b814f', lamp)
  }
  for (const z of [-.125, .155]) tube([[-.27, .59, z], [.23, .59, z]], .006, '#a68a50', lamp)
  const diffuser = mesh(new THREE.CylinderGeometry(.035, .035, .36, 16), '#efe5cb', [-.02, .588, .015], lamp); diffuser.rotation.z = Math.PI / 2
  const diffuserMaterial = new THREE.MeshStandardMaterial({ color: '#fff0cd', emissive: '#ffe2a0', emissiveIntensity: 1.6, roughness: .6 })
  diffuser.material = diffuserMaterial; materials.set('desk-lamp-diffuser', diffuserMaterial)
  tube([[.155, .59, .02], [.16, .47, .03], [.15, .37, .04]], .003, '#a68a50', lamp); ball([.15, .36, .04], [.012, .018, .012], '#9b814f', lamp)
  const deskLight = new THREE.PointLight('#ffe1a1', 2.2, 0, 2); deskLight.position.set(1.61, 1.58, -2.895); scene.add(deskLight)
  const deskBulb = bulb.clone(); deskBulb.position.copy(deskLight.position); scene.add(deskBulb)
  // Cheap soft contact shadows ground furniture without per-frame AO passes.
  const contact = texture(128, 128, ctx => { const g = ctx.createRadialGradient(64, 64, 5, 64, 64, 64); g.addColorStop(0, '#241e18b8'); g.addColorStop(.45, '#241e1870'); g.addColorStop(1, '#241e1800'); ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128) }).map
  for (const [x, z, w, d] of [[-3.1, 0, 1.9, 3.3], [2.16, -2.45, 3.3, 1.6], [2.15, -1.55, 1.15, 1.05], [-2.65, 1.78, 1.2, 1.2]]) {
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: contact, transparent: true, depthWrite: false })); shadow.rotation.x = -Math.PI / 2; shadow.position.set(x, .065, z); scene.add(shadow)
  }
  const furnishings = furnishStudy(scene)
  batchStudy(scene, furnishings.book, [sofa, furnishings.shelf])
  const assets = loadStudyAssets({ scene, sofa, floor: floorMat, software, wood: [...materials].filter(([c]) => woods.has(c)).map(([, m]) => m), fabric: [...materials].filter(([c]) => fabrics.has(c)).map(([, m]) => m), textures })
  return { scene, furnishings, get linen() { return assets.linen }, ready: Promise.all([assets.ready, furnishings.ready]), dispose: () => {
    furnishings.dispose()
    assets.dispose()
    scene.traverse(o => { if (o instanceof THREE.Mesh) { if (o instanceof THREE.InstancedMesh) o.dispose(); o.geometry.dispose(); (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose()) } }); textures.forEach(t => t.dispose()); sun.shadow.map?.dispose()
  } }
}
