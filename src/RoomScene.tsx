import { useEffect, useRef, type RefObject } from 'react'
import * as THREE from 'three'
import { buildStudy } from './studyModel'

export type Journey = { direction: 'out' | 'back' }
export type RoomStatus = { entered: boolean; paused: boolean; locked: boolean; carrying: boolean; busy: boolean; target: 'shelf' | 'desk' | null; hint: string }
export type RoomControls = { enter: (capture?: boolean) => void; interact: () => void; press: (key: string) => void; release: (key: string) => void; turn: (angle: number) => void }
type Props = { onOpen: () => void; bookAway: boolean; controlsRef: RefObject<RoomControls | null>; journey: Journey | null; onReveal: () => void; onFinish: () => void; onUnavailable: () => void; onStatus: (state: RoomStatus) => void }
export const initialRoomStatus: RoomStatus = { entered: false, paused: false, locked: false, carrying: false, busy: false, target: null, hint: '走进书房，去书架取一本书。' }
const ease = (t: number) => { t = THREE.MathUtils.clamp(t, 0, 1); return t * t * (3 - 2 * t) }

export default function RoomScene(props: Props) {
  const host = useRef<HTMLDivElement>(null), latest = useRef(props), unavailable = useRef(false)
  latest.current = props
  useEffect(() => {
    if (unavailable.current && props.journey) { if (props.journey.direction === 'out') props.onReveal(); props.onFinish() }
  }, [props.journey, props.onReveal, props.onFinish])
  useEffect(() => {
    const mount = host.current
    if (!mount) return
    const fallback = (event?: Event) => {
      event?.preventDefault(); unavailable.current = true; document.exitPointerLock?.(); latest.current.onUnavailable()
      if (latest.current.journey) { if (latest.current.journey.direction === 'out') latest.current.onReveal(); latest.current.onFinish() }
    }
    let renderer: THREE.WebGLRenderer
    try { renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' }) } catch { fallback(); return }
    const { scene, book, lid, repaint, dispose } = buildStudy()
    const canvas = renderer.domElement; canvas.tabIndex = 0; canvas.setAttribute('aria-label', '第一人称书房：WASD 行走，鼠标转头，E 交互，Esc 暂停')
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1; mount.append(canvas)
    const camera = new THREE.PerspectiveCamera(67, 1, .06, 45); camera.rotation.order = 'YXZ'; camera.position.set(.05, 1.65, 2.55)
    // First-person held objects use their own depth buffer, like a game's viewmodel.
    // Keep the real world book/depth for shelf pickup, desk opening and return.
    const heldScene = new THREE.Scene()
    heldScene.add(new THREE.HemisphereLight('#fff4de', '#8d8066', 2.1))
    const heldLight = new THREE.DirectionalLight('#ffe5b8', 2.5); heldLight.position.set(3, 6, -1); heldScene.add(heldLight)
    renderer.autoClear = false
    let yaw = .1, pitch = -.05, entered = false, paused = false, carrying = false, reading = false, disposed = false, dirty = true
    const keys = new Set<string>(), reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    const shelfPosition = new THREE.Vector3(-1.53, 1.61, -3.0), deskPosition = new THREE.Vector3(2.15, .99, -2.58)
    const shelfRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0)), deskRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0))
    const handPosition = new THREE.Vector3(), handRotation = new THREE.Quaternion(), handTilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(-.1, -.18, .05))
    const standPosition = camera.position.clone(); let standYaw = yaw, standPitch = pitch
    let motion: { kind: 'take' | 'return'; start: number; from: THREE.Vector3; rotation: THREE.Quaternion } | null = null
    let active: Journey | null = null, lastJourney: Journey | null = null, started = 0, lastTime = 0, frame = 0, lastStatus = '', lastHUD = 0
    const fromCamera = camera.position.clone(), fromBook = new THREE.Vector3(), fromRotation = new THREE.Quaternion()
    let fromYaw = 0, fromPitch = 0
    const updateCamera = () => { camera.rotation.set(pitch, yaw, 0, 'YXZ'); camera.updateMatrixWorld() }
    const updateHand = () => { handPosition.set(.25, -.37, -.65).applyQuaternion(camera.quaternion).add(camera.position); handRotation.copy(camera.quaternion).multiply(handTilt) }
    const obstacles = [
      [-3.94, -2.62, -1.5, 1.4], [-2.87, .54, -3.5, -2.75], [.7, 3.65, -3.4, -2.13], [1.7, 2.6, -1.96, -1.13], [-3.65, -2.97, -2.2, -1.5], [-3.08, -2.22, 1.35, 2.2],
    ]
    const canStand = (x: number, z: number) => Math.abs(x) < 3.68 && Math.abs(z) < 3.18 && !obstacles.some(([a, b, c, d]) => x > a - .2 && x < b + .2 && z > c - .2 && z < d + .2)
    const view = new THREE.Vector3(), toTarget = new THREE.Vector3()
    const target = (): 'shelf' | 'desk' | null => {
      camera.getWorldDirection(view); toTarget.copy(shelfPosition).sub(camera.position)
      if (Math.hypot(toTarget.x, toTarget.z) < 1.7 && view.dot(toTarget.normalize()) > .35) return 'shelf'
      toTarget.copy(deskPosition).sub(camera.position)
      if (carrying && Math.hypot(toTarget.x, toTarget.z) < 2.1 && view.dot(toTarget.normalize()) > .25) return 'desk'
      return null
    }
    const releaseMouse = () => { keys.clear(); if (document.pointerLockElement === canvas) document.exitPointerLock() }
    const emit = () => {
      const near = target()
      const state: RoomStatus = { entered, paused, locked: document.pointerLockElement === canvas, carrying, busy: !!motion || !!active, target: near,
        hint: near === 'shelf' ? carrying ? '把这本书放回原来的位置' : '与自己的漫长对话 · 书房文库 001' : near === 'desk' ? '在窗边坐下，让思绪慢慢成书' : carrying ? '书在手中。走到右侧窗边的书桌。' : '走近后墙书架，寻找那本深绿色的书。' }
      const json = JSON.stringify(state); if (json !== lastStatus) { lastStatus = json; latest.current.onStatus(state) }
    }
    const interact = () => {
      if (!entered || paused || motion || active || reading || latest.current.bookAway) return
      const near = target()
      if (near === 'shelf') { scene.add(book); motion = { kind: carrying ? 'return' : 'take', start: performance.now(), from: book.position.clone(), rotation: book.quaternion.clone() }; keys.clear() }
      else if (near === 'desk' && carrying) { reading = true; standPosition.copy(camera.position); standYaw = yaw; standPitch = pitch; releaseMouse(); latest.current.onOpen() }
      dirty = true; emit()
    }
    const lock = (capture = true) => {
      entered = true; paused = false; keys.clear(); canvas.focus({ preventScroll: true }); dirty = true; emit()
      if (capture) try { const result = canvas.requestPointerLock?.(); if (result) void result.catch(() => { emit() }) } catch { /* Drag-look remains available when capture is denied. */ }
    }
    latest.current.controlsRef.current = {
      enter: lock, interact,
      press: key => { if (entered && !paused) keys.add(key) }, release: key => { keys.delete(key) },
      turn: angle => { if (entered && !paused && !reading && !active) { yaw += angle; dirty = true } },
    }
    const resize = new ResizeObserver(() => { const { width, height } = mount.getBoundingClientRect(); renderer.setSize(Math.max(1, width), Math.max(1, height), false); camera.aspect = width / Math.max(1, height); camera.updateProjectionMatrix(); dirty = true }); resize.observe(mount)
    void document.fonts.ready.then(() => { if (!disposed) { repaint(); dirty = true } })
    const animate = (now: number) => {
      if (disposed || unavailable.current) return
      frame = requestAnimationFrame(animate)
      const dt = Math.min(.04, Math.max(0, (now - lastTime) / 1000)); lastTime = now
      const state = latest.current
      if (!state.journey) lastJourney = null
      if (state.journey && state.journey !== lastJourney) { scene.add(book); active = state.journey; lastJourney = state.journey; started = now; keys.clear(); fromCamera.copy(camera.position); fromYaw = yaw; fromPitch = pitch; fromBook.copy(book.position); fromRotation.copy(book.quaternion) }
      if (entered && !paused && !motion && !active && !reading && !state.bookAway) {
        const turn = Number(keys.has('ArrowLeft')) - Number(keys.has('ArrowRight')); yaw += turn * dt * 1.6
        let forward = Number(keys.has('KeyW') || keys.has('ArrowUp')) - Number(keys.has('KeyS') || keys.has('ArrowDown')), side = Number(keys.has('KeyD')) - Number(keys.has('KeyA'))
        const len = Math.hypot(forward, side)
        if (len) { forward /= len; side /= len; const speed = 1.8 * dt; const dx = (-Math.sin(yaw) * forward + Math.cos(yaw) * side) * speed, dz = (-Math.cos(yaw) * forward - Math.sin(yaw) * side) * speed; if (canStand(camera.position.x + dx, camera.position.z)) camera.position.x += dx; if (canStand(camera.position.x, camera.position.z + dz)) camera.position.z += dz }
        if (len || turn) dirty = true
      }
      updateCamera(); updateHand()
      if (motion) {
        const t = reduced.matches ? 1 : ease((now - motion.start) / 650)
        book.position.lerpVectors(motion.from, motion.kind === 'take' ? handPosition : shelfPosition, t); book.quaternion.slerpQuaternions(motion.rotation, motion.kind === 'take' ? handRotation : shelfRotation, t); dirty = true
        if (t === 1) { carrying = motion.kind === 'take'; if (carrying) heldScene.add(book); motion = null; emit() }
      } else if (active) {
        const t = reduced.matches ? 1 : ease((now - started) / 1450), out = active.direction === 'out'
        camera.position.lerpVectors(fromCamera, out ? new THREE.Vector3(2.15, 1.35, -1.25) : standPosition, t)
        const deskYaw = fromYaw - THREE.MathUtils.euclideanModulo(fromYaw + Math.PI, Math.PI * 2) + Math.PI
        yaw = THREE.MathUtils.lerp(fromYaw, out ? deskYaw : standYaw, t); pitch = THREE.MathUtils.lerp(fromPitch, out ? -.43 : standPitch, t); updateCamera(); updateHand()
        book.position.lerpVectors(fromBook, out ? deskPosition : handPosition, Math.min(1, t * 1.5)); book.quaternion.slerpQuaternions(fromRotation, out ? deskRotation : handRotation, Math.min(1, t * 1.5)); lid.rotation.y = -Math.PI * (out ? ease((t - .4) / .6) : 1 - ease(t / .6)); dirty = true
        if (t === 1) { const direction = active.direction; active = null; if (direction === 'out') latest.current.onReveal(); else { reading = false; paused = false; carrying = true; heldScene.add(book); lid.rotation.y = 0 }; latest.current.onFinish(); emit() }
      } else if (!reading) { book.position.copy(carrying ? handPosition : shelfPosition); book.quaternion.copy(carrying ? handRotation : shelfRotation); lid.rotation.y = 0 }
      if (now - lastHUD > 120) { emit(); lastHUD = now }
      if ((!state.bookAway || state.journey) && dirty) {
        renderer.clear(); renderer.render(scene, camera)
        if (book.parent === heldScene) { renderer.clearDepth(); renderer.render(heldScene, camera) }
        dirty = false
      }
    }; frame = requestAnimationFrame(animate)
    const down = (event: KeyboardEvent) => {
      if (latest.current.bookAway || reading || !entered || (event.target as HTMLElement).closest('input,textarea,select')) return
      if (event.code === 'Escape') { paused = true; releaseMouse(); emit(); return }
      if (paused) return
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyE'].includes(event.code)) { event.preventDefault(); if (event.code === 'KeyE') { if (!event.repeat) interact() } else keys.add(event.code) }
    }
    const up = (event: KeyboardEvent) => keys.delete(event.code)
    const pause = () => { if (!entered || reading || latest.current.bookAway) return; paused = true; releaseMouse(); emit() }
    const changeLock = () => { keys.clear(); if (entered && !reading && !latest.current.bookAway && document.pointerLockElement !== canvas) paused = true; emit() }
    let drag: { id: number; x: number; y: number; distance: number } | null = null
    const pointerDown = (e: PointerEvent) => { if (!entered || paused || reading) return; if (document.pointerLockElement !== canvas) { drag = { id: e.pointerId, x: e.clientX, y: e.clientY, distance: 0 }; canvas.setPointerCapture(e.pointerId) } }
    const pointerMove = (e: PointerEvent) => {
      if (!entered || paused || reading || motion || active || latest.current.bookAway) return
      let dx = 0, dy = 0
      if (document.pointerLockElement === canvas) { dx = e.movementX; dy = e.movementY } else if (drag && drag.id === e.pointerId) { dx = e.clientX - drag.x; dy = e.clientY - drag.y; drag.distance += Math.abs(dx) + Math.abs(dy); drag.x = e.clientX; drag.y = e.clientY }
      yaw -= dx * .0025; pitch = THREE.MathUtils.clamp(pitch - dy * .0025, -1.12, 1.05); if (dx || dy) dirty = true
    }
    const pointerUp = () => { if (document.pointerLockElement === canvas || drag && drag.distance < 5) interact(); drag = null }
    const visibility = () => { if (document.hidden) pause() }
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', pause); document.addEventListener('visibilitychange', visibility); document.addEventListener('pointerlockchange', changeLock)
    canvas.addEventListener('pointerdown', pointerDown); document.addEventListener('pointermove', pointerMove); canvas.addEventListener('pointerup', pointerUp); canvas.addEventListener('pointercancel', pointerUp); canvas.addEventListener('webglcontextlost', fallback)
    return () => {
      disposed = true; releaseMouse(); cancelAnimationFrame(frame); resize.disconnect(); latest.current.controlsRef.current = null
      window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', pause); document.removeEventListener('visibilitychange', visibility); document.removeEventListener('pointerlockchange', changeLock)
      canvas.removeEventListener('pointerdown', pointerDown); document.removeEventListener('pointermove', pointerMove); canvas.removeEventListener('pointerup', pointerUp); canvas.removeEventListener('pointercancel', pointerUp); canvas.removeEventListener('webglcontextlost', fallback)
      scene.add(book); dispose(); renderer.dispose(); canvas.remove()
    }
  }, [])
  return <div className="walk-canvas" ref={host} />
}
