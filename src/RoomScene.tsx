import { useEffect, useRef, type RefObject } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

export type Journey = { direction: 'out' | 'back' }
type Props = { onOpen: () => void; bookAway: boolean; shelfRef: RefObject<HTMLButtonElement | null>; journey: Journey | null; onReveal: () => void; onFinish: () => void; onUnavailable: () => void }
type Point = [number, number, number]
const green = '#627052'
const wood = '#a98b62'
const ease = (value: number) => { const t = THREE.MathUtils.clamp(value, 0, 1); return t * t * (3 - 2 * t) }

/** Locally modeled geometry, lighting and a single articulated book. No remote assets. */
export default function RoomScene(props: Props) {
  const host = useRef<HTMLDivElement>(null)
  const latest = useRef(props)
  const unavailable = useRef(false)
  latest.current = props
  useEffect(() => {
    if (unavailable.current && props.journey) { if (props.journey.direction === 'out') props.onReveal(); props.onFinish() }
  }, [props.journey, props.onReveal, props.onFinish])
  useEffect(() => {
    const mount = host.current
    if (!mount) return
    let renderer: THREE.WebGLRenderer
    const fallback = () => { unavailable.current = true; latest.current.onUnavailable(); if (latest.current.journey) { if (latest.current.journey.direction === 'out') latest.current.onReveal(); latest.current.onFinish() } }
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' }) }
    catch { fallback(); return }
    const canvas = renderer.domElement
    canvas.setAttribute('aria-label', '三维书房，拖动改变观察角度')
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.35
    mount.append(canvas)
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(35, 1, .1, 60)
    camera.position.set(9.4, 7.5, 10.5)
    const controls = new OrbitControls(camera, canvas)
    controls.target.set(0, 1.5, -.1)
    controls.enablePan = false; controls.enableDamping = true; controls.dampingFactor = .09; controls.rotateSpeed = .55
    controls.minDistance = 10; controls.maxDistance = 18
    controls.minPolarAngle = .68; controls.maxPolarAngle = 1.22
    controls.minAzimuthAngle = .12; controls.maxAzimuthAngle = 1.25
    controls.update()
    let returnCamera = camera.position.clone(), returnTarget = controls.target.clone()
    const textures: THREE.Texture[] = []
    const mesh = (geometry: THREE.BufferGeometry, color: string, position: Point, parent: THREE.Object3D = scene) => {
      const object = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, roughness: .85 }))
      object.position.set(...position); object.castShadow = true; object.receiveShadow = true; parent.add(object)
      return object
    }
    const box = (size: Point, position: Point, color: string, parent: THREE.Object3D = scene) => mesh(new THREE.BoxGeometry(...size), color, position, parent)
    const cylinder = (top: number, bottom: number, height: number, position: Point, color: string, parent: THREE.Object3D = scene) => mesh(new THREE.CylinderGeometry(top, bottom, height, 24), color, position, parent)
    const sphere = (position: Point, size: Point, color: string, parent: THREE.Object3D = scene) => {
      const object = mesh(new THREE.SphereGeometry(1, 16, 12), color, position, parent); object.scale.set(...size); return object
    }
    const texture = (width: number, height: number, paint: (ctx: CanvasRenderingContext2D) => void) => {
      const image = document.createElement('canvas'); image.width = width; image.height = height
      const context = image.getContext('2d')!; paint(context)
      const map = new THREE.CanvasTexture(image); map.colorSpace = THREE.SRGBColorSpace
      map.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy()); textures.push(map)
      return { map, repaint: () => { paint(context); map.needsUpdate = true } }
    }
    scene.add(new THREE.HemisphereLight('#fff7df', '#a2a58d', 2.6))
    const sun = new THREE.DirectionalLight('#fff1cb', 3)
    sun.position.set(-3.5, 8, 5); sun.castShadow = true; sun.shadow.mapSize.set(1536, 1536)
    sun.shadow.camera.left = -7; sun.shadow.camera.right = 7; sun.shadow.camera.top = 7; sun.shadow.camera.bottom = -7
    sun.shadow.normalBias = .035; sun.shadow.bias = -.0002; sun.shadow.radius = 4; scene.add(sun)

    // Cutaway shell, individual floorboards, woven rug and skirting.
    box([8.4, .25, 6.4], [0, -.15, 0], '#b4a58a')
    for (let i = 0; i < 15; i++) box([.525, .045, 6], [-3.95 + i * .56, 0, 0], ['#d6c6a9', '#dcccaf', '#d1bd9f'][i % 3])
    box([8.35, 4.55, .17], [0, 2.2, -3.12], '#dedccc'); box([.17, 4.55, 6.3], [-4.12, 2.2, 0], '#e9e5d4')
    box([8.3, .12, .13], [0, .12, -2.98], '#c5bda4'); box([.13, .12, 6.1], [-3.98, .12, 0], '#c5bda4')
    box([4.4, .025, 3.2], [-.5, .04, .8], '#b9baa0'); box([4.15, .027, 2.96], [-.5, .045, .8], '#c9c8b0')
    for (const z of [-.58, 2.18]) box([4.1, .006, .025], [-.5, .065, z], '#a8ad91')

    // Framed window on the left wall.
    box([.04, 2.15, 2.45], [-4.005, 2.85, -.65], '#b6cec8'); box([.06, .8, 2.42], [-3.97, 2.2, -.65], '#9ab4a2')
    for (const z of [-1.96, .66]) box([.2, 2.45, .13], [-3.91, 2.85, z], '#f5edda')
    for (const y of [1.63, 4.07]) box([.2, .13, 2.75], [-3.91, y, -.65], '#f5edda')
    box([.23, .09, 2.6], [-3.87, 2.86, -.65], '#f5edda'); box([.23, 2.4, .09], [-3.87, 2.85, -.65], '#f5edda'); box([.58, .12, 2.9], [-3.75, 1.57, -.65], '#d5c4a2')
    box([1.18, 1.48, .09], [-1.45, 3.1, -2.99], '#a99068')
    const painting = texture(256, 320, ctx => {
      ctx.fillStyle = '#eee7d0'; ctx.fillRect(0, 0, 256, 320)
      ctx.fillStyle = '#c5cbb1'; ctx.beginPath(); ctx.moveTo(0, 255); ctx.lineTo(105, 90); ctx.lineTo(256, 280); ctx.fill()
      ctx.fillStyle = '#9baa8b'; ctx.beginPath(); ctx.moveTo(80, 290); ctx.lineTo(190, 154); ctx.lineTo(256, 245); ctx.lineTo(256, 320); ctx.fill()
      ctx.fillStyle = '#d7ba80'; ctx.beginPath(); ctx.arc(185, 70, 22, 0, Math.PI * 2); ctx.fill()
    })
    const art = new THREE.Mesh(new THREE.PlaneGeometry(1.01, 1.3), new THREE.MeshStandardMaterial({ map: painting.map }))
    art.position.set(-1.45, 3.1, -2.935); scene.add(art)

    // Shelf joinery and varied clothbound volumes.
    box([2.35, 3.55, .09], [2.36, 1.84, -2.93], '#ad9671')
    for (const x of [1.13, 3.59]) box([.13, 3.65, .76], [x, 1.84, -2.58], wood)
    for (const y of [.12, 1.16, 2.2, 3.62]) box([2.6, .11, .86], [2.36, y, -2.56], wood)
    const cloth = ['#9fa78e', '#b5ab8d', '#859379', '#c8b899', '#aab1a0', '#8f967d']
    for (let row = 0; row < 2; row++) for (let i = 0; i < 10; i++) {
      const height = .64 + (i * 7 % 5) * .055, x = 1.37 + i * .215
      box([.17, height, .54], [x, .19 + row * 1.04 + height / 2, -2.5], cloth[(i + row) % cloth.length])
      box([.12, .012, .01], [x, .28 + row * 1.04, -2.224], '#d5cfaa')
    }
    for (const [x, h, color] of [[1.42, .86, cloth[0]], [1.63, 1.04, cloth[1]], [2.95, .92, cloth[3]], [3.17, .8, cloth[4]], [3.36, .97, cloth[2]]] as [number, number, string][]) box([.17, h, .56], [x, 2.26 + h / 2, -2.51], color)
    cylinder(.15, .2, .37, [2.95, 3.86, -2.5], '#c3b495'); sphere([2.95, 4.08, -2.5], [.14, .19, .14], '#c3b495')
    box([.6, .085, .45], [1.66, 3.74, -2.5], '#8e9a7d'); box([.53, .06, .44], [1.63, 3.82, -2.5], '#d4c4a5')

    // Oak desk, writing pad, pencil and ceramic coffee cup.
    box([4.15, .18, 1.9], [-.7, 1.64, .35], '#b79a71'); box([4, .06, 1.75], [-.7, 1.76, .35], '#c4a982')
    for (const x of [-2.47, 1.06]) for (const z of [-.35, 1.03]) box([.14, 1.57, .14], [x, .8, z], '#9e825e')
    box([3.6, .16, .09], [-.7, .55, -.35], '#9e825e'); box([1.65, .018, 1.12], [-.62, 1.8, .35], '#d9d6bd')
    const pencil = cylinder(.018, .018, .65, [.55, 1.83, .96], '#7b8565'); pencil.rotation.z = Math.PI / 2; pencil.rotation.y = .28
    cylinder(.13, .11, .3, [.82, 1.95, -.23], '#d9ddce'); cylinder(.105, .105, .012, [.82, 2.104, -.23], '#786b52')
    mesh(new THREE.TorusGeometry(.1, .025, 8, 24), '#d9ddce', [1, 1.97, -.23]).rotation.y = .3
    cylinder(.24, .28, .065, [-2.08, 1.85, -.12], '#657054')
    cylinder(.027, .027, .85, [-2.08, 2.28, -.12], '#707a59').rotation.z = -.3
    cylinder(.025, .025, .6, [-1.87, 2.77, -.12], '#707a59').rotation.z = -1
    cylinder(.17, .35, .29, [-1.61, 2.79, -.12], '#6c7958')
    const bulb = sphere([-1.61, 2.64, -.12], [.16, .045, .16], '#ffebad'); bulb.material.emissive.set('#ffd780'); bulb.material.emissiveIntensity = 1
    const lampLight = new THREE.PointLight('#ffda92', 3, 4, 2); lampLight.position.set(-1.61, 2.56, -.12); scene.add(lampLight)

    // Chair and potted plant are freestanding models too.
    box([1.02, .16, .98], [-.85, .82, 1.98], '#929c7e'); box([1.02, .79, .14], [-.85, 1.3, 2.39], '#919d7c').rotation.x = -.1
    for (const x of [-1.23, -.47]) for (const z of [1.62, 2.31]) box([.065, .77, .065], [x, .41, z], '#8c7859')
    cylinder(.39, .27, .63, [2.8, .38, 1.1], '#b69e7d'); cylinder(.35, .35, .04, [2.8, .71, 1.1], '#7f7859')
    for (let i = 0; i < 9; i++) {
      const angle = i * 2.4, height = .8 + (i % 3) * .23, x = 2.8 + Math.cos(angle) * .31, z = 1.1 + Math.sin(angle) * .31
      cylinder(.013, .013, height, [x, .7 + height / 2, z], '#788663').rotation.z = Math.cos(angle) * -.2
      sphere([x + Math.cos(angle) * .2, .65 + height, z + Math.sin(angle) * .2], [.16, .43, .07], i % 2 ? '#748c60' : '#8b9e73').rotation.set(Math.sin(angle) * .55, -angle, -Math.cos(angle) * .6)
    }

    // One volume with an articulated front board: shelf → desk → open → shelf.
    const book = new THREE.Group(); scene.add(book)
    box([.71, 1.04, .11], [0, 0, 0], '#efe5cb', book); box([.77, 1.1, .025], [0, 0, -.08], green, book); box([.035, 1.1, .19], [-.37, 0, 0], green, book)
    for (let line = 0; line < 7; line++) box([.69, .005, .002], [0, -.4 + line * .13, .06], '#cfc5ac', book)
    const lid = new THREE.Group(); lid.position.set(-.385, 0, .09); book.add(lid)
    box([.77, 1.1, .025], [.385, 0, 0], green, lid)
    const cover = texture(512, 768, ctx => {
      ctx.fillStyle = '#627052'; ctx.fillRect(0, 0, 512, 768); ctx.strokeStyle = '#adb38a'; ctx.lineWidth = 2; ctx.strokeRect(32, 35, 448, 698)
      ctx.fillStyle = '#e5dfbd'; ctx.textAlign = 'center'; ctx.font = '26px serif'; ctx.fillText('书房文库 / 001', 256, 103)
      ctx.font = '48px "Noto Serif SC", serif'; ctx.fillText('与自己的', 256, 260); ctx.fillText('漫长对话', 256, 332); ctx.font = '22px serif'; ctx.fillText('书房 Chat', 256, 650)
    })
    const coverFace = new THREE.Mesh(new THREE.PlaneGeometry(.73, 1.06), new THREE.MeshStandardMaterial({ map: cover.map, roughness: .9 })); coverFace.position.set(.385, 0, .014); lid.add(coverFace)
    const spine = texture(128, 768, ctx => {
      ctx.fillStyle = '#627052'; ctx.fillRect(0, 0, 128, 768); ctx.strokeStyle = '#c1bd8a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(12, 45); ctx.lineTo(116, 45); ctx.moveTo(12, 722); ctx.lineTo(116, 722); ctx.stroke()
      ctx.fillStyle = '#f2ebce'; ctx.textAlign = 'center'; ctx.font = '40px "Noto Serif SC", serif'; Array.from('与自己的漫长对话').forEach((char, i) => ctx.fillText(char, 64, 145 + i * 65))
    })
    const spineFace = new THREE.Mesh(new THREE.PlaneGeometry(.17, 1.08), new THREE.MeshStandardMaterial({ map: spine.map })); spineFace.position.set(-.389, 0, 0); spineFace.rotation.y = -Math.PI / 2; book.add(spineFace)
    const shelfPosition = new THREE.Vector3(2.28, 2.81, -2.5), pullPosition = new THREE.Vector3(2.28, 2.92, -1.28), deskPosition = new THREE.Vector3(-.2, 1.91, .38)
    const arc = new THREE.QuadraticBezierCurve3(pullPosition, new THREE.Vector3(.8, 3.4, .8), deskPosition)
    const shelfRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0)), deskRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0))
    book.position.copy(shelfPosition); book.quaternion.copy(shelfRotation)
    let disposed = false
    void document.fonts.ready.then(() => { if (!disposed) { cover.repaint(); spine.repaint() } })
    let needsRender = true
    controls.addEventListener('change', () => { needsRender = true })
    const bounds = new THREE.Box3(new THREE.Vector3(-4.25, -.3, -3.25), new THREE.Vector3(4.25, 4.5, 3.25))
    const center = bounds.getCenter(new THREE.Vector3())
    const corners = [0, 1, 2, 3, 4, 5, 6, 7].map(i => new THREE.Vector3(i & 1 ? bounds.max.x : bounds.min.x, i & 2 ? bounds.max.y : bounds.min.y, i & 4 ? bounds.max.z : bounds.min.z))
    const resize = new ResizeObserver(() => {
      const { width, height } = mount.getBoundingClientRect(); renderer.setSize(Math.max(1, width), Math.max(1, height), false)
      camera.aspect = width / Math.max(1, height); camera.fov = width < height ? 48 : 35; camera.updateProjectionMatrix(); needsRender = true
      // Fit every corner, not just the room center: nearby floor corners need more space.
      const fitting = camera.clone()
      const direction = new THREE.Vector3(9.4, 6, 10.6).normalize()
      let distance = 12
      for (let attempt = 0; attempt < 50; attempt++) {
        fitting.position.copy(center).addScaledVector(direction, distance); fitting.lookAt(center); fitting.updateMatrixWorld()
        if (corners.every(corner => { const point = corner.clone().project(fitting); return Math.abs(point.x) < .86 && Math.abs(point.y) < .86 })) break
        distance *= 1.045
      }
      controls.minDistance = distance * .78; controls.maxDistance = distance * 1.35
      returnCamera.copy(fitting.position); returnTarget.copy(center)
      if (!latest.current.journey) { camera.position.copy(fitting.position); controls.target.copy(center); controls.update() }
    }); resize.observe(mount)
    let active: Journey | null = null, started = 0, frame = 0
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    const projected = new THREE.Vector3(), up = new THREE.Vector3(), down = new THREE.Vector3()
    const zoomCamera = new THREE.Vector3(2.6, 4.7, 4.6), zoomTarget = new THREE.Vector3(-.45, 1.8, .25)
    const finish = () => { const direction = active?.direction; active = null; if (direction === 'out') latest.current.onReveal(); else { camera.position.copy(returnCamera); controls.target.copy(returnTarget) }; latest.current.onFinish() }
    const animate = (now: number) => {
      if (unavailable.current) return
      frame = requestAnimationFrame(animate)
      const state = latest.current
      if (state.journey && state.journey !== active) { active = state.journey; started = now; if (active.direction === 'out') { returnCamera = camera.position.clone(); returnTarget = controls.target.clone() } }
      controls.enabled = !state.bookAway && !active; controls.enableDamping = !reduced.matches; book.visible = !!active || !state.bookAway
      if (active) {
        const time = (now - started) / 1000
        if (active.direction === 'out') {
          if (time < .6) { book.position.lerpVectors(shelfPosition, pullPosition, ease(time / .6)); book.quaternion.copy(shelfRotation) }
          else { const t = ease((time - .6) / .95); book.position.copy(arc.getPoint(t)); book.quaternion.slerpQuaternions(shelfRotation, deskRotation, t) }
          lid.rotation.y = -Math.PI * ease((time - 1.55) / .55)
          camera.position.lerpVectors(returnCamera, zoomCamera, ease((time - 2.2) / .5)); controls.target.lerpVectors(returnTarget, zoomTarget, ease((time - 2.2) / .5))
        } else {
          camera.position.lerpVectors(zoomCamera, returnCamera, ease(time / .45)); controls.target.lerpVectors(zoomTarget, returnTarget, ease(time / .45))
          lid.rotation.y = -Math.PI * (1 - ease((time - .45) / .5))
          if (time < .95) { book.position.copy(deskPosition); book.quaternion.copy(deskRotation) }
          else if (time < 1.95) { const t = ease(time - .95); book.position.copy(arc.getPoint(1 - t)); book.quaternion.slerpQuaternions(deskRotation, shelfRotation, t) }
          else { book.position.lerpVectors(pullPosition, shelfPosition, ease((time - 1.95) / .6)); book.quaternion.copy(shelfRotation) }
        }
        camera.lookAt(controls.target)
        if (time > (active.direction === 'out' ? 2.8 : 2.65) || reduced.matches) finish()
      } else if (!state.bookAway) { book.position.copy(shelfPosition); book.quaternion.copy(shelfRotation); lid.rotation.y = 0; controls.update() }
      if (!state.bookAway || state.journey) {
        const button = state.shelfRef.current
        if (button && !active) {
          projected.set(-.39, 0, 0); book.localToWorld(projected); projected.project(camera)
          up.set(-.39, .55, 0); book.localToWorld(up); up.project(camera); down.set(-.39, -.55, 0); book.localToWorld(down); down.project(camera)
          button.style.left = `${(projected.x * .5 + .5) * mount.clientWidth}px`; button.style.top = `${(-projected.y * .5 + .5) * mount.clientHeight}px`; button.style.height = `${Math.max(36, Math.abs(up.y - down.y) * mount.clientHeight / 2)}px`
        }
        if (needsRender || state.journey) { renderer.render(scene, camera); needsRender = false }
      }
    }; frame = requestAnimationFrame(animate)
    const ray = new THREE.Raycaster(), pointer = new THREE.Vector2()
    let pressed: Point | null = null
    const pointerDown = (event: PointerEvent) => { pressed = [event.clientX, event.clientY, 0] }
    const pointerUp = (event: PointerEvent) => {
      if (!pressed || Math.hypot(event.clientX - pressed[0], event.clientY - pressed[1]) > 5 || latest.current.bookAway) return
      const rect = canvas.getBoundingClientRect(); pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1); ray.setFromCamera(pointer, camera)
      if (ray.intersectObject(book, true).length) latest.current.onOpen()
    }
    canvas.addEventListener('pointerdown', pointerDown); canvas.addEventListener('pointerup', pointerUp); canvas.addEventListener('webglcontextlost', fallback)
    return () => {
      disposed = true; cancelAnimationFrame(frame); resize.disconnect(); controls.dispose()
      canvas.removeEventListener('pointerdown', pointerDown); canvas.removeEventListener('pointerup', pointerUp); canvas.removeEventListener('webglcontextlost', fallback)
      scene.traverse(object => { if (object instanceof THREE.Mesh) { object.geometry.dispose(); (Array.isArray(object.material) ? object.material : [object.material]).forEach(item => item.dispose()) } })
      textures.forEach(map => map.dispose()); sun.shadow.map?.dispose(); renderer.dispose(); renderer.forceContextLoss(); canvas.remove()
    }
  }, [])
  return <div className="scene-canvas" ref={host} />
}
