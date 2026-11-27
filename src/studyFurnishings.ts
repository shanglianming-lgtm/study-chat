import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

import { createShelfLibrary } from './shelfLibrary'
import { makeReaderCradle, registerStation, seatRegister } from './shelfMounts'
import { environmentAt, clearWeather, type Environment } from './studyEnvironment'

export const shelfOrigin = new THREE.Vector3(-1.32, 0.01, -3.12)
export const windowOrigin = new THREE.Vector3(2.05, 0.045, -3.4)
export const shelfScale = 1.5
export const windowScale = 1.3
export const folioScale = 1

export function furnishStudy(scene: THREE.Scene) {
  const loader = new GLTFLoader()
  const shelf = new THREE.Group(),
    desk = new THREE.Group(),
    chair = new THREE.Group()
  const manager = new THREE.Group()
  const cradle = makeReaderCradle()
  cradle.position.copy(registerStation)
  seatRegister(manager)
  shelf.add(manager, cradle)
  const libraryShelf = createShelfLibrary(shelf)
  const windowFrame = new THREE.Group(),
    book = new THREE.Group(),
    nook = new THREE.Group()
  const shelfPosition = new THREE.Vector3(),
    shelfRotation = new THREE.Quaternion()
  const deskPosition = new THREE.Vector3(),
    seatPosition = new THREE.Vector3(),
    readingTarget = new THREE.Vector3()
  const skeletons = new Set<THREE.Skeleton>()
  const textures = new Set<THREE.Texture>(),
    materials = new Set<THREE.Material>(),
    geometries = new Set<THREE.BufferGeometry>()
  let dead = false

  nook.position.copy(windowOrigin)
  nook.scale.setScalar(windowScale)
  shelf.position.copy(shelfOrigin)
  shelf.scale.setScalar(shelfScale)
  book.scale.setScalar(folioScale)
  desk.position.set(0.25, 0, 0.52)
  chair.position.set(0.205, 0, 1.18)
  windowFrame.position.y = 0.88
  scene.add(shelf, nook, book)
  nook.add(desk, chair, windowFrame)

  async function mount(name: string, parent: THREE.Object3D) {
    const gltf = await loader.loadAsync('/assets/models/' + name + '.glb')
    gltf.scene.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return
      node.castShadow = node.receiveShadow = true
      node.geometry.computeBoundingBox()
      geometries.add(node.geometry)
      if (node instanceof THREE.SkinnedMesh) skeletons.add(node.skeleton)
      for (const m of Array.isArray(node.material) ? node.material : [node.material]) {
        materials.add(m)
        for (const value of Object.values(m)) if (value instanceof THREE.Texture) textures.add(value)
        if (m.transparent) node.castShadow = false
      }
    })
    if (dead) release()
    else parent.add(gltf.scene)
    return gltf
  }
  function release() {
    textures.forEach((t) => {
      t.dispose()
      if (typeof ImageBitmap !== 'undefined' && t.image instanceof ImageBitmap) t.image.close()
    })
    materials.forEach((m) => m.dispose())
    geometries.forEach((g) => g.dispose())
    skeletons.forEach((skeleton) => skeleton.dispose())
    skeletons.clear()
    textures.clear()
    materials.clear()
    geometries.clear()
  }

  let bookMixer: THREE.AnimationMixer | undefined, windowMixer: THREE.AnimationMixer | undefined
  let bookOpening = 0, bookDuration = 0,
    windowDuration = 0
  function pose(root: THREE.Object3D, clips: THREE.AnimationClip[], name: string) {
    const clip = THREE.AnimationClip.findByName(clips, name)
    if (!clip) throw new Error('Missing animation: ' + name)
    const mixer = new THREE.AnimationMixer(root),
      action = mixer.clipAction(clip)
    action.play()
    // Sample the authored opening in either direction, including its final key.
    action.paused = true
    return { mixer, duration: clip.duration, action }
  }
  let bookAction: THREE.AnimationAction | undefined, windowAction: THREE.AnimationAction | undefined
  function anchor(root: THREE.Object3D, name: string) {
    const node = root.getObjectByName(name)
    if (!node) throw new Error('Missing model anchor: ' + name)
    return node
  }

  const backdrop = new THREE.Group()
  backdrop.position.set(0.18, 1.56, -1.18)
  nook.add(backdrop)
  const musicPlayer = new THREE.Group()
  musicPlayer.position.set(0.47, 0.742, -0.14)
  musicPlayer.rotation.y = -0.24
  musicPlayer.position.add(desk.position)
  nook.add(musicPlayer)
  const decor = new THREE.Group()
  decor.position.set(-0.42, 1.9, 0.03)
  shelf.add(decor)
  // RoomScene attaches the wearer only after collecting the room's pickable meshes.
  const playerModel = new THREE.Group()
  const dayBackdrop = new THREE.Group(), duskBackdrop = new THREE.Group()
  backdrop.add(dayBackdrop, duskBackdrop)
  let environment = environmentAt(new Date(), clearWeather)
  function setEnvironment(next: Environment) {
    environment = next
    for (const [group, opacity] of [[dayBackdrop, next.day], [duskBackdrop, 1]] as const) {
      group.visible = opacity > .001
      group.traverse(node => {
        if (!(node instanceof THREE.Mesh)) return
        node.renderOrder = group === dayBackdrop ? -1 : -2
        for (const m of Array.isArray(node.material) ? node.material : [node.material]) {
          if (!(m instanceof THREE.MeshBasicMaterial)) continue
          m.transparent = true; m.depthWrite = false; m.opacity = opacity
          const tint = new THREE.Color('#ffffff').lerp(new THREE.Color('#8595a4'), next.cloud * .55)
          tint.multiplyScalar(.28 + next.day * .72)
          m.color.copy(tint)
        }
      })
    }
  }
  const ready = Promise.all([
    mount('01_OakBookcase', shelf),
    mount('02_ProjectFolio', book),
    mount('Study_Window', windowFrame),
    mount('Study_Desk', desk),
    mount('Study_Chair', chair),
    mount('Study_ShortWall', nook),
    Promise.all([mount('Exterior_Day', dayBackdrop), mount('Exterior_Dusk', duskBackdrop)]).then(() => setEnvironment(environment)),
    mount('03_DecorBindings', decor),
    mount('Study_Chat_Player', musicPlayer),
    mount('White_Dress_Avatar', playerModel),
    mount('Study_Library_Reader', manager),
  ]).then(([cabinet, folio, glazed, table, seat]) => {
    if (dead) return
    scene.updateMatrixWorld(true)
    const slot = anchor(cabinet.scene, 'Slot_Project_01')
    slot.getWorldPosition(shelfPosition)
    slot.getWorldQuaternion(shelfRotation)
    // Keep the foot on the shelf and the spine flush with the slot when the 24 cm folio is docked.
    shelfPosition.add(new THREE.Vector3(0, 0.015, 0.12)
      .multiplyScalar(shelfScale - folioScale).applyQuaternion(shelfRotation))
    book.position.copy(shelfPosition)
    book.quaternion.copy(shelfRotation)
    anchor(table.scene, 'Anchor_Book').getWorldPosition(deskPosition)
    anchor(seat.scene, 'Anchor_Seat').getWorldPosition(seatPosition)
    anchor(table.scene, 'Anchor_ReadingTarget').getWorldPosition(readingTarget)
    const folioPose = pose(folio.scene, folio.animations, 'Book_Open')
    bookMixer = folioPose.mixer
    bookAction = folioPose.action
    bookDuration = folioPose.duration
    const sashPose = pose(glazed.scene, glazed.animations, 'Window_Open')
    windowMixer = sashPose.mixer
    windowAction = sashPose.action
    windowDuration = sashPose.duration
    backdrop.traverse((node) => {
      if (node instanceof THREE.Mesh) node.castShadow = false
    })
  })
  return {
    shelf,
    libraryShelf,
    manager,
    desk,
    chair,
    windowFrame,
    book,
    shelfPosition,
    shelfRotation,
    deskPosition,
    seatPosition,
    playerModel,
    readingTarget,
    ready,
    setEnvironment,
    get bookOpening() { return bookOpening },
    openBook(amount: number) {
      if (bookAction && bookMixer && amount !== bookOpening) {
        bookOpening = amount
        bookAction.time = amount * bookDuration
        bookMixer.update(0)
      }
    },
    openWindow(amount: number) {
      if (windowAction && windowMixer) {
        windowAction.time = amount * windowDuration
        windowMixer.update(0)
      }
    },
    dispose() {
      dead = true
      libraryShelf.dispose()
      bookMixer?.stopAllAction()
      windowMixer?.stopAllAction()
      release()
    },
  }
}
