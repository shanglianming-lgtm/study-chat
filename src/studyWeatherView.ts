import * as THREE from 'three'
import type { Environment } from './studyEnvironment'

/** Precipitation lives outside the opening, so walls and sash occlude it naturally. */
export function createWeatherView(scene: THREE.Scene) {
  const count = 100, positions = new Float32Array(count * 6)
  const seeds = Array.from({ length: count }, (_, i) => {
    const noise = (v: number) => { const n = Math.sin(v * 127.1 + 311.7) * 43758.5453; return n - Math.floor(n) }
    return [noise(i + 1), noise(i + 155), noise(i + 380)]
  })
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const rainMaterial = new THREE.LineBasicMaterial({ color: '#c5d1dd', transparent: true, opacity: 0, depthWrite: false })
  const rain = new THREE.LineSegments(geometry, rainMaterial)
  rain.frustumCulled = false; rain.name = 'Rain outside the window'; scene.add(rain)
  const snowPositions = new Float32Array(count * 3)
  const snowGeometry = new THREE.BufferGeometry()
  snowGeometry.setAttribute('position', new THREE.BufferAttribute(snowPositions, 3))
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 16
  const ctx = canvas.getContext('2d')!
  const gradient = ctx.createRadialGradient(8, 8, 1, 8, 8, 8)
  gradient.addColorStop(0, '#fff'); gradient.addColorStop(1, '#ffffff00')
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 16, 16)
  const map = new THREE.CanvasTexture(canvas)
  const snowMaterial = new THREE.PointsMaterial({ color: '#e4ebf1', map, size: .035, transparent: true, opacity: 0, depthWrite: false })
  const snow = new THREE.Points(snowGeometry, snowMaterial)
  snow.frustumCulled = false; snow.name = 'Snow outside the window'; scene.add(snow)
  const mistMaterial = new THREE.MeshBasicMaterial({ color: '#aab5bf', transparent: true, opacity: 0, depthWrite: false })
  const mist = new THREE.Mesh(new THREE.PlaneGeometry(3.8, 3.2), mistMaterial)
  mist.position.set(2.05, 1.7, -4); mist.name = 'Garden mist'; scene.add(mist)
  return {
    update(environment: Environment, seconds: number) {
      rain.visible = environment.rain > .01; snow.visible = environment.snow > .01
      rainMaterial.opacity = environment.rain * (.12 + environment.day * .25)
      snowMaterial.opacity = environment.snow * (.35 + environment.day * .4)
      mistMaterial.opacity = environment.fog * .65
      mist.visible = mistMaterial.opacity > .001
      seeds.forEach(([x, y, z], i) => {
        const px = .22 + x * 3.65, pz = -3.7 - z * .15
        const py = .1 + ((y * 3.3 - seconds * 2.7) % 3.3 + 3.3) % 3.3
        positions.set([px, py, pz, px + .035, py - .14, pz], i * 6)
        snowPositions.set([px + Math.sin(seconds + y * 10) * .06, .1 + ((y * 3.3 - seconds * .25) % 3.3 + 3.3) % 3.3, pz], i * 3)
      })
      geometry.getAttribute('position').needsUpdate = true
      snowGeometry.getAttribute('position').needsUpdate = true
    },
    dispose() { map.dispose(); geometry.dispose(); snowGeometry.dispose(); rainMaterial.dispose(); snowMaterial.dispose(); mist.geometry.dispose(); mistMaterial.dispose(); rain.removeFromParent(); snow.removeFromParent(); mist.removeFromParent() },
  }
}
