import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'

type Point = [number, number, number]
/** Entirely local geometry/textures. Coordinates are meters, Y is up. */
export function buildStudy() {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#d7c8ae')
  scene.fog = new THREE.Fog('#dfd0b5', 12, 25)
  const textures: THREE.Texture[] = []
  const materials = new Map<string, THREE.MeshStandardMaterial>()
  const mat = (color: string) => {
    if (!materials.has(color)) materials.set(color, new THREE.MeshStandardMaterial({ color, roughness: .85 }))
    return materials.get(color)!
  }
  const mesh = (geometry: THREE.BufferGeometry, color: string, p: Point, parent: THREE.Object3D = scene) => {
    const m = new THREE.Mesh(geometry, mat(color)); m.position.set(...p); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m
  }
  const box = (s: Point, p: Point, c: string, parent: THREE.Object3D = scene, round = 0) => mesh(round ? new RoundedBoxGeometry(...s, 2, round) : new THREE.BoxGeometry(...s), c, p, parent)
  const cylinder = (r: number, r2: number, h: number, p: Point, c: string, parent: THREE.Object3D = scene) => mesh(new THREE.CylinderGeometry(r, r2, h, 20), c, p, parent)
  const ball = (p: Point, s: Point, c: string, parent: THREE.Object3D = scene) => { const m = mesh(new THREE.SphereGeometry(1, 12, 8), c, p, parent); m.scale.set(...s); return m }
  const texture = (w: number, h: number, paint: (ctx: CanvasRenderingContext2D) => void) => {
    const image = document.createElement('canvas'); image.width = w; image.height = h
    const ctx = image.getContext('2d')!; paint(ctx)
    const map = new THREE.CanvasTexture(image); map.colorSpace = THREE.SRGBColorSpace; textures.push(map)
    return { map, repaint: () => { paint(ctx); map.needsUpdate = true } }
  }
  const wood = '#ba8e5c', darkWood = '#977147', linen = '#dfcdb0'
  scene.add(new THREE.HemisphereLight('#fff4de', '#8d8066', 2.1))
  const sun = new THREE.DirectionalLight('#ffe5b8', 2.5); sun.position.set(3, 6, -1); sun.castShadow = true
  sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5 }); sun.shadow.normalBias = .035; scene.add(sun)
  // Enclosed human-scale room, not an orbitable cutaway diorama.
  box([8.2, .18, 7.2], [0, -.12, 0], darkWood)
  const grain = texture(128, 512, ctx => {
    ctx.fillStyle = '#bf996f'; ctx.fillRect(0, 0, 128, 512)
    for (let i = 0; i < 65; i++) { ctx.strokeStyle = i % 3 ? '#a47c4b33' : '#e2c19955'; ctx.lineWidth = .5; ctx.beginPath(); ctx.moveTo(i * 2, 0); ctx.bezierCurveTo(i * 2 + 12, 160, i * 2 - 8, 340, i * 2 + 2, 512); ctx.stroke() }
  })
  const floorMat = new THREE.MeshStandardMaterial({ map: grain.map, roughness: .8 })
  for (let x = 0; x < 24; x++) for (let z = 0; z < 3; z++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(.328, .035, 2.31), floorMat); m.position.set(-3.83 + x * .334, 0, -2.34 + z * 2.34); m.receiveShadow = true; scene.add(m)
  }
  box([8.2, 3.6, .16], [0, 1.8, -3.5], '#e7d6be'); box([.16, 3.6, 7.2], [-4, 1.8, 0], '#e5d2b7')
  box([.16, 3.6, 7.2], [4, 1.8, 0], '#e9dac3'); box([8.2, 3.6, .16], [0, 1.8, 3.5], '#dfccb0')
  box([8, .12, .08], [0, .1, -3.38], '#bca17d'); box([.08, .12, 7], [-3.88, .1, 0], '#bca17d'); box([.08, .12, 7], [3.88, .1, 0], '#bca17d')
  box([8.1, .08, 7.1], [0, 3.62, 0], '#e9dfcc')
  // Broad window, brass curtain rail and softly folded curtains.
  box([3.05, 2.25, .06], [2.15, 2.05, -3.395], '#766b55')
  const sky = texture(256, 256, ctx => {
    const g = ctx.createLinearGradient(0, 0, 0, 256); g.addColorStop(0, '#a5c1cd'); g.addColorStop(1, '#e6dfc4'); ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256)
    for (let i = 0; i < 3; i++) { ctx.fillStyle = ['#a4b5a0', '#91a18b', '#7b947d'][i]; ctx.beginPath(); ctx.moveTo(0, 256); for (let x = 0; x <= 256; x += 8) ctx.lineTo(x, 208 + i * 12 + Math.sin(x / 65 + i * 2) * 17); ctx.lineTo(256, 256); ctx.fill() }
  })
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(2.88, 2.08), new THREE.MeshBasicMaterial({ map: sky.map })); glass.position.set(2.15, 2.05, -3.35); scene.add(glass)
  box([.055, 2.18, .065], [2.75, 2.05, -3.3], '#746a54'); box([3.3, .1, .28], [2.15, .89, -3.2], '#e1c7a1')
  const rail = cylinder(.025, .025, 3.65, [2.07, 3.3, -3.14], '#96805c'); rail.rotation.z = Math.PI / 2
  for (const side of [.57, 3.65]) for (let i = 0; i < 9; i++) { const fold = cylinder(.055, .055, 3.1, [side + (i - 4) * .043, 1.68, -3.13 + Math.sin(i) * .028], i % 2 ? '#cbb795' : linen); fold.scale.z = .7 }
  // Back wall: full oak bookcase, irregular clothbound books and baskets.
  const shelfX = -1.16
  box([3.18, 2.95, .07], [shelfX, 1.5, -3.32], '#9d784e')
  for (const x of [-2.82, -1.72, -.6, .49]) box([.09, 3, .55], [x, 1.51, -3.08], wood)
  for (const y of [.08, .66, 1.27, 1.91, 2.53, 3.01]) box([3.4, .075, .6], [shelfX, y, -3.07], wood)
  const colors = ['#7d8966', '#c9bda0', '#aea181', '#626e54', '#d5c7a9', '#a39373']
  for (let row = 0; row < 4; row++) for (let col = 0; col < 3; col++) for (let i = 0; i < 4; i++) {
    if (row === 1 && col === 1 && i < 2) continue // Reserved for the one interactive book.
    const h = .36 + ((i * 7 + row * 3 + col) % 5) * .035, x = -2.64 + col * 1.1 + i * .22, base = [.7, 1.31, 1.95, 2.57][row]
    box([.16, h, .34], [x, base + h / 2, -3.03], colors[(i + col + row) % 6])
    box([.11, .018, .005], [x, base + h * .25, -2.855], '#ddd1ae')
  }
  for (const x of [-2.27, -1.16, -.05]) { box([.85, .43, .43], [x, .33, -3.02], '#b79764', scene, .03); box([.23, .045, .015], [x, .41, -2.795], '#67553d') }
  const plant = (p: Point, scale = 1) => {
    const g = new THREE.Group(); g.position.set(...p); g.scale.setScalar(scale); scene.add(g)
    cylinder(.17, .12, .29, [0, .14, 0], '#b68c60', g)
    for (let i = 0; i < 11; i++) { const a = i * 2.4, h = .3 + i % 3 * .1; const leaf = ball([Math.cos(a) * .21, h + .16, Math.sin(a) * .21], [.16, .035, .09], i % 2 ? '#708450' : '#8d9e66', g); leaf.rotation.set(.3, a, .4) }
    return g
  }
  plant([-2.27, 3.06, -3.05], 1.2)
  for (let i = 0; i < 10; i++) ball([-2.5 + Math.sin(i) * .08, 3 - i * .12, -2.72], [.1, .075, .045], '#778c53')
  // Left: upholstered sage sofa, pillows, throw, side table, floor lamp, framed print.
  const sofa = new THREE.Group(); sofa.position.set(-3.28, 0, -.05); sofa.rotation.y = Math.PI / 2; scene.add(sofa)
  box([2.55, .38, 1.05], [0, .45, 0], '#777f52', sofa, .12); box([2.5, .8, .24], [0, .96, -.45], '#7f875a', sofa, .1)
  for (const x of [-1.22, 1.22]) { box([.22, .56, 1.13], [x, .76, 0], '#7e8657', sofa, .08); for (const z of [-.36, .36]) box([.07, .23, .07], [x, .13, z], darkWood, sofa) }
  for (const x of [-.6, .6]) box([1.12, .16, .88], [x, .69, .06], '#93996a', sofa, .07)
  box([.57, .57, .17], [-.5, 1, -.25], '#ddd0ac', sofa, .09).rotation.z = -.1
  box([.55, .55, .18], [.35, 1, -.25], '#aa7254', sofa, .09).rotation.z = .15
  box([.52, .055, .97], [.82, .8, .07], '#d5c2a0', sofa, .025); box([.52, .59, .055], [.82, .51, .58], '#d5c2a0', sofa, .025)
  cylinder(.4, .4, .07, [-2.65, .55, 1.78], wood); cylinder(.14, .27, .5, [-2.65, .27, 1.78], wood)
  cylinder(.095, .08, .15, [-2.72, .66, 1.78], '#e6d7b9'); box([.3, .045, .23], [-2.43, .61, 1.73], '#7d8865')
  cylinder(.24, .24, .04, [-3.3, .05, -1.85], '#9d7d4b'); cylinder(.022, .022, 1.9, [-3.3, .99, -1.85], '#a68a52'); cylinder(.27, .39, .5, [-3.3, 2.05, -1.85], '#efdeba')
  const glow = new THREE.PointLight('#ffd695', 3, 4); glow.position.set(-3.3, 1.78, -1.85); scene.add(glow)
  box([.035, 1.15, 1.32], [-3.87, 2.15, -.05], '#b58e55'); box([.04, 1.02, 1.19], [-3.84, 2.15, -.05], '#d5d0a9')
  // Woven rugs and desk under the large window.
  box([2.55, .018, 3.4], [-2.28, .035, .12], '#cab999', scene, .04); box([2.9, .018, 2.15], [2.18, .035, -1.94], '#b48263', scene, .03)
  box([2.83, .12, 1.1], [2.17, .88, -2.73], '#c49b65', scene, .025)
  for (const x of [.92, 3.42]) for (const z of [-3.13, -2.3]) box([.09, .82, .09], [x, .43, z], darkWood)
  box([.9, .012, .6], [2.12, .951, -2.65], '#d4cbb0'); plant([1.23, .95, -2.99], .7)
  cylinder(.16, .2, .04, [3.12, .97, -2.93], '#9b814f'); cylinder(.018, .018, .65, [3.12, 1.31, -2.93], '#9b814f').rotation.z = -.25
  cylinder(.11, .22, .15, [2.92, 1.65, -2.9], '#a68a50'); const deskLight = new THREE.PointLight('#ffdda4', 2, 3); deskLight.position.set(2.92, 1.51, -2.9); scene.add(deskLight)
  const chair = new THREE.Group(); chair.position.set(2.15, 0, -1.55); scene.add(chair)
  box([.74, .12, .72], [0, .48, 0], '#d1bea0', chair, .07); box([.74, .63, .1], [0, .84, .32], '#d1bea0', chair, .06)
  for (const x of [-.31, .31]) for (const z of [-.29, .29]) box([.055, .47, .055], [x, .24, z], darkWood, chair)
  for (const x of [-.43, .43]) { box([.065, .08, .7], [x, .76, 0], wood, chair, .025); box([.055, .28, .055], [x, .61, -.25], wood, chair) }
  // Same physical, hinged volume at shelf, in hand and on desk.
  const book = new THREE.Group(); scene.add(book); book.scale.setScalar(.55)
  box([.71, 1.04, .11], [0, 0, 0], '#efe5cb', book); box([.77, 1.1, .025], [0, 0, -.08], '#536447', book); box([.035, 1.1, .19], [-.37, 0, 0], '#536447', book)
  const lid = new THREE.Group(); lid.position.set(-.385, 0, .09); book.add(lid); box([.77, 1.1, .025], [.385, 0, 0], '#536447', lid)
  const title = texture(512, 768, ctx => {
    ctx.fillStyle = '#536447'; ctx.fillRect(0, 0, 512, 768); ctx.strokeStyle = '#b7b58b'; ctx.lineWidth = 3; ctx.strokeRect(25, 25, 462, 718); ctx.fillStyle = '#f1e6c8'; ctx.textAlign = 'center'; ctx.font = '46px "Noto Serif SC",serif'; ctx.fillText('与自己的', 256, 275); ctx.fillText('漫长对话', 256, 350); ctx.font = '24px serif'; ctx.fillText('书房 Chat / 001', 256, 650)
  })
  const cover = new THREE.Mesh(new THREE.PlaneGeometry(.73, 1.06), new THREE.MeshStandardMaterial({ map: title.map })); cover.position.set(.385, 0, .014); lid.add(cover)
  const spine = texture(128, 768, ctx => { ctx.fillStyle = '#536447'; ctx.fillRect(0, 0, 128, 768); ctx.fillStyle = '#f1e6c8'; ctx.textAlign = 'center'; ctx.font = '46px "Noto Serif SC",serif'; Array.from('与自己的漫长对话').forEach((c, i) => ctx.fillText(c, 64, 115 + i * 70)) })
  const spineFace = new THREE.Mesh(new THREE.PlaneGeometry(.17, 1.08), new THREE.MeshStandardMaterial({ map: spine.map })); spineFace.position.set(-.389, 0, 0); spineFace.rotation.y = -Math.PI / 2; book.add(spineFace)
  return { scene, book, lid, repaint: () => { title.repaint(); spine.repaint() }, dispose: () => {
    scene.traverse(o => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose()) } }); textures.forEach(t => t.dispose()); sun.shadow.map?.dispose()
  } }
}
