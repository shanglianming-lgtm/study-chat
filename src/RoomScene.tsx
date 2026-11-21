import { useEffect, useRef, type RefObject } from 'react'
import * as THREE from 'three'
import { buildStudy } from './studyModel'

export type Journey = { direction: 'out' | 'back' }
export type RoomStatus = { entered: boolean; paused: boolean; locked: boolean; wantsCapture: boolean; carrying: boolean; busy: boolean; target: 'shelf' | 'desk' | null; hint: string }
export type RoomControls = { enter: (capture?: boolean) => void; interact: () => void; press: (key: string) => void; release: (key: string) => void; turn: (angle: number) => void }
type Props = { onOpen: () => void; bookAway: boolean; controlsRef: RefObject<RoomControls | null>; interactionRef: RefObject<HTMLDivElement | null>; journey: Journey | null; onReveal: () => void; onFinish: () => void; onUnavailable: () => void; onStatus: (state: RoomStatus) => void }
export const initialRoomStatus: RoomStatus = { entered: false, paused: false, locked: false, wantsCapture: true, carrying: false, busy: false, target: null, hint: '走进书房，去书架取一本书。' }
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
    // Reading repaints HTML over a cached room, often without another GL frame.
    // Retain its color buffer for software/composited WebView repaint paths.
    try { renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'low-power' }) } catch { fallback(); return }
    const gl = renderer.getContext(), debug = gl.getExtension('WEBGL_debug_renderer_info')
    const software = !!debug && /swiftshader|llvmpipe|softpipe|software|basic render driver|warp/i.test(String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)))
    const { scene, book, lid, ready, repaint, dispose } = buildStudy(software)
    const canvas = renderer.domElement; canvas.dataset.renderMode = software ? 'software' : 'full'; canvas.tabIndex = 0; canvas.setAttribute('aria-label', '第一人称书房：WASD 行走，鼠标转头，E 交互，Esc 暂停')
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap
    // Room furniture/lights are static. Only moving the world book invalidates shadows.
    renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = true
    renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1; mount.append(canvas)
    const camera = new THREE.PerspectiveCamera(67, 1, .06, 45); camera.rotation.order = 'YXZ'; camera.position.set(.05, 1.65, 2.55)
    // First-person held objects use their own depth buffer, like a game's viewmodel.
    // Keep the real world book/depth for shelf pickup, desk opening and return.
    const heldScene = new THREE.Scene()
    heldScene.add(new THREE.HemisphereLight('#eef2eb', '#c7c1b7', 1.4))
    const heldLight = new THREE.DirectionalLight('#fff9ee', 1.1); heldLight.position.set(3, 6, -1); heldScene.add(heldLight)
    renderer.autoClear = false
    let yaw = .1, pitch = -.05, entered = false, paused = false, carrying = false, reading = false, disposed = false, dirty = true
    void ready.then(() => { if (!disposed) { dirty = true; renderer.shadowMap.needsUpdate = true } })
    let wantsCapture = true, recapture = false
    let renderScale = 1, lastRenderedAt = 0, frameAverage = 16.7, renderSamples = 0, renderedPreviousFrame = false
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
    const view = new THREE.Vector3(), toTarget = new THREE.Vector3(), projected = new THREE.Vector3(), deskAnchor = deskPosition.clone().add(new THREE.Vector3(0, .3, 0))
    const visible = (point: THREE.Vector3) => { projected.copy(point).project(camera); return Math.abs(projected.x) < .93 && Math.abs(projected.y) < .9 && projected.z > -1 && projected.z < 1 }
    const target = (): 'shelf' | 'desk' | null => {
      camera.getWorldDirection(view); toTarget.copy(shelfPosition).sub(camera.position)
      if (Math.hypot(toTarget.x, toTarget.z) < 1.7 && view.dot(toTarget.normalize()) > .35 && visible(shelfPosition)) return 'shelf'
      toTarget.copy(deskPosition).sub(camera.position)
      if (carrying && Math.hypot(toTarget.x, toTarget.z) < 2.1 && view.dot(toTarget.normalize()) > .25 && visible(deskAnchor)) return 'desk'
      return null
    }
    const releaseMouse = () => { keys.clear(); if (document.pointerLockElement === canvas) document.exitPointerLock() }
    const emit = () => {
      const near = target()
      const state: RoomStatus = { entered, paused, locked: document.pointerLockElement === canvas, wantsCapture, carrying, busy: !!motion || !!active || recapture, target: near,
        hint: near === 'shelf' ? carrying ? '把这本书放回原来的位置' : '与自己的漫长对话 · 书房文库 001' : near === 'desk' ? '在窗边坐下，让思绪慢慢成书' : carrying ? '书在手中。走到右侧窗边的书桌。' : '走近后墙书架，寻找那本深绿色的书。' }
      const json = JSON.stringify(state); if (json !== lastStatus) { lastStatus = json; latest.current.onStatus(state) }
    }
    const interact = () => {
      if (!entered || paused || motion || active || reading || latest.current.bookAway) return
      const near = target()
      if (near === 'shelf') { scene.add(book); renderer.shadowMap.needsUpdate = true; motion = { kind: carrying ? 'return' : 'take', start: performance.now(), from: book.position.clone(), rotation: book.quaternion.clone() }; keys.clear() }
      else if (near === 'desk' && carrying) { reading = true; standPosition.copy(camera.position); standYaw = yaw; standPitch = pitch; releaseMouse(); latest.current.onOpen() }
      dirty = true; emit()
    }
    const requestCapture = () => {
      canvas.focus({ preventScroll: true })
      try { const result = canvas.requestPointerLock?.(); if (result) void result.catch(() => { emit() }) } catch { /* A visible one-click retry remains available when capture is denied. */ }
    }
    const lock = (capture = wantsCapture) => {
      wantsCapture = capture
      entered = true; paused = false; keys.clear(); canvas.focus({ preventScroll: true }); dirty = true; emit()
      if (capture) requestCapture()
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
      const consecutiveRender = renderedPreviousFrame; renderedPreviousFrame = false
      // At 15–20 FPS, a 40ms cap made walking slower. 100ms still keeps a step
      // below the padded collision bodies' width, without speeding up after blur.
      const dt = Math.min(.1, Math.max(0, (now - lastTime) / 1000)); lastTime = now
      const state = latest.current
      // Wait for React to remove inert after standing up. The Close click/Esc is
      // the activation; do not silently change an explicitly chosen drag-look mode.
      if (recapture && !state.journey) {
        recapture = false
        if (document.hasFocus() && !document.hidden) { if (wantsCapture && !paused) requestCapture() }
        else paused = true
        emit()
      }
      if (!state.journey) lastJourney = null
      if (state.journey && state.journey !== lastJourney) { scene.add(book); renderer.shadowMap.needsUpdate = true; active = state.journey; lastJourney = state.journey; started = now; keys.clear(); fromCamera.copy(camera.position); fromYaw = yaw; fromPitch = pitch; fromBook.copy(book.position); fromRotation.copy(book.quaternion) }
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
        if (t === 1) { carrying = motion.kind === 'take'; if (carrying) heldScene.add(book); renderer.shadowMap.needsUpdate = true; motion = null; emit() }
      } else if (active) {
        const t = reduced.matches ? 1 : ease((now - started) / 1450), out = active.direction === 'out'
        camera.position.lerpVectors(fromCamera, out ? new THREE.Vector3(2.15, 1.6, -1.25) : standPosition, t)
        const deskYaw = fromYaw - THREE.MathUtils.euclideanModulo(fromYaw + Math.PI, Math.PI * 2) + Math.PI
        yaw = THREE.MathUtils.lerp(fromYaw, out ? deskYaw : standYaw, t); pitch = THREE.MathUtils.lerp(fromPitch, out ? -.43 : standPitch, t); updateCamera(); updateHand()
        book.position.lerpVectors(fromBook, out ? deskPosition : handPosition, Math.min(1, t * 1.5)); book.quaternion.slerpQuaternions(fromRotation, out ? deskRotation : handRotation, Math.min(1, t * 1.5)); lid.rotation.y = -Math.PI * (out ? ease((t - .4) / .6) : 1 - ease(t / .6)); dirty = true
        if (t === 1) { const direction = active.direction; active = null; if (direction === 'out') latest.current.onReveal(); else { reading = false; paused = false; carrying = true; heldScene.add(book); lid.rotation.y = 0; recapture = true }; renderer.shadowMap.needsUpdate = true; latest.current.onFinish(); emit() }
      } else if (!reading) { book.position.copy(carrying ? handPosition : shelfPosition); book.quaternion.copy(carrying ? handRotation : shelfRotation); lid.rotation.y = 0 }
      // The readable HTML leaves take over the desk book, not the whole room.
      // Keep the seated camera and the real window, lamp and desktop rendered.
      const showBook = !reading || !!state.journey
      if (book.visible !== showBook) { book.visible = showBook; renderer.shadowMap.needsUpdate = true; dirty = true }
      if (now - lastHUD > 120) { emit(); lastHUD = now }
      if (dirty) {
        const near = target(), prompt = latest.current.interactionRef.current
        if (near && prompt) {
          projected.copy(near === 'shelf' ? shelfPosition : deskAnchor).project(camera)
          const width = mount.clientWidth, height = mount.clientHeight, half = Math.min(155, (width - 32) / 2)
          const sx = (projected.x + 1) * width / 2, sy = (1 - projected.y) * height / 2
          const px = THREE.MathUtils.clamp(sx, half + 16, width - half - 16)
          // The viewmodel occupies the lower-right: put carried-book actions
          // above it, keeping a connector at the actual projected object.
          const py = carrying ? THREE.MathUtils.clamp(sy, Math.min(160, height * .4), height * .48) : THREE.MathUtils.clamp(sy, 80, height - 160)
          prompt.style.setProperty('--target-x', `${px}px`); prompt.style.setProperty('--target-y', `${py}px`)
          prompt.style.setProperty('--pin-offset-x', `${sx - px}px`); prompt.style.setProperty('--pin-drop', `${Math.max(0, sy - py)}px`)
        }
        // Reduce only the 3D framebuffer on sustained slow rendering; HTML text,
        // HUD and reader stay at native resolution. No GPU-performance promise.
        const interval = now - lastRenderedAt
        // A long active frame is overload, not an idle gap. The old <180ms
        // cutoff kept resetting adaptation precisely on the slowest machines.
        if (lastRenderedAt && consecutiveRender) { frameAverage += (Math.min(interval, 1000) - frameAverage) * .2; renderSamples++ }
        else { frameAverage = 16.7; renderSamples = 0 }
        if (renderSamples >= 8 && frameAverage > 40 && renderScale > .65) {
          renderScale = Math.max(.65, renderScale * .85); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5) * renderScale); renderSamples = 0; frameAverage = 16.7
        }
        lastRenderedAt = now
        renderer.clear(); renderer.render(scene, camera)
        if (book.parent === heldScene) { renderer.clearDepth(); renderer.render(heldScene, camera) }
        renderedPreviousFrame = true
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
    const pointerUp = () => { if (!paused && !reading && !motion && !active && !latest.current.bookAway) { if (document.pointerLockElement !== canvas && wantsCapture && drag && drag.distance < 5) requestCapture(); else if (document.pointerLockElement === canvas || drag && drag.distance < 5) interact() }; drag = null }
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
