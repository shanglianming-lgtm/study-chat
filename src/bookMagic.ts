import * as THREE from 'three'
import type { BookPose } from './bookFlight'

/** Dust leaves the binding in world space and hangs briefly in the window light. */
export function createBookMagic() {
  const count = 10
  const positions = new Float32Array(count * 3), appearance = new Float32Array(count * 2)
  const geometry = new THREE.BufferGeometry()
  const position = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage)
  const mote = new THREE.BufferAttribute(appearance, 2).setUsage(THREE.DynamicDrawUsage)
  geometry.setAttribute('position', position)
  geometry.setAttribute('mote', mote)
  const material = new THREE.ShaderMaterial({
    uniforms: { focalPixels: { value: 1 } },
    transparent: true, depthWrite: false,
    vertexShader: `
      attribute vec2 mote;
      uniform float focalPixels;
      varying float opacity;
      void main() {
        vec4 p = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * p;
        float diameter = clamp(mote.x * focalPixels / max(-p.z, 0.08), 0.0, 3.1);
        gl_PointSize = max(1.0, diameter);
        opacity = mote.y * min(1.0, diameter);
      }
    `,
    fragmentShader: `
      varying float opacity;
      void main() {
        vec2 d = (gl_PointCoord - 0.5) * 2.0;
        float edge = 1.0 - smoothstep(0.12, 1.0, dot(d, d));
        gl_FragColor = vec4(1.0, 0.77, 0.48, opacity * edge);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  })
  const dust = new THREE.Points(geometry, material)
  dust.frustumCulled = false
  dust.visible = false
  const grains = Array.from({ length: count }, () => ({
    origin: new THREE.Vector3(), velocity: new THREE.Vector3(), age: 1, life: 0, size: 0,
  }))
  const p = new THREE.Vector3(), previous = new THREE.Vector3(), direction = new THREE.Vector3()
  let next = 0, distance = 0, tracking = false
  function clear() {
    grains.forEach(grain => { grain.life = 0 })
    dust.visible = tracking = false
    distance = 0
  }
  return {
    dust,
    get drifting() { return dust.visible },
    update(book: BookPose, dt: number, active: boolean, reduced: boolean, focalPixels: number) {
      if (!active || reduced) { if (tracking) clear(); return }
      direction.subVectors(book.center, previous)
      const travel = tracking ? direction.length() : 0
      previous.copy(book.center)
      tracking = true
      const fast = dt > 0 && travel > dt * 0.65
      distance = fast ? distance + travel : 0
      if (distance > 0.21) {
        const grain = grains[next % count], seed = next++ * 2.39996
        grain.origin.set(-0.073 + 0.02 * Math.sin(seed), 0.009, 0.10 * Math.cos(seed))
          .multiplyScalar(book.scale).applyQuaternion(book.rotation).add(book.center)
        grain.velocity.copy(direction).normalize().multiplyScalar(0.08)
        grain.velocity.x += Math.sin(seed) * 0.033
        grain.velocity.y += 0.065 + 0.026 * Math.cos(seed)
        grain.age = 0
        grain.life = 0.34 + 0.14 * (0.5 + 0.5 * Math.sin(seed))
        grain.size = 0.0026 + 0.0014 * (0.5 + 0.5 * Math.cos(seed))
        distance %= 0.21
      }
      let visible = false
      grains.forEach((grain, i) => {
        grain.age += dt
        if (grain.age >= grain.life) { mote.setXY(i, 0, 0); return }
        visible = true
        const t = grain.age / grain.life
        p.copy(grain.origin).addScaledVector(grain.velocity, (1 - Math.exp(-3 * grain.age)) / 3)
        p.y -= 0.09 * grain.age * grain.age
        position.setXYZ(i, p.x, p.y, p.z)
        mote.setXY(i, grain.size, 0.62 * Math.sin(Math.PI * t))
      })
      dust.visible = visible
      if (visible) {
        material.uniforms.focalPixels.value = focalPixels
        position.needsUpdate = mote.needsUpdate = true
      }
    },
    dispose() { geometry.dispose(); material.dispose() },
  }
}
