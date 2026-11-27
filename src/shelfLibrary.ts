import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { makeBindingSeal, sealStation, shelfDeck } from './shelfMounts'
import { drawSpineTitle } from './spineTitle'

export type ShelfEntry = { id: string; name: string }
const folioHeight = .160, folioWidth = .020, depth = .107
const front = .139
// Each entry is a spine centre and the top face of its actual shelf board.
// Leave the GLB's decorative bindings, book stops, blank and reader in their own bays.
const slots = [new THREE.Vector3(.045, shelfDeck, front)]
function row(y: number, from: number, to: number) {
  for (let x = from; x <= to + .00001; x += .037) slots.push(new THREE.Vector3(x, y, front))
}
row(shelfDeck, .108, .215)
row(shelfDeck, -.089, -.014)
row(.796, -.191, .205)
row(1.500, -.198, .206)
row(1.500, .315, .685)
row(.796, -.395, -.300)
row(.444, -.680, -.318)
row(.444, -.202, .200)
row(.444, .317, .681)
row(.092, .321, .680)
row(.092, -.670, -.319)
export const shelfCapacity = slots.length

function box(w: number, h: number, d: number, x: number, y: number, z: number) {
  return new THREE.BoxGeometry(w, h, d).translate(x, y, z)
}
function leafletGeometry() {
  const panels = [
    box(.0015, folioHeight, depth, -.00925, .080, -depth / 2),
    box(.0015, folioHeight, depth, .00925, .080, -depth / 2),
    box(folioWidth, folioHeight, .003, 0, .080, 0),
  ]
  const merged = mergeGeometries(panels)!
  panels.forEach(p => p.dispose())
  return merged
}

export function createShelfLibrary(shelf: THREE.Group) {
  const seal = makeBindingSeal()
  seal.position.copy(sealStation)
  const books = new THREE.Group()
  books.name = 'Library bindings'
  shelf.add(books, seal)
  const cloth = new THREE.MeshStandardMaterial({ color: '#65745a', roughness: .85 })
  const paper = new THREE.MeshStandardMaterial({ color: '#e5d7b8', roughness: .91 })
  const coverGeometry = leafletGeometry()
  const paperGeometry = box(.017, .1555, .103, 0, .080, -.052)
  const ticketGeometry = new THREE.PlaneGeometry(.015, .081).translate(0, .104, .00165)
  const entries = new Map<string, { group: THREE.Group; title: string; label: THREE.MeshBasicMaterial }>()
  const locations = new Map<string, THREE.Vector3>()
  const pickMeshes: THREE.Mesh[] = []
  let chosen = ''
  let begun: number | undefined
  let fingerprint = ''
  function labelMaterial(name: string) {
    const image = drawSpineTitle(name)
    return new THREE.MeshBasicMaterial({ color: image ? '#f5efe2' : '#dfd1b4', map: image })
  }
  function clearLabel(surface: THREE.MeshBasicMaterial) { surface.map?.dispose(); surface.dispose() }
  function boundBook(id: string, name: string) {
    const group = new THREE.Group(), label = labelMaterial(name)
    group.name = name
    group.userData.shelfBookId = id
    const cover = new THREE.Mesh(coverGeometry, cloth), leaves = new THREE.Mesh(paperGeometry, paper)
    const ticket = new THREE.Mesh(ticketGeometry, label)
    cover.castShadow = leaves.castShadow = cover.receiveShadow = leaves.receiveShadow = true
    group.add(cover, leaves, ticket)
    books.add(group)
    return { group, label, title: name }
  }
  function sync(list: readonly ShelfEntry[], selected: string) {
    const index = Math.max(0, list.findIndex(v => v.id === selected))
    const start = Math.floor(index / slots.length) * slots.length
    const spread = list.slice(start, start + slots.length)
    const next = JSON.stringify([selected, ...spread.map(v => [v.id, v.name])])
    if (next === fingerprint) return
    fingerprint = next
    chosen = selected
    locations.clear()
    spread.forEach((v, i) => locations.set(v.id, slots[i]))
    for (const [id, entry] of entries) {
      if (locations.has(id) && entry.title === spread.find(v => v.id === id)?.name) continue
      entry.group.removeFromParent()
      clearLabel(entry.label)
      entries.delete(id)
    }
    pickMeshes.length = 0
    for (const v of spread) {
      let entry = entries.get(v.id)
      if (!entry) { entry = boundBook(v.id, v.name); entries.set(v.id, entry) }
      entry.group.position.copy(locations.get(v.id)!)
      entry.group.visible = v.id !== selected
      if (entry.group.visible) entry.group.traverse(n => { if (n instanceof THREE.Mesh) pickMeshes.push(n) })
    }
    books.updateWorldMatrix(true, true)
  }

  const forming = new THREE.Group()
  const signatureGeometry = new THREE.BoxGeometry(.0033, .1555, .103)
  const signatures = Array.from({ length: 5 }, () => {
    const part = new THREE.Mesh(signatureGeometry, paper)
    forming.add(part)
    return part
  })
  const coverBoardGeometry = new THREE.BoxGeometry(.0015, folioHeight, depth).translate(0, .080, -depth/2)
  const boards = [-1, 1].map(() => {
    const board = new THREE.Mesh(coverBoardGeometry, cloth)
    forming.add(board)
    return board
  })
  const formedSpine = new THREE.Mesh(box(folioWidth, folioHeight, .003, 0, .080, 0), cloth)
  forming.add(formedSpine)
  const formedLabel = new THREE.Mesh(ticketGeometry, cloth as THREE.Material)
  forming.add(formedLabel)
  const light = new THREE.PointsMaterial({ size: .006, color: '#ffe0a1', transparent: true, depthWrite: false })
  light.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <alphamap_fragment>',
      '#include <alphamap_fragment>\n diffuseColor.a *= 1.0 - smoothstep(0.16,0.5,length(gl_PointCoord-0.5));')
  }
  const sparksGeometry = new THREE.BufferGeometry()
  const sparks = new Float32Array(45 * 3)
  sparksGeometry.setAttribute('position', new THREE.BufferAttribute(sparks, 3).setUsage(THREE.DynamicDrawUsage))
  const motes = new THREE.Points(sparksGeometry, light)
  motes.frustumCulled = false
  books.add(forming, motes)
  forming.visible = motes.visible = false
  const ease = THREE.MathUtils.smootherstep
  let bindingId = ''
  function startBinding(now: number) {
    if (!locations.has(chosen)) return
    begun = now
    bindingId = chosen
    forming.visible = motes.visible = true
    formedLabel.material = entries.get(chosen)!.label
    tick(now, false)
  }
  function tick(now: number, reduced: boolean) {
    if (begun === undefined) return false
    const t = reduced ? 1 : Math.min(1, Math.max(0, (now - begun) / 1800))
    const slot = locations.get(bindingId)
    if (!slot || t === 1 || bindingId !== chosen) {
      forming.visible = motes.visible = false
      begun = undefined
      return true
    }
    const travel = ease(t, .39, .78), insertion = ease(t, .76, 1)
    const launchY = sealStation.y + .065
    // Finish all sideways motion outside the cabinet before crossing its front plane.
    forming.position.set(
      THREE.MathUtils.lerp(sealStation.x, slot.x, travel),
      THREE.MathUtils.lerp(launchY, slot.y + .012, travel) + .055 * Math.sin(Math.PI * travel) - insertion * .012,
      THREE.MathUtils.lerp(.352, slot.z, insertion))
    forming.rotation.set(0, -.47 * (1-travel), .09 * Math.sin(Math.PI * travel))
    signatures.forEach((part, i) => {
      const arrive = ease(t, .025 + i * .033, .25 + i * .028)
      const side = (i - 2) / 2
      part.position.set(side * .0068 + side * .044 * (1-arrive), .080 + (1-arrive) * .040, -.052 + (1-arrive) * .041)
      part.rotation.y = side * .32 * (1-arrive)
      part.scale.setScalar(ease(t, i * .030, .13 + i * .034))
    })
    const shut = ease(t, .19, .51)
    boards.forEach((board, i) => {
      const direction = i ? 1 : -1
      board.position.set(direction * (.00925 + (1-shut)*.009), 0, 0)
      board.rotation.y = direction * (1-shut) * -.65
      board.scale.setScalar(ease(t, .12, .31))
    })
    const spine = ease(t, .24, .47)
    formedSpine.scale.set(spine, spine, 1)
    formedLabel.visible = t > .43
    light.opacity = .84 * ease(t, 0, .10) * (1-ease(t,.72,.99))
    for (let i = 0; i < sparks.length/3; i++) {
      const u = (i * .6180339 + t * 1.3) % 1, curl = i * 2.4 + t * Math.PI * 4
      const radius = .012 + .06 * Math.sin(Math.PI*u) * (1-shut*.63)
      sparks[i*3] = forming.position.x + Math.cos(curl)*radius - travel*(1-insertion)*(1-u)*.08
      sparks[i*3+1] = forming.position.y + u * .175
      sparks[i*3+2] = forming.position.z + Math.sin(curl)*radius
      // A few grains leave the stamped cross and curl toward the folded signatures.
      if (i < 16 && t < .46) {
        const sealWeight = (1-u) * (1-ease(t,.22,.46))
        sparks[i*3] = THREE.MathUtils.lerp(sparks[i*3], sealStation.x+.004, sealWeight)
        sparks[i*3+1] = THREE.MathUtils.lerp(sparks[i*3+1], sealStation.y+.093, sealWeight)
        sparks[i*3+2] = THREE.MathUtils.lerp(sparks[i*3+2], sealStation.z+.015, sealWeight)
      }
    }
    sparksGeometry.attributes.position.needsUpdate = true
    return true
  }
  return {
    seal, books, pickMeshes, sync, startBinding, tick,
    get binding() { return begun !== undefined },
    objectFor(id: string) { return entries.get(id)?.group },
    idOf(node: THREE.Object3D): string | undefined {
      for (let part: THREE.Object3D | null = node; part && part !== books; part = part.parent)
        if (typeof part.userData.shelfBookId === 'string') return part.userData.shelfBookId
    },
    dockFor(id: string) {
      const slot = locations.get(id)
      // The supplied book pivots at the spine's left edge, halfway up the book.
      return slot && shelf.localToWorld(new THREE.Vector3(slot.x - folioWidth/2, slot.y + folioHeight/2, slot.z))
    },
    dispose() {
      for (const entry of entries.values()) clearLabel(entry.label)
      entries.clear()
      for (const geometry of [paperGeometry,coverGeometry,ticketGeometry,signatureGeometry,coverBoardGeometry,formedSpine.geometry,sparksGeometry]) geometry.dispose()
      cloth.dispose(); paper.dispose(); light.dispose()
      books.removeFromParent()
    }
  }
}
