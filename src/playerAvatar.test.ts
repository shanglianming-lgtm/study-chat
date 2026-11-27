import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { createPlayerAvatar } from './playerAvatar'
import { bookPose, placeBook } from './bookFlight'

const data = readFileSync(new URL('../public/assets/models/White_Dress_Avatar.glb', import.meta.url))
const loader = new GLTFLoader().register(() => ({
  name: 'pose-test-textures',
  loadTexture: async () => new THREE.Texture(),
}))
let model: THREE.Group, player: ReturnType<typeof createPlayerAvatar>, camera: THREE.PerspectiveCamera
const position = (name: string) => model.getObjectByName(name)!.getWorldPosition(new THREE.Vector3())
const eye = new THREE.Vector3(0, 1.65, 2.35)

beforeEach(async () => {
  model = (await loader.parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), ''))
    .scene
  player = createPlayerAvatar(model, eye.y)
  camera = new THREE.PerspectiveCamera(67, 1, 0.045, 45)
})

describe('the user wears the supplied rig', () => {
  it('translates and turns the body with the player, keeping the feet planted when looking down', () => {
    player.update(camera, eye, 0, 0.016, 0, 0, false)
    const ankle = position('J_Bip_R_Foot')
    const shifted = eye.clone().add(new THREE.Vector3(1, 0, -2))
    player.update(camera, shifted, 0, 0.016, 0, 0, false)
    expect(position('J_Bip_R_Foot').sub(ankle).distanceTo(shifted.clone().sub(eye))).toBeLessThan(1e-6)
    const planted = position('J_Bip_R_Foot')
    camera.rotation.x = -1.45
    player.update(camera, shifted, 0, 0.016, 0, 0, false)
    expect(position('J_Bip_R_Foot').distanceTo(planted)).toBeLessThan(1e-6)
    expect(camera.position.z).toBeLessThan(shifted.z - 0.1)
    camera.rotation.set(0, Math.PI / 2, 0, 'YXZ')
    player.update(camera, shifted, 0, 0.016, 0, 0, false)
    expect(model.getWorldDirection(new THREE.Vector3()).x).toBeCloseTo(-1)
    const visible = new Set<THREE.Object3D>()
    model.traverseVisible((node) => visible.add(node))
    model.traverse((node) => {
      if (
        node.userData.firstPersonHidden ||
        (node instanceof THREE.Mesh && node.material.userData?.firstPersonHidden)
      ) {
        expect(visible.has(node)).toBe(false)
      }
    })
  })
  it('moves legs by distance travelled and seats the hips over the supplied cushion', () => {
    player.update(camera, eye, 0, 0.016, 0, 0, false)
    const left = position('J_Bip_L_Foot'),
      right = position('J_Bip_R_Foot')
    for (let i = 0; i < 8; i++) player.update(camera, eye, 0.03, 0.02, 0, 0, false)
    expect(Math.abs(position('J_Bip_L_Foot').z - left.z)).toBeGreaterThan(0.1)
    expect(position('J_Bip_R_Foot').z - right.z).toBeGreaterThan(0.1)
    player.update(camera, eye, 0.03, 0.02, 0, 0, true)
    expect(position('J_Bip_L_Foot').distanceTo(left)).toBeLessThan(1e-6)
    const seat = new THREE.Vector3(2.3, 0.643, -1.87),
      target = new THREE.Vector3(2.2, 1, -2.8)
    const seatedEye = new THREE.Vector3()
    player.seatedEye(seat, target, seatedEye)
    camera.position.copy(seatedEye)
    camera.lookAt(target)
    player.update(camera, seatedEye, 0, 0.016, 1, 0, false)
    const thigh = position('J_Bip_L_UpperLeg'),
      knee = position('J_Bip_L_LowerLeg')
    expect(thigh.y - seat.y).toBeCloseTo(0.065 * player.size, 3)
    expect(knee.z).toBeLessThan(thigh.z - 0.3)
    expect(knee.y - position('J_Bip_L_Foot').y).toBeGreaterThan(0.4)
  })
  it('lands each foot every 68 cm and keeps a level eye with reduced motion', () => {
    const contacts: number[] = []
    let lowest = Infinity, highest = -Infinity
    for (let i = 0; i < 144; i++) {
      const footfall = player.update(camera, eye, .02, 1 / 72, 0, 0, false)
      lowest = Math.min(lowest, camera.position.y)
      highest = Math.max(highest, camera.position.y)
      if (footfall) contacts.push(i)
    }
    expect(contacts).toHaveLength(4)
    for (let i = 1; i < contacts.length; i++) {
      expect(Math.abs((contacts[i] - contacts[i - 1]) * .02 - .68)).toBeLessThan(.021)
    }
    expect(highest - lowest).toBeGreaterThan(.02)
    expect(highest - lowest).toBeLessThan(.033)
    player.update(camera, eye, .02, 1 / 72, 0, 0, true)
    expect(camera.position.distanceTo(eye)).toBeLessThan(1e-6)
  })
  it('lets the open hand lead the folio even when the player just moves the cursor', () => {
    camera.aspect = 1.7
    const aim = new THREE.Vector2(-1, -1)
    for (let i = 0; i < 45; i++) player.update(camera, eye, 0, 1 / 60, 0, 1, false, 0, aim)
    const low = player.castingPalm.clone()
    aim.set(1, 1)
    for (let i = 0; i < 45; i++) player.update(camera, eye, 0, 1 / 60, 0, 1, false, 0, aim)
    expect(player.castingPalm.x - low.x).toBeGreaterThan(0.1)
    expect(player.castingPalm.y - low.y).toBeGreaterThan(0.09)
    const hover = bookPose()
    player.hoverTarget(hover.center, hover.rotation)
    expect(hover.center.x).toBe(player.castingPalm.x)
    expect(hover.center.z).toBe(player.castingPalm.z)
  })
  it('eases a cursor jump without overshooting and converges across frame rates', () => {
    camera.aspect = 1.7
    const aim = new THREE.Vector2(1, 1)
    player.update(camera, eye, 0, 1 / 60, 0, 1, false, 0, new THREE.Vector2())
    const start = player.castingPalm.clone()
    player.update(camera, eye, 0, 1 / 60, 0, 1, false, 0, aim)
    const first = player.castingPalm.clone()
    for (let i = 0; i < 60; i++) player.update(camera, eye, 0, 1 / 60, 0, 1, false, 0, aim)
    const end = player.castingPalm.clone()
    expect(first.distanceTo(start)).toBeGreaterThan(0)
    expect(first.distanceTo(start)).toBeLessThan(end.distanceTo(start) * 0.4)
    player.update(camera, eye, 0, 1 / 60, 0, 1, true, 0, new THREE.Vector2())
    for (let i = 0; i < 30; i++) player.update(camera, eye, 0, 1 / 30, 0, 1, false, 0, aim)
    expect(player.castingPalm.distanceTo(end)).toBeLessThan(0.00001)
  })
  it('keeps visible air between the actual hand and closed cover throughout the hover', async () => {
    const bytes = readFileSync(new URL('../public/assets/models/02_ProjectFolio.glb', import.meta.url))
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    const folio = await loader.parseAsync(buffer, '')
    const clip = THREE.AnimationClip.findByName(folio.animations, 'Book_Open')
    if (!clip) throw new Error('The folio must have its authored opening animation')
    const mixer = new THREE.AnimationMixer(folio.scene)
    mixer.clipAction(clip).play()
    mixer.setTime(0)
    const bounds = new THREE.Box3().setFromObject(folio.scene, true)
    const corners: THREE.Vector3[] = []
    for (const x of [bounds.min.x, bounds.max.x])
      for (const y of [bounds.min.y, bounds.max.y])
        for (const z of [bounds.min.z, bounds.max.z]) corners.push(new THREE.Vector3(x, y, z))

    const hand: { mesh: THREE.SkinnedMesh; index: number }[] = []
    model.traverseVisible((mesh) => {
      if (!(mesh instanceof THREE.SkinnedMesh)) return
      const joints = mesh.geometry.getAttribute('skinIndex'), weights = mesh.geometry.getAttribute('skinWeight')
      const isHand = mesh.skeleton.bones.map(b => /^J_Bip_R_(Hand|Thumb|Index|Middle|Ring|Little)/.test(b.name))
      for (let i = 0; i < joints.count; i++) {
        for (let j = 0; j < 4; j++) {
          if (weights.getComponent(i, j) > 0.2 && isHand[joints.getComponent(i, j)]) {
            hand.push({ mesh, index: i })
            break
          }
        }
      }
    })
    expect(hand.length).toBeGreaterThan(50)
    const book = new THREE.Object3D(), hover = bookPose()
    for (const [aspect, yaw, pitch, x, y] of [[0.62, -2, -0.27, -0.3, 0.2], [1.16, 0, -0.06, 0, 0], [1.8, 1.2, 0.18, 0.5, -0.2]]) {
      camera.aspect = aspect
      camera.updateProjectionMatrix()
      camera.rotation.set(pitch, yaw, 0, 'YXZ')
      for (let i = 0; i < 45; i++)
        player.update(camera, eye.clone().setX(yaw), 0.03, 0.02, 0, 1, false, 0, new THREE.Vector2(x, y))
      const palmNormal = position('J_Bip_R_Index1').sub(position('J_Bip_R_Little1'))
        .cross(position('J_Bip_R_Middle1').sub(position('J_Bip_R_Hand'))).normalize()
      expect(palmNormal.y).toBeGreaterThan(0.85)
      const surface = hand.map(({ mesh, index }) =>
        mesh.localToWorld(mesh.getVertexPosition(index, new THREE.Vector3()))
      )
      const topOfHand = Math.max(...surface.map(v => v.y))
      const topOnScreen = Math.max(...surface.map(v => v.project(camera).y))
      player.hoverTarget(hover.center, hover.rotation)
      placeBook(book, hover)
      const center = book.localToWorld(bounds.getCenter(new THREE.Vector3()))
      const palm = position('J_Bip_R_Index1').lerp(position('J_Bip_R_Little1'), 0.5)
        .lerp(position('J_Bip_R_Hand'), 0.4)
      expect(Math.hypot(center.x - palm.x, center.z - palm.z)).toBeLessThan(0.001)
      const cover = corners.map(c => book.localToWorld(c.clone()))
      expect(Math.min(...cover.map(v => v.y)) - topOfHand).toBeGreaterThan(0.035)
      expect(Math.min(...cover.map(v => v.project(camera).y)) - topOnScreen).toBeGreaterThan(0.12)
    }
  })
})
