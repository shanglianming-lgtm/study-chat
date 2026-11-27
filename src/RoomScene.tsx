import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { buildStudy } from './studyModel'
import { closingAngle, closingSeconds, doorClearsPerson, doorSwing, makeStudyDoor } from './studyDoor'
import { createStudyWalk } from './studyWalk'
import { createStudySound } from './studySound'
import { createPlayerAvatar } from './playerAvatar'
import { createBookMagic } from './bookMagic'
import { finishFolio } from './folioFinish'
import { bookPose, closedCoverCenter, createBookFollower, createShelfFlight, placeBook, readBookPose, shelfFlightTiming } from './bookFlight'
import { folioScale } from './studyFurnishings'
import { createDeskReading, type DeskReading } from './deskReading'

import { readingHand, type HandSignal } from './readingHand'
import { createCursorGaze } from './cursorGaze'
import { sampleRegisterFlight } from './registerFlight'
import { deskJourneyMs, deskSeatPose } from './deskSeat'

export type Journey = { direction: 'out' | 'back' }
export type RoomObject = 'door' | 'shelf' | 'desk' | 'window' | 'register' | 'inscribe' | `volume:${string}`
export type ShelfInteraction = {
  books: { id: string; name: string }[]
  selectedBook: string
  onSelectBook: (id: string) => void
  inscribing: boolean
  inscribedBook: string | null
  onInscribe: (anchor?: { x: number; y: number }) => void
}
export type RoomStatus = { entered: boolean; paused: boolean; carrying: boolean; busy: boolean; ready: boolean }
export const initialRoomStatus: RoomStatus = {
  entered: false,
  paused: false,
  carrying: false,
  busy: false,
  ready: false,
}
export type RoomControls = {
  unlockSound: () => void
  activate: (object: RoomObject) => void
  focus: (object: RoomObject | null) => void
  resume: (capture?: boolean) => void
  press: (key: string) => void
  release: (key: string) => void
}
type Props = ShelfInteraction & {
  soundEnabled: boolean
  onOpen: () => void
  onManage: () => void
  managing: boolean
  hand: HandSignal|null
  bookAway: boolean
  controlsRef: RefObject<RoomControls | null>
  journey: Journey | null
  onReveal: () => void
  onFinish: () => void
  onReadingRig: (rig: DeskReading | null) => void
  onUnavailable: () => void
  onStatus: (state: RoomStatus) => void
}
const ease = (t: number) => THREE.MathUtils.smoothstep(t, 0, 1)
const startEye = new THREE.Vector3(0, 1.65, 6.29),
  insideEye = new THREE.Vector3(0.05, 1.65, 2.04)

export default function RoomScene(props: Props) {
  const host = useRef<HTMLDivElement>(null),
    latest = useRef(props),
    unavailable = useRef(false)
  const inscriptionOpened = useRef(false)
  const registerOpened = useRef(false)
  latest.current = props
  useLayoutEffect(() => {
    if (props.inscribing) inscriptionOpened.current = true
  }, [props.inscribing])
  useLayoutEffect(() => {
    if (props.managing) registerOpened.current = true
  }, [props.managing])
  useEffect(() => {
    const mount = host.current
    if (!mount) return
    let disposed = false,
      dirty = true
    const fallback = (e?: Event) => {
      if (disposed || unavailable.current) return
      e?.preventDefault()
      unavailable.current = true
      latest.current.onReadingRig(null)
      document.exitPointerLock?.()
      latest.current.onUnavailable()
    }
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        preserveDrawingBuffer: true,
        powerPreference: 'high-performance',
      })
    } catch {
      fallback()
      return
    }
    const gl = renderer.getContext(),
      debug = gl.getExtension('WEBGL_debug_renderer_info')
    const software =
      !!debug &&
      /swiftshader|llvmpipe|softpipe|software|basic render driver|warp/i.test(
        String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL))
      )
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.shadowMap.autoUpdate = false
    renderer.shadowMap.needsUpdate = true
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.autoClear = false
    const canvas = renderer.domElement
    canvas.tabIndex = -1
    canvas.setAttribute('aria-label', '三维书房')
    mount.append(canvas)
    const room = buildStudy(software),
      { scene, furnishings: f } = room
    const magic = createBookMagic()
    let finish: ReturnType<typeof finishFolio> | undefined
    let deskRig: DeskReading | null = null
    const doorway = makeStudyDoor(scene, () => {
      dirty = true
    })
    const camera = new THREE.PerspectiveCamera(53, 1, 0.045, 45)
    camera.rotation.order = 'YXZ'
    const eyePosition = startEye.clone()
    const walk = createStudyWalk(), sound = createStudySound()
    let doorClosing: number | null = null
    camera.position.copy(eyePosition)
    let yaw = 0,
      pitch = -0.123,
      desktopFov = 53
    const gaze = createCursorGaze()
    function absorbGaze() {
      yaw += gaze.yaw
      pitch = THREE.MathUtils.clamp(pitch + gaze.pitch, -1.47, 1.05)
      gaze.reset()
    }
    const syncCamera = () => {
      camera.rotation.set(THREE.MathUtils.clamp(pitch + gaze.pitch, -1.47, 1.05), yaw + gaze.yaw, 0, 'YXZ')
      camera.updateMatrixWorld()
    }
    syncCamera()
    let player: ReturnType<typeof createPlayerAvatar> | undefined
    const readingEye = new THREE.Vector3()
    const composer = new EffectComposer(renderer),
      renderPass = new RenderPass(scene, camera)
    const outline = new OutlinePass(new THREE.Vector2(1, 1), scene, camera),
      output = new OutputPass()
    outline.edgeStrength = 3.6
    outline.edgeGlow = 0.06
    outline.edgeThickness = 1.2
    outline.visibleEdgeColor.set('#ffdfa1')
    outline.hiddenEdgeColor.set(0)
    composer.addPass(renderPass)
    composer.addPass(outline)
    composer.addPass(output)

    const pointer = new THREE.Vector2(), palmAim = new THREE.Vector2(), aimTarget = new THREE.Vector2(),
      ray = new THREE.Raycaster(),
      eyeRay = new THREE.Raycaster(),
      keys = new Set<string>()
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    let hasPointer = false,
      keyboardFocus: RoomObject | null = null,
      current: RoomObject | null = null
    let entered = false,
      paused = false,
      carrying = false,
      reading = false,
      ready = false
    let entrance: number | null = null,
      frame = 0,
      last = 0,
      lastStatus = '',
      pixelRatio = 0
    let windowAmount = 0,
      windowGoal = 0
    let animation: 'take' | 'return' | Journey['direction'] | null = null,
      animationStart = 0,
      lastJourney: Journey | null = null
    const standingEye = new THREE.Vector3(),
      standingView = new THREE.Quaternion(),
      besideChair = new THREE.Vector3(),
      deskward = new THREE.Vector3(),
      deskLook = new THREE.Quaternion()
    const dock = bookPose(), desktop = bookPose(), hover = bookPose(), departure = bookPose(), flying = bookPose()
    const follower = createBookFollower(), shelfFlight = createShelfFlight()
    const shelfFacing = new THREE.Vector3(), viewRight = new THREE.Vector3()
    let lastMagicPaint = 0, departureOpening = 0
    const bookCasters: THREE.Mesh[] = []
    const readingLean = new THREE.Vector3()
    const standingPose = deskSeatPose(0), readingPose = deskSeatPose(1)
    const meshes: THREE.Mesh[] = [],
      roomAndBook: THREE.Mesh[] = []
    let enteredCapture = false
    let handModel:ReturnType<typeof readingHand>|undefined,lastHand=0
    let registerTrip: 'out'|'open'|'back'|null=null, registerStart=0
    const registerPos=new THREE.Vector3(),registerRot=new THREE.Quaternion(),registerCamera=new THREE.Vector3(),registerLook=new THREE.Quaternion()
    const registerDesk=new THREE.Vector3(), flatReader=new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI/2,0,0))
    let installedBooks: Props['books'] | undefined
    let installedSelection = '', seenInscription = latest.current.inscribedBook
    let naming = false
    let faceSeal: { start: number; yaw: number; pitch: number; turn: number; tilt: number } | null = null
    const slotPoint = new THREE.Vector3()
    const busy = () => entrance !== null || animation !== null || registerTrip !== null ||
      naming || latest.current.inscribing || f.libraryShelf.binding
    function displayLibrary(books: Props['books'], selected: string) {
      f.libraryShelf.sync(books, selected)
      const origin = f.libraryShelf.dockFor(selected)
      if (origin) {
        dock.rotation.copy(f.shelfRotation)
        dock.scale = folioScale
        dock.center.copy(closedCoverCenter).multiplyScalar(dock.scale).applyQuaternion(dock.rotation).add(origin)
        if (!carrying && !reading && !animation) placeBook(f.book, dock)
      }
      finish?.setTitle(books.find(book => book.id === selected)?.name || '')
      installedBooks = books
      installedSelection = selected
      renderer.shadowMap.needsUpdate = true
      dirty = true
    }
    function emit() {
      const state = { entered, paused, carrying, busy: busy(), ready },
        json = JSON.stringify(state)
      if (json !== lastStatus) {
        lastStatus = json
        latest.current.onStatus(state)
      }
    }
    function available(name: RoomObject) {
      if (paused || busy() || reading || latest.current.bookAway) return false
      if (!entered) return name === 'door'
      if (name === 'inscribe' || name === 'register' || name.startsWith('volume:')) return ready && !carrying
      return name === 'shelf' || name === 'window' || (name === 'desk' && carrying)
    }
    function objectFor(name: RoomObject) {
      if (name === 'register') return f.manager
      if (name === 'inscribe') return f.libraryShelf.seal
      if (name.startsWith('volume:')) return f.libraryShelf.objectFor(name.slice(7)) || f.book
      return name === 'door'
        ? doorway.leaf
        : name === 'shelf'
          ? f.shelf
          : name === 'desk'
            ? f.desk
            : f.windowFrame
    }
    function highlight() {
      let target: RoomObject | null = null,
        objects: THREE.Object3D[] = []
      if (keyboardFocus && available(keyboardFocus)) {
        target = keyboardFocus
        objects = [objectFor(target)]
      } else if (hasPointer && !busy() && !paused && !reading && !latest.current.bookAway) {
        ray.setFromCamera(pointer, camera)
        const hits = entered
          ? ray.intersectObjects(carrying ? meshes : roomAndBook.concat(f.libraryShelf.pickMeshes), false)
          : ray.intersectObject(doorway.leaf, true)
        if (hits.length) {
          for (let node: THREE.Object3D | null = hits[0].object; node; node = node.parent) {
            const volume = f.libraryShelf.idOf(node)
            if (volume) { target = `volume:${volume}`; node = f.libraryShelf.objectFor(volume) || node }
            else if (node === f.libraryShelf.seal) target = 'inscribe'
            else if (node === f.manager) target = 'register'
            else if (node === doorway.leaf) target = 'door'
            else if (node === f.shelf || node === f.book) target = 'shelf'
            else if (node === f.desk || node === f.chair) target = 'desk'
            else if (node === f.windowFrame) target = 'window'
            if (target) {
              if (available(target)) objects = [node]
              else target = null
              break
            }
          }
        }
      }
      if (target === 'shelf' && !carrying && objects[0] === f.shelf) objects.push(f.book)
      current = target
      outline.selectedObjects = objects
      canvas.style.cursor = target ? 'pointer' : 'default'
    }
    const clearKeys = () => {
      if (drag) {
        const id = drag.id
        drag = null
        if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id)
      }
      keys.clear()
      walk.stop()
      if (document.pointerLockElement === canvas) document.exitPointerLock()
    }
    function startMotion(kind: NonNullable<typeof animation>) {
      animation = kind
      animationStart = performance.now()
      readBookPose(f.book, departure)
      departureOpening = f.bookOpening
      bookCasters.forEach((mesh) => {
        mesh.castShadow = false
      })
      renderer.shadowMap.needsUpdate = true
      keys.clear()
      walk.stop()
      dirty = true
      emit()
    }
    function openInscription() {
      f.libraryShelf.seal.getWorldPosition(slotPoint).project(camera)
      latest.current.onInscribe({ x: (slotPoint.x + 1) / 2, y: (1 - slotPoint.y) / 2 })
    }
    function activate(name: RoomObject) {
      if (!available(name)) return
      if (latest.current.soundEnabled) sound.unlock()
      keyboardFocus = null
      canvas.focus({ preventScroll: true })
      if (name === 'door') {
        entrance = performance.now()
        dirty = true
        emit()
        return
      }
      absorbGaze()
      if (name === 'inscribe') {
        naming = true
        inscriptionOpened.current = false
        clearKeys()
        f.libraryShelf.seal.getWorldPosition(slotPoint).project(camera)
        if (slotPoint.z < -1 || slotPoint.z > 1 || Math.abs(slotPoint.x) > 0.9 || Math.abs(slotPoint.y) > 0.85) {
          f.libraryShelf.seal.getWorldPosition(slotPoint).sub(camera.position).normalize()
          const targetYaw = Math.atan2(-slotPoint.x, -slotPoint.z)
          faceSeal = {
            start: performance.now(), yaw, pitch,
            turn: Math.atan2(Math.sin(targetYaw - yaw), Math.cos(targetYaw - yaw)),
            tilt: Math.asin(THREE.MathUtils.clamp(slotPoint.y, -1, 1)) - pitch,
          }
        } else openInscription()
        dirty = true
        emit()
        return
      }
      if (name.startsWith('volume:')) {
        const id = name.slice(7)
        if (!latest.current.books.some(b => b.id === id)) return
        latest.current.onSelectBook(id)
        displayLibrary(latest.current.books, id)
        startMotion('take')
        return
      }
      if (name === 'window') {
        windowGoal = 1 - windowGoal
        dirty = true
        return
      }
      if(name==='register'){
        clearKeys();scene.attach(f.manager);registerPos.copy(f.manager.position);registerRot.copy(f.manager.quaternion)
        registerCamera.copy(camera.position);registerLook.copy(camera.quaternion);registerDesk.copy(f.deskPosition);registerDesk.y+=.013
        registerTrip='out';registerStart=performance.now();registerOpened.current=false;dirty=true;emit();return
      }
      if (name === 'shelf') {
        startMotion(carrying ? 'return' : 'take')
        return
      }
      standingEye.copy(eyePosition)
      standingView.copy(camera.quaternion)
      besideChair.copy(readingEye).y = standingEye.y
      deskward.subVectors(f.deskPosition, readingEye).setY(0).normalize()
      deskLook.setFromRotationMatrix(new THREE.Matrix4().lookAt(besideChair, f.deskPosition, camera.up))
      reading = true
      enteredCapture = document.pointerLockElement === canvas
      clearKeys()
      latest.current.onOpen()
    }
    function resume(capture = false) {
      if (!entered || reading) return
      paused = false
      canvas.focus({ preventScroll: true })
      emit()
      dirty = true
      if (capture) {
        try {
          canvas.requestPointerLock?.()?.catch(() => {})
        } catch {
          /* Drag stays available. */
        }
      }
    }
    latest.current.controlsRef.current = {
      unlockSound: sound.unlock,
      activate,
      resume,
      focus(name) {
        keyboardFocus = name
        if (name && entered && !reading && !busy()) absorbGaze()
        dirty = true
      },
      press(key) {
        if (entered && !paused && !reading && !busy()) {
          if (latest.current.soundEnabled) sound.unlock()
          keys.add(key)
        }
      },
      release(key) {
        keys.delete(key)
      },
    }
    void room.ready
      .then(() => {
        if (disposed) return
        scene.updateMatrixWorld(true)
        const folioMeshes = new Set<THREE.Object3D>()
        f.book.traverseVisible((node) => {
          folioMeshes.add(node)
          if (node instanceof THREE.Mesh && node.castShadow) bookCasters.push(node)
        })
        scene.traverseVisible((node) => {
          if (!(node instanceof THREE.Mesh)) return
          for (let parent: THREE.Object3D | null = node; parent; parent = parent.parent) {
            if (parent === f.libraryShelf.books) return
          }
          roomAndBook.push(node)
          if (!folioMeshes.has(node)) meshes.push(node)
        })
        player = createPlayerAvatar(f.playerModel, insideEye.y)
        handModel=readingHand(f.playerModel, software)
        finish = finishFolio(renderer, scene, f.book, f.playerModel, room.linen)
        scene.add(f.playerModel, magic.dust)
        readBookPose(f.book, dock)
        f.shelf.getWorldDirection(shelfFacing)
        desktop.scale = hover.scale = folioScale
        desktop.center.copy(closedCoverCenter).multiplyScalar(folioScale).add(f.deskPosition)
        player.seatedEye(f.seatPosition, f.readingTarget, readingEye)
        f.openBook(1)
        deskRig = createDeskReading(f.book, f.deskPosition, readingEye, () => { dirty = true })
        f.openBook(0)
        deskRig.resize(mount.clientWidth, mount.clientHeight)
        latest.current.onReadingRig(deskRig)
        ready = true
        dirty = true
        renderer.shadowMap.needsUpdate = true
        emit()
      })
      .catch(() => fallback())
    function resize() {
      const w = Math.max(1, mount!.clientWidth),
        h = Math.max(1, mount!.clientHeight)
      camera.aspect = w / h
      desktopFov = Math.max(53, THREE.MathUtils.radToDeg(2 * Math.atan(0.82 / (2.79 * camera.aspect))))
      deskRig?.resize(w, h)
      camera.fov = reading && deskRig ? deskRig.view.fov : entered ? 67 : desktopFov
      camera.updateProjectionMatrix()
      renderer.setSize(w, h, false)
      composer.setSize(w, h)
      dirty = true
    }
    const observer = new ResizeObserver(resize)
    observer.observe(mount)
    resize()
    const obstacles = [
      [-3.94, -2.62, -1.5, 1.4],
      [-2.55, -0.1, -3.49, -2.82],
      [1.42, 3.34, -3.18, -2.26],
      [1.95, 2.7, -2.21, -1.44],
      [-3.65, -2.97, -2.2, -1.5],
      [-3.08, -2.22, 1.35, 2.2],
    ]
    const canStand = (x: number, z: number) =>
      Math.abs(x) < 3.68 &&
      Math.abs(z) < 3.18 &&
      (doorClosing === null || doorClearsPerson(doorway.leaf.rotation.y, x, z)) &&
      !obstacles.some(([a, b, c, d]) => x > a - 0.17 && x < b + 0.17 && z > c - 0.17 && z < d + 0.17)
    let drag: { id: number; x: number; y: number; travel: number } | null = null
    function aim(e: PointerEvent) {
      keyboardFocus = null
      hasPointer = true
      const r = canvas.getBoundingClientRect()
      if (document.pointerLockElement === canvas) pointer.set(0, 0)
      else pointer.set((2 * (e.clientX - r.left)) / r.width - 1, 1 - (2 * (e.clientY - r.top)) / r.height)
      dirty = true
    }
    function pointerDown(e: PointerEvent) {
      if (e.button !== 0 || paused || reading || busy()) return
      aim(e)
      absorbGaze()
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, travel: 0 }
      canvas.setPointerCapture(e.pointerId)
    }
    function pointerMove(e: PointerEvent) {
      aim(e)
      if (!entered || paused || reading || busy()) return
      if (!drag && document.pointerLockElement !== canvas && e.pointerType !== 'touch' && !reduced.matches)
        gaze.aim(pointer.x, pointer.y)
      let dx = 0,
        dy = 0
      if (document.pointerLockElement === canvas) {
        dx = e.movementX
        dy = e.movementY
      } else if (drag?.id === e.pointerId) {
        dx = e.clientX - drag.x
        dy = e.clientY - drag.y
        drag.travel += Math.abs(dx) + Math.abs(dy)
        drag.x = e.clientX
        drag.y = e.clientY
      }
      yaw -= dx * 0.0025
      pitch = THREE.MathUtils.clamp(pitch - dy * 0.0025, -1.47, 1.05)
    }
    function pointerUp(e: PointerEvent) {
      if (drag?.id !== e.pointerId) return
      const click = drag.travel < 6
      drag = null
      if (click) {
        aim(e)
        syncCamera()
        scene.updateMatrixWorld(true)
        highlight()
        if (current) activate(current)
      }
      if (e.pointerType === 'touch') {
        hasPointer = false
        dirty = true
      }
    }
    function pointerLeave() {
      if (!drag && document.pointerLockElement !== canvas) {
        absorbGaze()
        hasPointer = false
        dirty = true
      }
    }
    function pointerCancel() {
      absorbGaze()
      drag = null
      hasPointer = false
      dirty = true
    }
    function lostCapture() {
      if (drag) pointerCancel()
    }
    function pause() {
      if (!entered || reading || busy() || latest.current.bookAway) return
      absorbGaze()
      paused = true
      clearKeys()
      dirty = true
      emit()
    }
    function down(e: KeyboardEvent) {
      if (
        latest.current.bookAway ||
        reading ||
        (e.target as HTMLElement).closest('input,textarea,select,dialog')
      )
        return
      if (e.key === 'Escape') {
        pause()
        return
      }
      if (e.target instanceof HTMLButtonElement && (e.key === 'Enter' || e.key === ' ')) return
      if (!entered && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault()
        activate('door')
        return
      }
      if (paused || busy() || !entered) return
      if (e.code === 'KeyE') {
        e.preventDefault()
        if (!e.repeat) {
          if (!hasPointer) {
            pointer.set(0, 0)
            hasPointer = true
          }
          highlight()
          if (current) activate(current)
        }
      } else if (
        ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)
      ) {
        e.preventDefault()
        if (e.repeat && !keys.has(e.code)) return
        if (!e.repeat && latest.current.soundEnabled) sound.unlock()
        keys.add(e.code)
      }
    }
    const up = (e: KeyboardEvent) => {
      keys.delete(e.code)
    }
    const visibility = () => {
      if (document.hidden) pause()
    }
    const motionPreferenceChanged = () => { if (reduced.matches) absorbGaze(); dirty = true }
    const lockChange = () => {
      if (document.pointerLockElement === canvas) {
        absorbGaze()
        hasPointer = true
        pointer.set(0, 0)
        enteredCapture = true
      } else if (enteredCapture && !reading) {
        enteredCapture = false
        pause()
      }
      dirty = true
    }
    function animate(now: number) {
      if (disposed || unavailable.current) return
      frame = requestAnimationFrame(animate)
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000))
      last = now
      if (doorClosing !== null) {
        const next = reduced.matches ? 1 : Math.min(1, doorClosing + dt / closingSeconds)
        const angle = closingAngle(next)
        if (doorClearsPerson(angle, eyePosition.x, eyePosition.z)) {
          doorway.leaf.rotation.y = angle
          doorClosing = next === 1 ? null : next
          dirty = true
          if (next === 1) {
            renderer.shadowMap.needsUpdate = true
            if (latest.current.soundEnabled && !document.hidden) sound.latch()
          }
        }
      }
      const props = latest.current
      if (faceSeal) {
        const t = reduced.matches ? 1 : Math.min(1, (now - faceSeal.start) / 420)
        yaw = faceSeal.yaw + faceSeal.turn * ease(t)
        pitch = faceSeal.pitch + faceSeal.tilt * ease(t)
        syncCamera()
        dirty = true
        if (t === 1) { faceSeal = null; openInscription() }
      }
      if (ready && (installedBooks !== props.books || installedSelection !== props.selectedBook)) {
        displayLibrary(props.books, props.selectedBook)
      }
      const newlyBound = props.inscribedBook && seenInscription !== props.inscribedBook
      if (ready && newlyBound) {
        seenInscription = props.inscribedBook
        f.libraryShelf.startBinding(now)
        f.book.visible = false
        renderer.shadowMap.needsUpdate = true
      }
      if (naming && !props.inscribing && (inscriptionOpened.current || newlyBound)) {
        naming = false
        canvas.focus({ preventScroll: true })
        dirty = true
        emit()
      }
      if (f.libraryShelf.binding) {
        f.libraryShelf.tick(now, reduced.matches)
        if (!f.libraryShelf.binding) {
          f.book.visible = true
          renderer.shadowMap.needsUpdate = true
          emit()
        }
        dirty = true
      }
      let turningHead = false
      if (entered && hasPointer && !keyboardFocus && !paused && !reading && !busy() && !drag &&
          !latest.current.bookAway && document.pointerLockElement !== canvas && !reduced.matches) {
        const { glanceChanged, turn, tilt } = gaze.update(dt)
        const nextPitch = THREE.MathUtils.clamp(pitch + tilt, -1.47, 1.05)
        turningHead = glanceChanged || turn !== 0 || pitch !== nextPitch
        yaw += turn
        pitch = nextPitch
        if (turningHead) dirty = true
      }
      if(registerTrip && deskRig){
        if(registerTrip==='open'){
          if(!latest.current.managing&&registerOpened.current){registerTrip='back';registerStart=now}else return
        }
        const t=reduced.matches?1:Math.min(1,(now-registerStart)/1100), weight=ease(registerTrip==='out'?t:1-t)
        sampleRegisterFlight(f.manager, registerPos, registerRot, registerDesk, flatReader, registerTrip === 'out' ? t : 1 - t)
        const destination=registerDesk.clone().add(new THREE.Vector3(0,.39,.16)),look=new THREE.Matrix4().lookAt(destination,registerDesk,new THREE.Vector3(0,1,0))
        camera.position.lerpVectors(registerCamera,destination,weight);camera.quaternion.slerpQuaternions(registerLook,new THREE.Quaternion().setFromRotationMatrix(look),weight);camera.updateMatrixWorld()
        outline.selectedObjects = []
        renderer.shadowMap.needsUpdate = true
        renderer.clear()
        renderer.render(scene, camera)
        if(t===1){if(registerTrip==='out'){registerTrip='open';latest.current.onManage()}else{f.shelf.attach(f.manager);registerTrip=null;dirty=true;emit()}}
        return
      }
      let travel = 0
      if (entrance !== null) {
        if (!ready) entrance = now
        const t = ready && reduced.matches ? 1 : THREE.MathUtils.clamp((now - entrance) / 1850, 0, 1)
        doorway.leaf.rotation.y = ease(t / 0.71) * doorSwing
        const previousZ = eyePosition.z
        eyePosition.lerpVectors(startEye, insideEye, ease((t - 0.13) / 0.87))
        travel = previousZ - eyePosition.z
        yaw = 0.09 * ease(t)
        pitch = THREE.MathUtils.lerp(-0.123, -0.06, ease(t))
        camera.fov = THREE.MathUtils.lerp(desktopFov, 67, ease(t))
        camera.updateProjectionMatrix()
        syncCamera()
        dirty = true
        if (t === 1) {
          entrance = null
          doorClosing = 0
          entered = true
          hasPointer = false
          renderer.shadowMap.needsUpdate = true
          emit()
        }
      }
      if (windowGoal !== windowAmount) {
        const step = reduced.matches ? 1 : dt / 2
        windowAmount +=
          Math.sign(windowGoal - windowAmount) * Math.min(step, Math.abs(windowGoal - windowAmount))
        f.openWindow(windowAmount)
        dirty = true
        renderer.shadowMap.needsUpdate = true
      }
      const j = latest.current.journey
      if (j && j !== lastJourney) {
        lastJourney = j
        startMotion(j.direction)
      } else if (!j) lastJourney = null
      if (entered && !paused && !busy() && !reading) {
        const turn = Number(keys.has('ArrowLeft')) - Number(keys.has('ArrowRight'))
        const forward =
          Number(keys.has('KeyW') || keys.has('ArrowUp')) - Number(keys.has('KeyS') || keys.has('ArrowDown'))
        const side = Number(keys.has('KeyD')) - Number(keys.has('KeyA'))
        yaw += turn * dt * 1.6
        travel = walk.advance(eyePosition, yaw, forward, side, dt, canStand)
        if (turn || travel) dirty = true
        syncCamera()
      }
      const kind = animation
      const isJourney = kind === 'out' || kind === 'back'
      const duration = isJourney ? deskJourneyMs : kind === 'return' ? 1570 : 1840
      const clock = reduced.matches ? 1 : THREE.MathUtils.clamp((now - animationStart) / duration, 0, 1)
      const t = ease(clock)
      const shelfTiming = kind === 'take' || kind === 'return'
        ? shelfFlightTiming(kind === 'take' ? clock : 1 - clock) : null
      let seated = reading ? 1 : 0,
        casting = carrying && !reading ? 1 : 0,
        flourish = 0
      // Travel on a closed case, land on the wood, then unfold about the bound spine.
      // Standing up follows the same path in reverse.
      const deskTime = isJourney ? (kind === 'out' ? clock : 1 - clock) : reading ? 1 : 0
      const pose = isJourney ? deskSeatPose(deskTime) : reading ? readingPose : standingPose
      const opening = pose.opening
      if (deskRig && (isJourney || reading) && (dirty || kind || deskRig.moving)) {
        deskRig.sample(dt, opening, reduced.matches || (kind === 'out' && clock < 0.1))
        deskRig.contact(pose.contact, opening)
        dirty = true
      }
      if (isJourney && deskRig) {
        const out = kind === 'out'
        seated = pose.seated
        casting = pose.handRaised
        eyePosition.lerpVectors(standingEye, besideChair, pose.approach)
        eyePosition.y = THREE.MathUtils.lerp(standingEye.y, readingEye.y, seated) - 0.018 * pose.settle
        eyePosition.addScaledVector(deskward, 0.045 * Math.sin(Math.PI * seated))
        camera.quaternion.slerpQuaternions(standingView, deskLook, pose.faceDesk).slerp(deskRig.view.quaternion, pose.lean)
        camera.fov = THREE.MathUtils.lerp(67, deskRig.view.fov, pose.lean)
        camera.updateProjectionMatrix()
        camera.updateMatrixWorld()
        f.openBook(opening + (out ? departureOpening * (1 - ease(clock / 0.25)) : 0))
      } else if (shelfTiming) {
        casting = shelfTiming.reach
        flourish = shelfTiming.beckon
      } else if (reading && deskRig && dirty) {
        camera.quaternion.copy(deskRig.view.quaternion)
        camera.fov = deskRig.view.fov
        camera.updateProjectionMatrix()
        camera.updateMatrixWorld()
      }
      aimTarget.set(0, 0)
      if (carrying && !reading && !kind && hasPointer && !keyboardFocus && !drag && !reduced.matches) {
        aimTarget.copy(pointer).clampScalar(-1, 1)
      }
      if (!paused && !palmAim.equals(aimTarget)) {
        palmAim.lerp(aimTarget, 1 - Math.exp(-18 * dt))
        if (reduced.matches || palmAim.distanceToSquared(aimTarget) < 1e-7) palmAim.copy(aimTarget)
        dirty = true
      }
      if (player && (dirty || kind || player.stepping)) {
        const contact = player.update(camera, eyePosition, travel, dt, seated, casting, reduced.matches, flourish, palmAim)
        if (contact && latest.current.soundEnabled && !document.hidden && !paused && !kind) {
          sound.footstep(eyePosition.x, eyePosition.z, Math.abs(travel) / Math.max(.001, dt))
        }
        // Looking down can move the eye ahead of the standing collision footprint.
        eyeRay.ray.direction.subVectors(camera.position, eyePosition)
        const lean = eyeRay.ray.direction.length()
        if (lean > 0.001) {
          eyeRay.ray.origin.copy(eyePosition)
          eyeRay.ray.direction.divideScalar(lean)
          eyeRay.far = lean + camera.near
          const obstacle = eyeRay.intersectObjects(meshes, false)[0]
          if (obstacle) {
            camera.position
              .copy(eyePosition)
              .addScaledVector(eyeRay.ray.direction, Math.max(0, obstacle.distance - camera.near))
            camera.updateMatrixWorld()
          }
        }
        if (deskRig && deskTime > 0) {
          // The avatar's hips stay on the cushion while the reader leans over the desk.
          camera.position.addScaledVector(readingLean.subVectors(deskRig.view.position, readingEye), pose.lean)
          camera.updateMatrixWorld()
        }
        dirty = true
      }
      const stillMoving = (carrying && !reading && follower.moving) || magic.drifting
      if (stillMoving && !paused && !document.hidden && now - lastMagicPaint >= (software ? 1000 / 30 : 1000 / 60) - 1) dirty = true
      if (player && (casting > 0 || kind)) {
        viewRight.setFromMatrixColumn(camera.matrixWorld, 0)
        player.hoverTarget(hover.center, hover.rotation)
      }
      if (kind && player) {
        f.book.visible = true
        if (shelfTiming) {
          shelfFlight(dock, kind === 'return' ? departure : hover, shelfFacing, viewRight, shelfTiming, flying)
          const air = reduced.matches || clock === 1 ? 0 : 0.082 * shelfTiming.settle
          f.openBook(air + (kind === 'return' ? departureOpening * shelfTiming.flight : 0))
        } else {
          const target = kind === 'out' ? desktop : hover
          const landing = pose.landing
          const flight = kind === 'out' ? landing : 1 - landing
          flying.center.lerpVectors(departure.center, target.center, flight)
          flying.center.y += 0.16 * Math.sin(Math.PI * flight)
          flying.rotation.slerpQuaternions(departure.rotation, target.rotation, flight)
          flying.scale = THREE.MathUtils.lerp(departure.scale, target.scale, flight)
        }
        placeBook(f.book, flying)
        dirty = true
        if (t === 1) {
          animation = null
          if (kind === 'out') {
            // The paper stacks keep moving as the reader turns leaves. Cache only stationary boards.
            bookCasters.forEach(mesh => {
              mesh.castShadow = mesh.name.startsWith('Cover_') || !!mesh.parent?.name.startsWith('Cover_')
            })
            latest.current.onReveal()
            latest.current.onFinish()
          } else if (kind === 'return') {
            carrying = false
            bookCasters.forEach((mesh) => {
              mesh.castShadow = true
            })
          } else {
            carrying = true
            follower.reset(flying)
            if (kind === 'back') {
              reading = false
              enteredCapture = false
              latest.current.onFinish()
            }
          }
          renderer.shadowMap.needsUpdate = true
          emit()
        }
      } else if (carrying && !reading && !paused && !document.hidden) {
        follower.update(hover, viewRight, dt, reduced.matches, flying)
        placeBook(f.book, flying)
        f.openBook(follower.boardLift)
      }
      if(reading&&deskRig&&!kind&&!latest.current.managing){
        const next=latest.current.hand
        if(next&&next.seq!==lastHand){lastHand=next.seq;if(!reduced.matches)handModel?.play(next,now)}
        handModel?.draw(now,deskRig,camera,mount!.clientWidth,mount!.clientHeight)
      }else handModel?.hide()
      if (!dirty) return
      const elapsed = paused || document.hidden ? 0 : Math.min(0.1, (now - lastMagicPaint) / 1000)
      lastMagicPaint = now
      const ratio = Math.min(
        window.devicePixelRatio || 1,
        software ? (busy() || turningHead || keys.size > 0 || (drag?.travel ?? 0) > 0 ? (carrying || kind ? 0.8 : 0.6) : 1) : 1.5
      )
      if (pixelRatio !== ratio) {
        pixelRatio = ratio
        renderer.setPixelRatio(ratio)
        composer.setPixelRatio(ratio)
      }
      if (player) {
        const active = Boolean(kind && clock < 1) || (carrying && !reading)
        const focalPixels = canvas.height * camera.projectionMatrix.elements[5] * 0.5
        magic.update(flying, elapsed, active, reduced.matches, focalPixels)
        finish?.shadePalm(flying, active)
      }
      scene.updateMatrixWorld(true)
      if (reading && deskRig) deskRig.project(camera, f.bookOpening)
      highlight()
      renderer.setRenderTarget(null)
      renderer.clear()
      if (outline.selectedObjects.length) composer.render()
      else renderer.render(scene, camera)
      dirty = false
    }
    frame = requestAnimationFrame(animate)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', pause)
    document.addEventListener('visibilitychange', visibility)
    reduced.addEventListener('change', motionPreferenceChanged)
    document.addEventListener('pointerlockchange', lockChange)
    canvas.addEventListener('pointerdown', pointerDown)
    canvas.addEventListener('pointermove', pointerMove)
    canvas.addEventListener('pointerup', pointerUp)
    canvas.addEventListener('pointerleave', pointerLeave)
    canvas.addEventListener('pointercancel', pointerCancel)
    canvas.addEventListener('lostpointercapture', lostCapture)
    canvas.addEventListener('webglcontextlost', fallback)
    return () => {
      disposed = true
      clearKeys()
      observer.disconnect()
      cancelAnimationFrame(frame)
      latest.current.controlsRef.current = null
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', pause)
      document.removeEventListener('visibilitychange', visibility)
      reduced.removeEventListener('change', motionPreferenceChanged)
      document.removeEventListener('pointerlockchange', lockChange)
      canvas.removeEventListener('pointerdown', pointerDown)
      canvas.removeEventListener('pointermove', pointerMove)
      canvas.removeEventListener('pointerup', pointerUp)
      canvas.removeEventListener('pointercancel', pointerCancel)
      canvas.removeEventListener('lostpointercapture', lostCapture)
      canvas.removeEventListener('pointerleave', pointerLeave)
      canvas.removeEventListener('webglcontextlost', fallback)
      f.playerModel.removeFromParent()
      magic.dust.removeFromParent()
      magic.dispose()
      sound.dispose()
      handModel?.dispose()
      deskRig?.dispose()
      finish?.dispose()
      doorway.dispose()
      room.dispose()
      outline.dispose()
      output.dispose()
      composer.dispose()
      renderer.dispose()
      canvas.remove()
    }
  }, [])
  return <div ref={host} className="walk-canvas" />
}
