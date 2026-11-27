import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { createShelfLibrary, shelfCapacity } from './shelfLibrary'
import { shelfOrigin, shelfScale } from './studyFurnishings'
import { makeReaderCradle, registerStation, seatRegister } from './shelfMounts'

// Keep the exported transforms and actual vertices; only the image textures need a browser.
async function model(name: string) {
  const asset = readFileSync(new URL('../public/assets/models/' + name + '.glb', import.meta.url))
  const size = asset.readUInt32LE(12)
  const meta = JSON.parse(asset.toString('utf8', 20, 20 + size))
  for (const mesh of meta.meshes) for (const part of mesh.primitives) delete part.material
  delete meta.images; delete meta.textures; delete meta.materials
  const content = Buffer.from(JSON.stringify(meta))
  const length = (content.length+3) & ~3
  const header = Buffer.from(asset.subarray(0,20))
  const tail = asset.subarray(20+size)
  header.writeUInt32LE(20+length+tail.length, 8)
  header.writeUInt32LE(length,12)
  const file = Buffer.concat([header,content,Buffer.alloc(length-content.length,32),tail])
  return (await new GLTFLoader().parseAsync(Uint8Array.from(file).buffer, '')).scene
}

describe('physical bindings in the supplied oak cabinet', () => {
  const shelf = new THREE.Group(), manager = new THREE.Group()
  const library = createShelfLibrary(shelf)
  const cradle = makeReaderCradle()
  let cabinet: THREE.Group
  beforeAll(async () => {
    const [rack, device] = await Promise.all([model('01_OakBookcase'),model('Study_Library_Reader')])
    cabinet = rack
    manager.add(device)
    seatRegister(manager)
    cradle.position.copy(registerStation)
    shelf.add(rack, manager, cradle)
    shelf.position.copy(shelfOrigin); shelf.scale.setScalar(shelfScale)
    shelf.updateMatrixWorld(true)
  })
  it('seats the real rotated reader on the stand above the board, inside its empty bay', () => {
    const bounds = new THREE.Box3().setFromObject(manager,true)
    const slab = new THREE.Box3().setFromObject(cabinet.getObjectByName('Shelf_03')!,true)
    const next = new THREE.Box3().setFromObject(cabinet.getObjectByName('Shelf_04')!,true)
    const divider = new THREE.Box3().setFromObject(cabinet.getObjectByName('Divider_04_R')!,true)
    const side = new THREE.Box3().setFromObject(cabinet.getObjectByName('Side_R')!,true)
    const foot = new THREE.Box3().setFromObject(cradle.getObjectByName('Walnut foot')!,true)
    expect(bounds.min.y - slab.max.y).toBeGreaterThan(.016)
    expect(Math.abs(bounds.min.y - foot.max.y)).toBeLessThan(.0015)
    expect(bounds.max.y).toBeLessThan(next.min.y-.04)
    expect(bounds.min.x).toBeGreaterThan(divider.max.x+.025)
    expect(bounds.max.x).toBeLessThan(side.min.x-.025)
  })
  it('hits the seal, screen and newly bound spine before the cabinet from the entrance', () => {
    const list = [{id:'folio',name:'Folio'}, {id:'new',name:'New volume'}]
    library.sync(list,'folio')
    const eye = new THREE.Vector3(.05,1.65,2.35)
    for (const target of [manager, library.seal, library.objectFor('new')!]) {
      const point = new THREE.Box3().setFromObject(target,true).getCenter(new THREE.Vector3())
      if (target === library.objectFor('new')) point.z = library.dockFor('new')!.z
      const ray = new THREE.Raycaster(eye,point.sub(eye).normalize())
      const hit = ray.intersectObjects([cabinet, cradle, manager, library.seal, ...library.pickMeshes],true)[0]
      let object: THREE.Object3D | null = hit?.object
      while (object && object !== target) object = object.parent
      expect(object?.uuid).toEqual(target.uuid)
    }
    const destination = library.dockFor('new')!
    library.sync(list,'new')
    expect(library.dockFor('new')!.distanceTo(destination)).toBe(0)
    expect(library.pickMeshes.every(m => library.idOf(m) === 'folio')).toBe(true)
    library.startBinding(0)
    expect(library.binding).toBe(true)
    library.tick(900,false)
    expect(library.binding).toBe(true)
    library.tick(2000,false)
    expect(library.binding).toBe(false)
  })
  it('always allocates a reachable position to a new volume beyond the first cabinetful', () => {
    const books = Array.from({ length:shelfCapacity+2 }, (_,i)=>({id:'b'+i,name:'Book '+i}))
    const newest = books.at(-1)!
    library.sync(books,newest.id)
    expect(library.dockFor(newest.id)).toBeDefined()
    expect(library.dockFor('b0')).toBeUndefined()
    library.startBinding(100)
    library.tick(100,true)
    expect(library.binding).toBe(false)
  })
})
