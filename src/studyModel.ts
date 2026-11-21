import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { batchStudy, cushionGeometry, roundedLoop, surfaceGeometry } from './studyGeometry'

type Point = [number, number, number]
/** Entirely local geometry/textures. Coordinates are meters, Y is up. */
export function buildStudy() {
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
      const material = new THREE.MeshStandardMaterial({ color, ...(map ? { map } : {}), roughness: brass ? .32 : woods.has(color) ? .52 : .95, metalness: brass ? .45 : 0 })
      material.name = color; materials.set(color, material)
    }
    return materials.get(color)!
  }
  const mesh = (geometry: THREE.BufferGeometry, color: string, p: Point, parent: THREE.Object3D = scene) => {
    const m = new THREE.Mesh(geometry, mat(color)); m.position.set(...p); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m
  }
  const box = (s: Point, p: Point, c: string, parent: THREE.Object3D = scene, round = 0) => mesh(round ? new RoundedBoxGeometry(...s, 2, round) : new THREE.BoxGeometry(...s), c, p, parent)
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
    for (let i = 0; i < 3200; i++) { ctx.fillStyle = `rgba(115,99,74,${noise(i) * .08})`; ctx.fillRect(noise(i + 1) * 128, noise(i + 2) * 128, 1, 1) }
  }).map
  for (const map of [oak, weave, plaster]) { map.wrapS = map.wrapT = THREE.RepeatWrapping }
  const wood = '#ba8e5c', darkWood = '#977147', linen = '#dfcdb0'
  scene.add(new THREE.HemisphereLight('#dbe8ed', '#8a6241', .95))
  const sun = new THREE.DirectionalLight('#fff0cf', 3.7); sun.position.set(4.5, 5.2, -7); sun.target.position.set(-.6, 0, .8); sun.castShadow = true
  sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: .5, far: 22 }); sun.shadow.normalBias = .025; scene.add(sun, sun.target)
  // Enclosed human-scale room, not an orbitable cutaway diorama.
  box([8.2, .18, 7.2], [0, -.12, 0], darkWood)
  const grain = texture(128, 512, ctx => {
    ctx.fillStyle = '#bf996f'; ctx.fillRect(0, 0, 128, 512)
    for (let i = 0; i < 65; i++) { ctx.strokeStyle = i % 3 ? '#a47c4b33' : '#e2c19955'; ctx.lineWidth = .5; ctx.beginPath(); ctx.moveTo(i * 2, 0); ctx.bezierCurveTo(i * 2 + 12, 160, i * 2 - 8, 340, i * 2 + 2, 512); ctx.stroke() }
  })
  const floorMat = new THREE.MeshStandardMaterial({ map: grain.map, roughness: .67 })
  const floor = new THREE.InstancedMesh(new THREE.BoxGeometry(.328, .035, 2.31), floorMat, 72), floorMatrix = new THREE.Matrix4()
  let plank = 0
  for (let x = 0; x < 24; x++) for (let z = 0; z < 3; z++) {
    floor.setMatrixAt(plank++, floorMatrix.makeTranslation(-3.83 + x * .334, 0, -2.34 + z * 2.34))
  }
  floor.receiveShadow = true; scene.add(floor)
  // An actual opening lets window light enter; an opaque wall behind the sky
  // would shadow the whole interior and flatten all of the material detail.
  box([4.65, 3.6, .16], [-1.775, 1.8, -3.5], '#e7d6be')
  box([.45, 3.6, .16], [3.875, 1.8, -3.5], '#e7d6be')
  box([3.1, .9, .16], [2.1, .45, -3.5], '#e7d6be'); box([3.1, .45, .16], [2.1, 3.4, -3.5], '#e7d6be')
  box([.16, 3.6, 7.2], [-4, 1.8, 0], '#e5d2b7')
  box([.16, 3.6, 7.2], [4, 1.8, 0], '#e9dac3'); box([8.2, 3.6, .16], [0, 1.8, 3.5], '#dfccb0')
  box([8, .12, .08], [0, .1, -3.38], '#bca17d'); box([.08, .12, 7], [-3.88, .1, 0], '#bca17d'); box([.08, .12, 7], [3.88, .1, 0], '#bca17d')
  box([8.1, .08, 7.1], [0, 3.62, 0], '#e9dfcc')
  // Broad window, brass curtain rail and softly folded curtains.
  for (const x of [.61, 3.69]) box([.085, 2.32, .09], [x, 2.05, -3.34], darkWood, scene, .01)
  for (const y of [.91, 3.19]) box([3.16, .085, .09], [2.15, y, -3.34], darkWood, scene, .01)
  const sky = texture(256, 256, ctx => {
    const g = ctx.createLinearGradient(0, 0, 0, 256); g.addColorStop(0, '#a5c1cd'); g.addColorStop(1, '#e6dfc4'); ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256)
    for (let i = 0; i < 3; i++) { ctx.fillStyle = ['#a4b5a0', '#91a18b', '#7b947d'][i]; ctx.beginPath(); ctx.moveTo(0, 256); for (let x = 0; x <= 256; x += 8) ctx.lineTo(x, 208 + i * 12 + Math.sin(x / 65 + i * 2) * 17); ctx.lineTo(256, 256); ctx.fill() }
    for (let i = 0; i < 11; i++) { const x = 10 + i * 24, y = 165 + noise(i) * 45; ctx.fillStyle = i % 2 ? '#71856d' : '#879a7b'; ctx.beginPath(); ctx.ellipse(x, y, 24, 32, -.2, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#64725b'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, 252); ctx.lineTo(x + 3, y - 13); ctx.stroke() }
  })
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(2.88, 2.08), new THREE.MeshBasicMaterial({ map: sky.map })); glass.position.set(2.15, 2.05, -3.35); scene.add(glass)
  // The sill used to share the desk's exact y=.94 top over a .22m overlap.
  // Separate the surfaces so oblique views cannot produce stepped z-fighting.
  box([.055, 2.18, .065], [2.75, 2.05, -3.3], '#746a54'); box([3.3, .1, .28], [2.15, .96, -3.2], '#e1c7a1')
  box([3.03, .04, .07], [2.15, 2.02, -3.29], darkWood); box([.035, .14, .035], [2.79, 1.94, -3.23], '#9b814f')
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
  // Back wall: full oak bookcase, irregular clothbound books and baskets.
  const shelfX = -1.16
  box([3.24, 2.98, .065], [shelfX, 1.53, -3.35], '#9d784e', scene, .014)
  // Face frame, bullnose shelves, stepped crown and recessed frame-panel doors.
  for (const x of [-2.82, -1.72, -.6, .49]) {
    box([.095, 3, .55], [x, 1.51, -3.08], wood, scene, .012)
    box([.12, 2.94, .065], [x, 1.53, -2.795], '#c49b65', scene, .018)
  }
  for (const y of [.08, .66, 1.27, 1.91, 2.53, 3.01]) {
    box([3.4, .065, .55], [shelfX, y, -3.08], wood, scene, .012)
    box([3.43, .045, .08], [shelfX, y - .005, -2.785], '#c49b65', scene, .018)
  }
  box([3.52, .09, .68], [shelfX, 3.07, -3.07], darkWood, scene, .025)
  box([3.44, .055, .63], [shelfX, 3.135, -3.07], wood, scene, .018)
  box([3.55, .04, .7], [shelfX, 3.18, -3.07], '#c49b65', scene, .015)
  box([3.5, .11, .65], [shelfX, .075, -3.07], darkWood, scene, .018)
  const colors = ['#6b7854', '#bba67c', '#9e7055', '#4b635b', '#c8bda0', '#7b694d', '#6d5860', '#8a8d70']
  const bookLabels = texture(1024, 512, ctx => {
    ctx.clearRect(0, 0, 1024, 512)
    const titles = ['山间来信', '草木记', '慢读时光', '夏日漫游', '窗边手记', '日常之诗', '远方的风', '一日一页']
    titles.forEach((title, n) => {
      const x = n * 128; ctx.fillStyle = colors[n]; ctx.fillRect(x, 0, 128, 512)
      ctx.strokeStyle = '#d3bf8b'; ctx.lineWidth = 2; ctx.strokeRect(x + 19, 65, 90, 365)
      ctx.fillStyle = '#e8dbb9'; ctx.textAlign = 'center'; ctx.font = '32px "Noto Serif SC",serif'
      Array.from(title).forEach((c, i) => ctx.fillText(c, x + 64, 157 + i * 51))
      ctx.fillRect(x + 15, 35, 98, 5); ctx.fillRect(x + 15, 464, 98, 5)
      ctx.font = '18px serif'; ctx.fillText(`0${n + 1}`, x + 64, 409)
    })
  })
  const labelMat = new THREE.MeshStandardMaterial({ map: bookLabels.map, roughness: .88 }); labelMat.name = 'Clothbound spine atlas'
  const volume = (w: number, h: number, d: number, c: string, parent: THREE.Object3D) => {
    box([w - .017, h - .035, d - .036], [0, 0, -.008], '#efe5cb', parent)
    for (const x of [-w / 2, w / 2]) box([.011, h, d], [x, 0, 0], c, parent, .004)
    const spine = cylinder(w / 2, w / 2, h, [0, 0, d / 2 - .014], c, parent); spine.scale.z = .37
    for (const y of [-.39, -.31, .31, .39]) box([w * .87, .006, .008], [0, y * h, d / 2 + .009], '#b6a16c', parent, .002)
  }
  for (let row = 0; row < 4; row++) for (let col = 0; col < 3; col++) for (let i = 0; i < 4; i++) {
    if (row === 1 && col === 1 && i < 2) continue
    const n = (i + col * 3 + row * 2) % colors.length, h = .35 + ((i * 7 + row * 3 + col) % 5) * .035
    const w = .12 + noise(i + row * 10 + col) * .055, d = .30 + noise(i + col * 10) * .055
    const g = new THREE.Group(); g.position.set(-2.64 + col * 1.1 + i * .22, [.7, 1.31, 1.95, 2.57][row] + h / 2, -3.04 + noise(row + i) * .025)
    g.rotation.z = (noise(i + row + col * 3) - .5) * .1; scene.add(g); volume(w, h, d, colors[n], g)
    const geometry = surfaceGeometry(10, 1, (u, v) => {
      const x = (u - .5) * w * .86
      return new THREE.Vector3(x, (.5 - v) * h * .94, d / 2 - .014 + Math.sqrt(1 - (x / (w / 2)) ** 2) * w * .185 + .002)
    }), uv = geometry.getAttribute('uv')
    for (let v = 0; v < uv.count; v++) { uv.setX(v, (uv.getX(v) + n) / colors.length); uv.setY(v, 1 - uv.getY(v)) }
    g.add(new THREE.Mesh(geometry, labelMat))
  }
  for (const x of [-2.27, -1.16, -.05]) {
    box([1.0, .46, .035], [x, .355, -2.785], '#7b593c', scene, .01)
    box([.81, .285, .025], [x, .355, -2.765], '#b79764', scene, .014)
    for (const sign of [-1, 1]) {
      box([.085, .43, .055], [x + sign * .455, .355, -2.75], wood, scene, .009)
      box([.9, .075, .055], [x, .355 + sign * .183, -2.75], wood, scene, .009)
    }
    const pull = mesh(new THREE.TorusGeometry(.027, .006, 6, 16), '#9b814f', [x + .31, .37, -2.708]); pull.rotation.x = .22
    for (const y of [.22, .49]) cylinder(.013, .013, .04, [x - .465, y, -2.71], '#96805c').rotation.x = Math.PI / 2
  }
  for (let i = 0; i < 3; i++) {
    const g = new THREE.Group(); g.position.set(-.12, 2.61 + i * .075, -3.02); g.rotation.set(0, i * .08, Math.PI / 2); scene.add(g)
    volume(.06, .5 - i * .025, .36, colors[i], g)
  }
  const plant = (p: Point, scale = 1) => {
    const g = new THREE.Group(); g.position.set(...p); g.scale.setScalar(scale); scene.add(g)
    turned([[0, 0], [.105, 0], [.118, .025], [.16, .255], [.172, .263], [.172, .285], [.15, .29], [.145, .268], [.14, .23], [0, .23]], [0, 0, 0], '#b68c60', g)
    cylinder(.143, .143, .012, [0, .24, 0], '#524536', g)
    for (let i = 0; i < 12; i++) {
      const a = i * 2.4, height = .35 + i % 4 * .09
      const end: Point = [Math.cos(a) * .12, height, Math.sin(a) * .12]
      joint([0, .25, 0], end, .009, .004, '#62744b', g)
      const leaf = mesh(surfaceGeometry(6, 10, (u, v) => new THREE.Vector3((u - .5) * .18 * Math.sin(v * Math.PI) ** .7, v * .05 + Math.sin(v * Math.PI) * (.035 - Math.abs(u - .5) * .05), v * .27)), i % 2 ? '#708450' : '#8d9e66', end, g)
      leaf.rotation.set(-.4, a, .14); (leaf.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide
    }
    return g
  }
  // A low planter fits below the ceiling; vines have connected stems and leaves.
  turned([[0, 0], [.1, 0], [.12, .015], [.17, .12], [.17, .15], [.155, .16], [.145, .135], [.14, .115], [0, .115]], [-2.36, 3.2, -3.06], '#b68c60')
  cylinder(.14, .14, .01, [-2.36, 3.322, -3.06], '#524536')
  for (const branch of [0, 1]) {
    const x = -2.5 + branch * .22, count = branch ? 7 : 11
    const stem: Point[] = [[-2.36, 3.32, -3.06], [x, 3.31, -2.88], [x, 3.2, -2.735]]
    for (let i = 0; i < count; i++) {
      const anchor: Point = [x + Math.sin(i * .8) * .026, 3.17 - i * .103, -2.735]
      stem.push(anchor)
      const leaf = mesh(surfaceGeometry(8, 10, (u, v) => new THREE.Vector3((u - .5) * .145 * Math.sin(v * Math.PI) ** .7, -v * .19, Math.sin(v * Math.PI) * (.024 - Math.abs(u - .5) * .032))), i % 2 ? '#708450' : '#8d9e66', anchor)
      leaf.rotation.z = (i % 2 ? 1 : -1) * .68; leaf.rotation.y = Math.sin(i) * .3
    }
    tube(stem, .004, '#62744b')
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
  shade.material = new THREE.MeshStandardMaterial({ color: '#efdfbd', map: weave, roughness: .94, side: THREE.DoubleSide })
  for (const [r, y] of [[.39, 1.81], [.263, 2.285]]) { const hem = mesh(new THREE.TorusGeometry(r, .008, 5, 48), '#d3ba8e', [-3.3, y, -1.85]); hem.rotation.x = Math.PI / 2 }
  tube([[-3.3, .045, -1.85], [-3.54, .025, -1.92], [-3.78, .025, -2.15], [-3.86, .12, -2.2]], .007, '#514c40')
  const glow = new THREE.PointLight('#ffd695', 3, 4); glow.position.set(-3.3, 1.78, -1.85); scene.add(glow)
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
  box([2.55, .018, 3.4], [-2.28, .035, .12], '#cab999', scene, .04); box([2.9, .018, 2.15], [2.18, .035, -1.94], '#b48263', scene, .03)
  box([2.83, .105, 1.1], [2.17, .8875, -2.73], '#c49b65', scene, .036)
  box([2.76, .025, 1.05], [2.17, .825, -2.73], darkWood, scene, .012)
  box([2.57, .165, .055], [2.17, .733, -2.2], darkWood, scene, .015)
  for (const x of [1.52, 2.81]) {
    box([1.15, .145, .052], [x, .74, -2.16], '#7b593c', scene, .012)
    box([1.10, .127, .035], [x, .74, -2.123], wood, scene, .012)
    box([.91, .07, .012], [x, .74, -2.1], '#c49b65', scene, .012)
    for (const dx of [-.11, .11]) { const foot = cylinder(.025, .025, .012, [x + dx, .75, -2.082], '#9b814f'); foot.rotation.x = Math.PI / 2 }
    tube([[x - .11, .75, -2.075], [x - .09, .72, -2.045], [x + .09, .72, -2.045], [x + .11, .75, -2.075]], .009, '#9b814f')
  }
  for (const x of [.94, 3.4]) for (const z of [-3.13, -2.3]) {
    const foot: Point = [x + (x < 2 ? -.035 : .035), .07, z + (z < -2.5 ? -.025 : .025)]
    joint([x, .815, z], foot, .062, .034, darkWood)
    box([.13, .14, .13], [x, .75, z], wood, scene, .015)
    cylinder(.035, .038, .04, [foot[0], .05, foot[2]], '#9b814f')
  }
  box([.96, .018, .63], [2.12, .951, -2.65], '#596952', scene, .018)
  piping(.925, .595, .025, [2.12, .962, -2.65], '#aab08b', scene, 'xz'); plant([1.23, .95, -2.99], .7)
  const lamp = new THREE.Group(); lamp.position.set(3.02, .943, -2.94); scene.add(lamp)
  turned([[0, 0], [.175, 0], [.203, .012], [.21, .033], [.19, .06], [.08, .073], [.04, .09]], [0, 0, 0], '#9b814f', lamp)
  tube([[0, .07, 0], [0, .25, 0], [-.05, .46, .015], [-.04, .57, .015]], .018, '#9b814f', lamp)
  tube([[-.26, .59, .015], [-.26, .51, -.035], [0, .49, -.035], [.22, .51, -.035], [.22, .59, .015]], .012, '#9b814f', lamp)
  const enamel = new THREE.MeshStandardMaterial({ color: '#455f4c', roughness: .28, metalness: .22, side: THREE.DoubleSide }); enamel.name = 'Green enamel lamp hood'
  const hood = new THREE.Mesh(surfaceGeometry(12, 28, (u, v) => new THREE.Vector3((u - .5) * .5 - .02, .59 + Math.sin(v * Math.PI) * .135, .015 + Math.cos(v * Math.PI) * .14)), enamel); hood.castShadow = hood.receiveShadow = true; lamp.add(hood)
  for (const x of [-.27, .23]) {
    tube(Array.from({ length: 21 }, (_, i) => [x, .59 + Math.sin(i / 20 * Math.PI) * .135, .015 + Math.cos(i / 20 * Math.PI) * .14] as Point), .008, '#a68a50', lamp)
    ball([x, .6, .015], [.024, .024, .024], '#9b814f', lamp)
  }
  for (const z of [-.125, .155]) tube([[-.27, .59, z], [.23, .59, z]], .006, '#a68a50', lamp)
  const diffuser = mesh(new THREE.CylinderGeometry(.035, .035, .36, 16), '#efe5cb', [-.02, .588, .015], lamp); diffuser.rotation.z = Math.PI / 2
  tube([[.155, .59, .02], [.16, .47, .03], [.15, .37, .04]], .003, '#a68a50', lamp); ball([.15, .36, .04], [.012, .018, .012], '#9b814f', lamp)
  const deskLight = new THREE.PointLight('#ffdda4', 2, 3); deskLight.position.set(3, 1.51, -2.925); scene.add(deskLight)
  const deskBulb = bulb.clone(); deskBulb.position.copy(deskLight.position); scene.add(deskBulb)
  const saucer = cylinder(.13, .13, .018, [3.06, .958, -2.42], '#e4ddc8'); saucer.receiveShadow = true
  cylinder(.075, .064, .12, [3.06, 1.023, -2.42], '#e4ddc8')
  const tea = new THREE.Mesh(new THREE.CircleGeometry(.063, 20), new THREE.MeshStandardMaterial({ color: '#725334', roughness: .2 })); tea.rotation.x = -Math.PI / 2; tea.position.set(3.06, 1.085, -2.42); scene.add(tea)
  const handle = new THREE.Mesh(new THREE.TorusGeometry(.043, .012, 8, 16), mat('#e4ddc8')); handle.position.set(3.15, 1.025, -2.42); scene.add(handle)
  for (let i = 0; i < 3; i++) { const pen = cylinder(.007, .007, .26, [1.47 + i * .035, .963, -2.45], i ? '#9b814f' : '#465641'); pen.rotation.z = Math.PI / 2; pen.rotation.y = .2 + i * .07 }
  const chair = new THREE.Group(); chair.position.set(2.15, 0, -1.55); scene.add(chair)
  box([.76, .075, .74], [0, .427, 0], darkWood, chair, .05)
  soft([.71, .12, .68], [0, .49, -.015], '#d1bea0', chair, .025); piping(.68, .65, .11, [0, .527, -.015], '#a18b65', chair, 'xz')
  const backFrame = new THREE.Group(); backFrame.position.set(0, .88, .3); backFrame.rotation.x = .12; chair.add(backFrame)
  box([.76, .64, .095], [0, 0, .02], wood, backFrame, .06)
  soft([.65, .53, .11], [0, 0, -.045], '#d1bea0', backFrame); piping(.62, .5, .09, [0, 0, -.078], '#aa9674', backFrame)
  for (const x of [-.31, .31]) for (const z of [-.29, .29]) joint([x, .44, z], [x * 1.13, .045, z * 1.1], .039, .025, darkWood, chair)
  for (const sign of [-1, 1]) {
    tube([[sign * .32, .44, -.24], [sign * .4, .68, -.23], [sign * .4, .75, -.12], [sign * .37, .81, .28]], .025, wood, chair)
    box([.085, .065, .57], [sign * .4, .77, .005], '#c49b65', chair, .028)
  }
  // Cheap soft contact shadows ground furniture without per-frame AO passes.
  const contact = texture(128, 128, ctx => { const g = ctx.createRadialGradient(64, 64, 5, 64, 64, 64); g.addColorStop(0, '#2a211b77'); g.addColorStop(.6, '#2a211b33'); g.addColorStop(1, '#2a211b00'); ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128) }).map
  for (const [x, z, w, d] of [[-3.1, 0, 1.9, 3.3], [2.16, -2.45, 3.3, 1.6], [2.15, -1.55, 1.15, 1.05], [-2.65, 1.78, 1.2, 1.2]]) {
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: contact, transparent: true, depthWrite: false })); shadow.rotation.x = -Math.PI / 2; shadow.position.set(x, .065, z); scene.add(shadow)
  }
  // Same physical, hinged volume at shelf, in hand and on desk.
  const book = new THREE.Group(); scene.add(book); book.scale.setScalar(.55)
  box([.695, 1.035, .115], [.009, 0, -.003], '#efe5cb', book, .008)
  box([.77, 1.1, .026], [0, 0, -.082], '#536447', book, .011)
  box([.714, 1.052, .006], [.005, 0, .059], '#d7cfb5', book, .003)
  // Curved cloth spine wraps around the signatures; raised bands and headbands.
  const binding = mesh(new THREE.CylinderGeometry(.097, .097, 1.1, 24, 1, false, Math.PI, Math.PI), '#536447', [-.325, 0, 0], book)
  binding.scale.x = .64
  for (const y of [-.521, .521]) {
    const headband = cylinder(.056, .056, .014, [-.318, y, -.003], '#b6a16c', book); headband.scale.x = .5
  }
  for (const y of [-.43, -.36, .36, .43]) box([.014, .009, .167], [-.384, y, -.003], '#9a9f74', book, .004)
  const ribbon = mesh(surfaceGeometry(5, 14, (u, v) => new THREE.Vector3(.17 + (u - .5) * .034 + Math.sin(v * 3) * .01, -.38 - v * .25, -.005 + Math.sin(v * 2.8) * .008)), '#a5744f', [0, 0, 0], book); (ribbon.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide
  const lid = new THREE.Group(); lid.position.set(-.385, 0, .09); book.add(lid); box([.77, 1.1, .026], [.385, 0, 0], '#536447', lid, .011)
  box([.715, 1.045, .006], [.385, 0, -.017], '#d7cfb5', lid, .003)
  const title = texture(512, 768, ctx => {
    ctx.fillStyle = '#536447'; ctx.fillRect(0, 0, 512, 768); ctx.strokeStyle = '#b7b58b'; ctx.lineWidth = 3; ctx.strokeRect(25, 25, 462, 718); ctx.fillStyle = '#f1e6c8'; ctx.textAlign = 'center'; ctx.font = '46px "Noto Serif SC",serif'; ctx.fillText('与自己的', 256, 275); ctx.fillText('漫长对话', 256, 350); ctx.font = '24px serif'; ctx.fillText('书房 Chat / 001', 256, 650)
  })
  const cover = new THREE.Mesh(new THREE.PlaneGeometry(.73, 1.06), new THREE.MeshStandardMaterial({ map: title.map })); cover.position.set(.385, 0, .014); lid.add(cover)
  const spine = texture(128, 768, ctx => { ctx.fillStyle = '#536447'; ctx.fillRect(0, 0, 128, 768); ctx.fillStyle = '#f1e6c8'; ctx.textAlign = 'center'; ctx.font = '46px "Noto Serif SC",serif'; Array.from('与自己的漫长对话').forEach((c, i) => ctx.fillText(c, 64, 115 + i * 70)) })
  const spineGeometry = surfaceGeometry(14, 1, (u, v) => { const angle = Math.PI * (u * .9 + .05); return new THREE.Vector3(-.325 - Math.sin(angle) * .063, (.5 - v) * 1.08, -Math.cos(angle) * .097) })
  const spineUV = spineGeometry.getAttribute('uv'); for (let i = 0; i < spineUV.count; i++) spineUV.setY(i, 1 - spineUV.getY(i))
  const spineFace = new THREE.Mesh(spineGeometry, new THREE.MeshStandardMaterial({ map: spine.map, side: THREE.DoubleSide })); book.add(spineFace)
  batchStudy(scene, book)
  return { scene, book, lid, repaint: () => { title.repaint(); spine.repaint(); bookLabels.repaint() }, dispose: () => {
    scene.traverse(o => { if (o instanceof THREE.Mesh) { if (o instanceof THREE.InstancedMesh) o.dispose(); o.geometry.dispose(); (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose()) } }); textures.forEach(t => t.dispose()); sun.shadow.map?.dispose()
  } }
}
