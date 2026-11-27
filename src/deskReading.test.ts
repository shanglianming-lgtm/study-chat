// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { describe, expect, it } from 'vitest'
import { createDeskReading, type PageSide } from './deskReading'

async function openFolio() {
  const bytes = readFileSync('public/assets/models/02_ProjectFolio.glb')
  const loader = new GLTFLoader().register(() => ({ name: 'geometry-only', loadTexture: async () => new THREE.Texture() }))
  const gltf = await loader.parseAsync(Uint8Array.from(bytes).buffer, '')
  const mixer = new THREE.AnimationMixer(gltf.scene)
  const action = mixer.clipAction(THREE.AnimationClip.findByName(gltf.animations, 'Book_Open')!).play()
  action.paused = true
  action.time = action.getClip().duration
  mixer.update(0)
  const desk = new THREE.Vector3(2.15, 1.007, -2.64)
  new THREE.Scene().add(gltf.scene)
  gltf.scene.position.copy(desk)
  const rig = createDeskReading(gltf.scene, desk, new THREE.Vector3(2.32, 1.49, -1.87), () => {})
  return { rig, book: gltf.scene, desk }
}

describe('ink on the supplied folio', () => {
  it.each([
    [1280, 720, 'spread', 0], [900, 450, 'spread', 0.6], [390, 844, 'right', 0.3], [618, 535, 'spread', 1],
  ] as const)('registers the printable corners under a %s × %s camera centred on %s', async (w, h, focus, fraction) => {
    const { book, rig } = await openFolio()
    const layer = document.createElement('section')
    rig.resize(w, h); rig.configure(fraction, focus); rig.sample(1, 1, true)
    book.updateMatrixWorld(true)
    rig.attach(layer); rig.project(rig.view)
    const leafW = parseFloat(layer.style.getPropertyValue('--leaf-width'))
    const leafH = parseFloat(layer.style.getPropertyValue('--leaf-height'))
    for (const side of ['left', 'right'] as PageSide[]) {
      const value = layer.style.getPropertyValue('--desk-' + side)
      const matrix = new THREE.Matrix4().fromArray(value.slice(9, -1).split(',').map(Number))
      const anchor = book.getObjectByName(side === 'left' ? 'PageAnchor_L' : 'PageAnchor_R')!
      for (const u of [0, 1]) for (const v of [0, 1]) {
        const onScreen = new THREE.Vector3(u * leafW, v * leafH, 0).applyMatrix4(matrix)
        const onPage = anchor.localToWorld(new THREE.Vector3((u - 0.5) * 0.146, (0.5 - v) * 0.222, 0.00008)).project(rig.view)
        expect(onScreen.x).toBeCloseTo((1 + onPage.x) * w / 2, 5)
        expect(onScreen.y).toBeCloseTo((1 - onPage.y) * h / 2, 5)
        if (focus === 'spread' || focus === side) {
          expect(Math.abs(onPage.x)).toBeLessThan(0.98)
          expect(Math.abs(onPage.y)).toBeLessThan(0.98)
        }
      }
    }
    rig.dispose()
  })

  it('moves the printed surfaces with the paper stacks, keeping both covers on the table', async () => {
    const { book, desk, rig } = await openFolio()
    const pageY = (side: string) => book.getObjectByName('PageAnchor_' + side)!
      .localToWorld(new THREE.Vector3((side === 'L' ? -1 : 1) * 0.1515 / 2, 0, 0)).y
    rig.configure(0, 'spread'); rig.sample(1, 1, true)
    const oldL = pageY('L'), oldR = pageY('R')
    rig.configure(1, 'spread'); rig.sample(1, 1, true)
    expect(pageY('L') - oldL).toBeCloseTo(0.0231, 4)
    expect(oldR - pageY('R')).toBeCloseTo(0.0231, 4)
    for (const name of ['Cover_Back', 'Cover_Front']) {
      const bounds = new THREE.Box3().setFromObject(book.getObjectByName(name)!, true)
      expect(Math.abs(bounds.min.y - desk.y)).toBeLessThan(0.0002)
    }
    rig.sample(1, 0, true)
    expect(book.getObjectByName('PaperStack_L')!.scale.y).toBeCloseTo(1)
    expect(book.getObjectByName('PaperStack_R')!.scale.y).toBeCloseTo(1)
    rig.dispose()
  })

  it.each([0, 0.5, 1])('keeps the actual book centred, upright and bound across the spread at fraction %s', async fraction => {
    const { rig, book } = await openFolio()
    rig.resize(1280, 720); rig.configure(fraction, 'spread'); rig.sample(1, 1, true)
    book.updateMatrixWorld(true)
    const ends: THREE.Vector3[][] = []
    for (const side of ['L', 'R']) {
      const gutter = book.getObjectByName('Gutter_' + side)!
      const paper = gutter.children.find(node => node instanceof THREE.Mesh && node.material.name.includes('unprinted')) as THREE.Mesh
      const pos = paper.geometry.getAttribute('position')
      const points = Array.from({ length: pos.count }, (_, i) => paper.localToWorld(new THREE.Vector3().fromBufferAttribute(pos, i)))
      const sign = side === 'L' ? -1 : 1
      const minX = Math.min(...points.map(p => sign * p.x))
      const seam = points.filter(p => Math.abs(sign * p.x - minX) < 0.00001).sort((a, b) => a.z - b.z)
      const head = seam[0], foot = seam[seam.length - 1]
      expect(foot.z - head.z).toBeCloseTo(0.232, 5)
      ends.push([head, foot])
      const anchor = book.getObjectByName('PageAnchor_' + side)!
      const left = anchor.localToWorld(new THREE.Vector3(-0.073, 0, 0))
      const right = anchor.localToWorld(new THREE.Vector3(0.073, 0, 0))
      expect(left.clone().project(rig.view).y).toBeCloseTo(right.clone().project(rig.view).y, 5)
      const baselineY = left.y + (right.y - left.y) * (head.x - left.x) / (right.x - left.x)
      expect(baselineY - head.y).toBeGreaterThan(0.0015)
      expect(baselineY - head.y).toBeLessThan(0.0025)
      expect(head.y - foot.y).toBeCloseTo(0.00064, 5)
      const nearest = points.filter(p => sign * p.x > minX + 0.0001 && Math.abs(p.z - head.z) < 1e-5).sort((a, b) => sign * (a.x - b.x))[0]
      expect(nearest.y).toBeGreaterThan(head.y)
    }
    for (let i = 0; i < 2; i++) {
      expect(ends[0][i].distanceTo(ends[1][i])).toBeLessThan(0.00001)
      expect(Math.abs(ends[0][i].project(rig.view).x * 640)).toBeLessThan(1)
    }
    const silhouette: THREE.Vector3[] = []
    for (const name of ['Cover_Front', 'Cover_Back', 'PaperStack_L', 'PaperStack_R']) {
      book.getObjectByName(name)!.traverse(mesh => {
        if (!(mesh instanceof THREE.Mesh)) return
        const pos = mesh.geometry.getAttribute('position')
        for (let i = 0; i < pos.count; i++)
          silhouette.push(mesh.localToWorld(new THREE.Vector3().fromBufferAttribute(pos, i)).project(rig.view))
      })
    }
    const top = Math.max(...silhouette.map(p => p.y)), bottom = Math.min(...silhouette.map(p => p.y))
    expect(top).toBeLessThan(0.99); expect(bottom).toBeGreaterThan(-0.99)
    expect(top - bottom).toBeGreaterThan(1.89)
    expect(Math.abs(top + bottom)).toBeLessThan(0.012)
    rig.dispose()
  })

  it('joins the lining and the trimmed page edges when open and restores the supplied mesh for shelving', async () => {
    const { rig, book } = await openFolio()
    const points = (mesh: THREE.Mesh) => {
      const pos = mesh.geometry.getAttribute('position')
      return Array.from({ length: pos.count }, (_, i) => mesh.localToWorld(new THREE.Vector3().fromBufferAttribute(pos, i)))
    }
    const linings = ['Endsheet_Front', 'Endsheet_Back'].map(name => book.getObjectByName(name) as THREE.Mesh)
    const originalLining = linings.map(mesh => points(mesh))
    const pageFaces = ['PageFace_L', 'PageFace_R'].map(name => book.getObjectByName(name) as THREE.Mesh)
    const originalFaces = pageFaces.map(mesh => points(mesh))
    rig.sample(1, 1, true)
    const left = points(linings[0]), right = points(linings[1])
    const spine = Math.max(...left.map(p => p.x))
    expect(spine).toBeCloseTo(Math.min(...right.map(p => p.x)), 5)
    for (let i = 0; i < 2; i++) {
      const lining = points(linings[i])
      lining.forEach((point, j) => expect(point.y).toBeCloseTo(originalLining[i][j].y, 6))
      const page = points(pageFaces[i])
      const innerX = (i ? Math.min : Math.max)(...page.map(p => p.x))
      const lip = page.filter(p => Math.abs(p.x - innerX) < 1e-7)
      expect(Math.max(...lip.map(p => p.z)) - Math.min(...lip.map(p => p.z))).toBeCloseTo(0.232, 5)
    }
    rig.sample(1, 0, true)
    for (let i = 0; i < 2; i++) {
      points(linings[i]).forEach((p, j) => expect(p.distanceTo(originalLining[i][j])).toBeLessThan(1e-7))
      points(pageFaces[i]).forEach((p, j) => expect(p.distanceTo(originalFaces[i][j])).toBeLessThan(1e-7))
    }
    rig.dispose()
  })

  it.each([true, false])('lands the moving sheet on the opposite cut edge, forward=%s', async forward => {
    const { book, rig } = await openFolio()
    rig.resize(1280, 720); rig.configure(0.25, 'spread'); rig.sample(1, 1, true)
    book.updateMatrixWorld(true)
    rig.project(rig.view)
    const cut = rig.cutSheet()
    const segments = cut.columns.map(() => document.createElement('div'))
    rig.startTurn(segments, forward, document.createElement('div'))
    const hingeAt = (time: number) => {
      rig.turnTo(time)
      const root = new THREE.Matrix4().fromArray(segments[0].style.transform.slice(9, -1).split(',').map(Number))
      return new THREE.Vector3(forward ? 0 : cut.columns[0].width, 0, 0).applyMatrix4(root)
    }
    expect(hingeAt(0).distanceTo(hingeAt(0.5))).toBeLessThan(0.00001)
    for (const progress of [0, 1]) {
      rig.turnTo(progress)
      const onRight = forward !== !!progress
      const anchor = book.getObjectByName(onRight ? 'PageAnchor_R' : 'PageAnchor_L')!
      const outer = anchor.localToWorld(new THREE.Vector3((onRight ? 1 : -1) * 0.1515 / 2, 0.232 / 2, 0.00008)).project(rig.view)
      const last = segments[segments.length - 1]
      const matrix = new THREE.Matrix4().fromArray(last.style.transform.slice(9, -1).split(',').map(Number))
      const screen = new THREE.Vector3(forward ? cut.columns[segments.length - 1].width : 0, 0, 0).applyMatrix4(matrix)
      expect(last.dataset.face).toBe(progress ? 'back' : 'front')
      expect(screen.x).toBeCloseTo((outer.x + 1) * 640, 2)
      expect(screen.y).toBeCloseTo((1 - outer.y) * 360, 2)
    }
    rig.dispose()
  })
})
