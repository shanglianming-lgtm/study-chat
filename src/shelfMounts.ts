import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'

// Metres in OakBookcase coordinates. Shelf_03 is the board below the reading bay.
export const shelfDeck = 1.148
export const registerStation = new THREE.Vector3(.492, shelfDeck, .040)
export const sealStation = new THREE.Vector3(-.474, shelfDeck, .084)
const registerTilt = -.20
const cradleHeight = .012
const readerBack = -.0045
const readerBottom = -.1015

export function seatRegister(reader: THREE.Group) {
  reader.rotation.set(registerTilt, 0, 0)
  // Use the lowest rotated corner of the supplied reader, including its back cover.
  const bottom = readerBottom * Math.cos(registerTilt) - readerBack * Math.sin(registerTilt)
  reader.position.copy(registerStation)
  reader.position.y += cradleHeight - bottom
  reader.position.z += .025
}

function material(color: string, metalness = 0, roughness = .76) {
  return new THREE.MeshStandardMaterial({ color, metalness, roughness })
}
function part(parent: THREE.Object3D, geometry: THREE.BufferGeometry, surface: THREE.Material,
  x: number, y: number, z: number, name: string) {
  const mesh = new THREE.Mesh(geometry, surface)
  mesh.name = name
  mesh.position.set(x, y, z)
  mesh.castShadow = mesh.receiveShadow = true
  parent.add(mesh)
  return mesh
}
function board(parent: THREE.Object3D, width: number, height: number, depth: number,
  surface: THREE.Material, x: number, y: number, z: number, radius: number, name: string) {
  return part(parent, new RoundedBoxGeometry(width, height, depth, 2, radius), surface, x, y, z, name)
}

export function makeReaderCradle() {
  const root = new THREE.Group()
  root.name = 'Register cradle'
  const walnut = material('#62513b'), brass = material('#ae9567', .55, .4)
  board(root, .170, cradleHeight, .094, walnut, 0, cradleHeight / 2, .015, .004, 'Walnut foot')
  for (const x of [-.051, .051]) {
    board(root, .009, .025, .009, brass, x, .0135, .055, .0025, 'Front catch')
    const support = board(root, .011, .124, .009, walnut, x, .068, .023, .003, 'Back rest')
    support.rotation.x = registerTilt
  }
  return root
}

export function makeBindingSeal() {
  const root = new THREE.Group(), album = new THREE.Group()
  root.name = 'Bindery exemplar'
  const cloth = material('#435948'), edge = material('#d7c79d'), foil = material('#d2b580', .55, .36)
  const base = material('#77654e')
  board(root, .161, .012, .08, base, 0, .006, -.005, .003, 'Bindery stand')
  album.position.set(0, .014, .016)
  album.rotation.x = -.105
  root.add(album)
  board(album, .118, .153, .010, edge, 0, .0775, -.001, .001, 'Folded blank sheets')
  for (const z of [-.009, .007])
    board(album, .125, .159, .004, cloth, 0, .0795, z, .0015, 'Linen board')
  board(album, .007, .160, .019, cloth, -.059, .080, -.001, .003, 'Hinged spine')
  const bar = (w: number, h: number, x: number, y: number) =>
    board(album, w, h, .00065, foil, x, y, .0095, .00025, 'Gilt tooling')
  for (const y of [.021, .137]) bar(.086, .0012, .004, y)
  for (const x of [-.039, .047]) bar(.0012, .116, x, .079)
  // The crossed foil strokes are stamped into a small cartouche on the blank cover.
  const cartouche = part(album, new THREE.TorusGeometry(.022, .0007, 6, 44), foil,
    .004, .079, .0095, 'Binder’s cartouche')
  cartouche.scale.x = .94
  bar(.024, .0031, .004, .079)
  bar(.0031, .024, .004, .079)
  return root
}
