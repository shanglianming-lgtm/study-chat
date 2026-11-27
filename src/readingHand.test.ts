import * as THREE from 'three'
import { afterEach, expect, it, vi } from 'vitest'
import { readingHand } from './readingHand'
import type { DeskReading } from './deskReading'

const createRenderer = vi.hoisted(() => vi.fn(() => { throw new Error('WebGL context rejected') }))
vi.mock('three', async (original) => ({ ...await original<typeof import('three')>(), WebGLRenderer: createRenderer }))
afterEach(() => vi.unstubAllGlobals())

it('leaves an unavailable decorative context disabled instead of retrying every idle frame or click', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  const avatar = new THREE.Group()
  const joints = ['Hand', 'Index1', 'Index3_end', 'Middle1', 'Ring1', 'Little1', 'Thumb1'].map((name, i) => {
    const bone = new THREE.Bone()
    bone.name = 'J_Bip_R_' + name
    bone.position.set((i - 3) * .01, i === 0 ? 0 : -.06, i === 6 ? .02 : 0)
    avatar.add(bone)
    return bone
  })
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, .01, 0, 0, 0, .01, 0], 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3))
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Array(12).fill(0), 4))
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4))
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial({ name: 'Skin' }))
  mesh.bind(new THREE.Skeleton(joints))
  avatar.add(mesh)
  const hand = readingHand(avatar), rig = {} as DeskReading, camera = new THREE.PerspectiveCamera()
  expect(() => {
    for (let frame = 0; frame < 20; frame++) {
      if (frame % 4 === 0) hand.play({ action: 'stroke', side: 'right', u: .5, v: .4, seq: frame }, frame * 16)
      hand.draw(frame * 16, rig, camera, 1280, 841)
    }
  }).not.toThrow()
  expect(createRenderer).toHaveBeenCalledTimes(1)
  hand.dispose()
  geometry.dispose()
  mesh.material.dispose()
})
