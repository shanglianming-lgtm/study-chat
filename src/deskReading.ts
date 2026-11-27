import * as THREE from 'three'
import { LEAF_SEGMENTS, stripProjection } from './leafGeometry'
import { createReadingBinding } from './folioBinding'

export type PageSide = 'left' | 'right'
type Focus = PageSide | 'spread'
export type DeskReading = ReturnType<typeof createDeskReading>

// CSS pixels on a leaf -> its model-space plane -> the very same camera as the desk.
// Keeping homogeneous W gives both the ink and native input hit testing the true perspective.
export function paperProjection(camera: THREE.PerspectiveCamera, surface: THREE.Matrix4, width: number, height: number) {
  const m = new THREE.Matrix4().set(
    width / 2, 0, 0, width / 2,
    0, -height / 2, 0, height / 2,
    0, 0, 1, 0,
    0, 0, 0, 1
  ).multiply(camera.projectionMatrix).multiply(camera.matrixWorldInverse).multiply(surface)
  return m.multiplyScalar(1 / m.elements[15])
}

export function createDeskReading(book: THREE.Group, desk: THREE.Vector3, seatEye: THREE.Vector3, invalidate: () => void) {
  const anchors = { left: book.getObjectByName('PageAnchor_L')!, right: book.getObjectByName('PageAnchor_R')! }
  const paperWidth = Number(anchors.right.userData.safe_width_m)
  const paperHeight = Number(anchors.right.userData.safe_height_m)
  const cutWidth = Number(anchors.right.userData.page_width_m), cutHeight = Number(anchors.right.userData.page_height_m)
  const sides: PageSide[] = ['left', 'right']
  const view = new THREE.PerspectiveCamera()
  const target = new THREE.Vector3(), corner = new THREE.Vector3()
  // Short-range occlusion where the cloth case meets the wood, below the resolution of the room shadow map.
  const contactMaterial = new THREE.ShaderMaterial({
    uniforms: { opacityAtDesk: { value: 0 }, leftEdge: { value: 0 } },
    vertexShader: 'varying vec2 footprint; void main(){footprint=position.xy; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: `varying vec2 footprint; uniform float opacityAtDesk, leftEdge;
      void main(){
        vec2 p=footprint-vec2((.159+leftEdge)*.5-.0015,-.002);
        vec2 q=abs(p)-vec2((.159-leftEdge)*.5-.003,.117);
        float d=max(length(max(q,0.))+min(max(q.x,q.y),0.)-.003,0.);
        float a=.27*exp(-d/.0022)+.15*exp(-d/.007);
        gl_FragColor=vec4(.115,.085,.050,a*opacityAtDesk);
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false,
  })
  const contact = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.29), contactMaterial)
  contact.name = 'Folio contact on desk'
  contact.rotation.x = -Math.PI / 2
  contact.position.copy(desk).y += 0.00018
  contact.visible = false
  book.parent!.add(contact)
  let width = 1, height = 1, pageWidth = 360, pageHeight = 550
  let root: HTMLElement | null = null, eye: THREE.PerspectiveCamera | null = null, opening = 0
  let focus: Focus = 'spread', fraction = 0, thickness = 0.5
  // Centres of the flat printable leaves relative to the foot of the open binding.
  // Measure them from the actual opening clip, independent of the book's current placement.
  const leftPage = book.worldToLocal(anchors.left.getWorldPosition(new THREE.Vector3()))
  const rightPage = book.worldToLocal(anchors.right.getWorldPosition(new THREE.Vector3()))
  const spineX = (leftPage.x + rightPage.x) / 2, restY = (leftPage.y + rightPage.y) / 2
  const halfGutter = (rightPage.x - leftPage.x - cutWidth) / 2
  const binding = createReadingBinding(book, cutWidth, cutHeight, halfGutter, spineX)
  const caseBounds = new THREE.Box3(), toBook = book.matrixWorld.clone().invert()
  for (const name of ['Cover_Front', 'Cover_Back']) {
    book.getObjectByName(name)!.traverse(mesh => {
      if (!(mesh instanceof THREE.Mesh)) return
      mesh.updateWorldMatrix(true, false)
      mesh.geometry.computeBoundingBox()
      caseBounds.union(mesh.geometry.boundingBox!.clone().applyMatrix4(toBook.clone().multiply(mesh.matrixWorld)))
    })
  }
  const caseHalf = (caseBounds.max.x - caseBounds.min.x) / 2
  const overhang = caseHalf - cutWidth - halfGutter
  let focusX = spineX
  let dragFocus: number | null = null
  const wantedX = () => dragFocus ?? (focus === 'spread' ? spineX : focus === 'left' ? leftPage.x : rightPage.x)
  const outline = Array.from({ length: 12 }, () => new THREE.Vector3())
  view.up.set(0, 0, -1)

  function frameView() {
    const rise = THREE.MathUtils.clamp(seatEye.y - desk.y + 0.105, 0.52, 0.66)
    const spread = focus === 'spread', aspect = width / height
    const reach = spread ? 0.19 + 0.34 * THREE.MathUtils.smoothstep(aspect, 1.13, 1.80) : 0.16
    const tilt = binding.slope, half = spread ? caseHalf : cutWidth / 2 + overhang
    target.set(desk.x + focusX, desk.y + restY + tilt * (focusX - spineX), desk.z)
    // Sight straight across the type, even when a thick stack lifts one side of the book.
    view.position.set(-tilt, 1, 0).normalize().multiplyScalar(rise).add(target)
    view.position.z += rise * reach
    view.lookAt(target)
    view.updateMatrixWorld()
    let i = 0, low = Infinity, high = -Infinity
    for (const sign of [-1, 1]) {
      const coverX = focusX + sign * half
      const pageX = THREE.MathUtils.clamp(coverX, caseBounds.min.x + overhang, caseBounds.max.x - overhang)
      for (const z of [-1, 1]) {
        const end = z < 0 ? caseBounds.min.z : caseBounds.max.z
        outline[i++].set(coverX, caseBounds.min.y, end).add(desk)
        outline[i++].set(coverX, caseBounds.max.y, end).add(desk)
        outline[i++].set(pageX, restY + tilt * (pageX - spineX), z * cutHeight / 2).add(desk)
      }
    }
    for (const point of outline) {
      corner.copy(point).applyMatrix4(view.matrixWorldInverse)
      const angle = Math.atan2(corner.y, -corner.z)
      low = Math.min(low, angle); high = Math.max(high, angle)
    }
    view.rotateX((low + high) / 2)
    view.updateMatrixWorld()
    const usableX = 0.970, usableY = 0.958
    let tangent = 0
    for (const point of outline) {
      corner.copy(point).applyMatrix4(view.matrixWorldInverse)
      tangent = Math.max(tangent, Math.abs(corner.x / corner.z) / (aspect * usableX),
        Math.abs(corner.y / corner.z) / usableY)
    }
    view.fov = THREE.MathUtils.radToDeg(2 * Math.atan(tangent))
    view.aspect = aspect
    view.updateProjectionMatrix()
  }

  function pixelPlane(side: PageSide) {
    return anchors[side].matrixWorld.clone()
      .multiply(new THREE.Matrix4().makeTranslation(-paperWidth / 2, paperHeight / 2, 0.00008))
      .multiply(new THREE.Matrix4().makeScale(paperWidth / pageWidth, -paperHeight / pageHeight, 1))
  }
  function cutSheet() {
    const scale = pageWidth / paperWidth
    const gutter = halfGutter * scale, outer = cutWidth * scale
    const columns: { start: number; width: number }[] = []
    for (let i = 0; i < 4; i++) columns.push({ start: gutter * i / 4, width: gutter / 4 })
    for (let i = 0; i < LEAF_SEGMENTS; i++) columns.push({ start: gutter + outer * i / LEAF_SEGMENTS, width: outer / LEAF_SEGMENTS })
    return { width: outer + gutter, height: cutHeight * scale, gutter, columns,
      marginX: (cutWidth - paperWidth) * scale / 2, marginY: (cutHeight - paperHeight) * scale / 2 }
  }
  function sizeType() {
    pageWidth = Math.round(THREE.MathUtils.clamp(Math.min(width * (focus === 'spread' ? 0.435 : 0.86), height * 0.60), 230, 600))
    pageHeight = pageWidth * paperHeight / paperWidth
  }
  function cssMatrix(m: THREE.Matrix4) { return 'matrix3d(' + m.elements.join(',') + ')' }
  function print(camera: THREE.PerspectiveCamera) {
    eye = camera
    if (!root) return
    for (const side of sides) {
      const plane = pixelPlane(side)
      root.style.setProperty('--desk-' + side, cssMatrix(paperProjection(camera, plane, width, height)))
      const elevated = plane.clone().multiply(new THREE.Matrix4().makeTranslation(0,0,.005))
      root.style.setProperty('--desk-air-' + side, cssMatrix(paperProjection(camera,elevated,width,height)))
      const exposure = side === 'left' ? THREE.MathUtils.smootherstep(opening, 0.72, 0.92)
        : THREE.MathUtils.smootherstep(opening, 0.63, 0.81)
      root.style.setProperty('--ink-' + side, String(exposure))
    }
    root.style.setProperty('--leaf-width', pageWidth + 'px')
    root.style.setProperty('--leaf-height', pageHeight + 'px')
    root.style.setProperty('--trim-x', ((cutWidth / paperWidth - 1) * pageWidth / 2) + 'px')
    root.style.setProperty('--trim-y', ((cutHeight / paperHeight - 1) * pageHeight / 2) + 'px')
    root.dataset.inkReady = 'true'
  }
  let turn: { segments: HTMLElement[]; forward: boolean; shadow: HTMLElement; progress: number; grip: number } | null = null
  function drawTurn() {
    if (!turn || !eye) return
    const { forward, segments, progress, shadow, grip } = turn
    const source = pixelPlane(forward ? 'right' : 'left'), destination = pixelPlane(forward ? 'left' : 'right')
    const cut = cutSheet()
    const { marginX, marginY } = cut
    const worldY = new THREE.Vector3(0, 1, 0).transformDirection(book.matrixWorld)
    const foldAt = (d: number, z: number) => THREE.MathUtils.lerp(binding.foldHeight(!forward, d, z), binding.foldHeight(forward, d, z), progress)
    const head = -cutHeight / 2, foot = cutHeight / 2
    const gutter = new THREE.Vector3(forward ? -marginX : pageWidth + marginX, -marginY, 0).applyMatrix4(source)
      .lerp(new THREE.Vector3(forward ? pageWidth + marginX : -marginX, -marginY, 0).applyMatrix4(destination), 0.5)
      .addScaledVector(worldY, foldAt(0, head))
    const xColumn = new THREE.Vector3().setFromMatrixColumn(source, 0)
    const pixel = xColumn.length(), xAxis = xColumn.clone().normalize()
    const yColumn = new THREE.Vector3().setFromMatrixColumn(source, 1), down = yColumn.clone().normalize()
    const up = down.clone().cross(xAxis).normalize()
    const lift = Math.sin(Math.PI * progress), settling = 1 - .65 * lift
    const bottom = gutter.clone().addScaledVector(yColumn, cut.height)
      .addScaledVector(worldY, foldAt(0, foot) - foldAt(0, head))
    const endTop = new THREE.Vector3(), endBottom = new THREE.Vector3(), normal = new THREE.Vector3()
    const corners = Array.from({length: 4}, () => new THREE.Vector3())
    const angle = (u: number, edge: number) => Math.max(0, Math.min(Math.PI,
      Math.PI * progress + lift * (1.50 * (u - .45) + .72 * (grip - .5) * edge * (.18 + .82 * u))))
    const brightness = (theta: number) => .81 + .19 * Math.abs(Math.cos(theta)) +
      .025 * Math.sin(2 * theta) * (forward ? 1 : -1)
    const shade = (light: number) => 'rgb(' + [248, 243, 228].map(v => Math.min(255, Math.round(v * light))).join(',') + ')'
    for (let i = 0; i < segments.length; i++) {
      const col = cut.columns[i], u = (col.start + col.width * .5) / cut.width
      const near = col.start * paperWidth / pageWidth, far = (col.start + col.width) * paperWidth / pageWidth
      const advance = (end: THREE.Vector3, start: THREE.Vector3, z: number, theta: number) =>
        end.copy(start).addScaledVector(xAxis, (forward ? 1 : -1) * col.width * pixel * Math.cos(theta))
          .addScaledVector(up, col.width * pixel * Math.sin(theta))
          .addScaledVector(worldY, (foldAt(far, z) - foldAt(near, z)) * settling)
      advance(endTop, gutter, head, angle(u, -1))
      advance(endBottom, bottom, foot, angle(u, 1))
      normal.crossVectors(corner.subVectors(bottom, gutter), xColumn.subVectors(endTop, gutter)).normalize()
      if (!forward) normal.negate()
      const strip = segments[i]
      strip.dataset.face = normal.dot(corner.subVectors(eye.position, gutter)) >= 0 ? 'front' : 'back'
      // Four shared corners keep adjacent strips joined even when a corner is pulled ahead of the other.
      const world = forward ? [gutter,endTop,endBottom,bottom] : [endTop,gutter,bottom,endBottom]
      for (let j = 0; j < 4; j++) {
        const q = corners[j].copy(world[j]).project(eye)
        q.set((1 + q.x) * width / 2, (1 - q.y) * height / 2, 0)
      }
      strip.style.transform = stripProjection(corners, col.width, cut.height)
      strip.style.setProperty('--shade-start', shade(brightness(angle(col.start / cut.width, 0))))
      strip.style.setProperty('--shade-end', shade(brightness(angle((col.start + col.width) / cut.width, 0))))
      gutter.copy(endTop)
      bottom.copy(endBottom)
    }
    const onRight = forward === (progress < .5)
    shadow.className = 'desk-fold-shadow on-' + (onRight ? 'right' : 'left')
    shadow.style.opacity = String(.23 * lift)
    shadow.style.setProperty('--fold-reach', (22 + 67 * Math.abs(Math.cos(Math.PI * progress))) + '%')
  }

  return {
    view,
    cutSheet,
    worldPoint(side: PageSide,u:number,v:number,lift:number,out:THREE.Vector3) {
      return anchors[side].localToWorld(out.set((u-.5)*paperWidth,(.5-v)*paperHeight,lift))
    },
    get moving() { return Math.abs(focusX - wantedX()) > 0.00005 || Math.abs(thickness - fraction) > 0.0005 },
    attach(element: HTMLElement | null) { root = element; if (element && eye) print(eye) },
    configure(nextFraction: number, nextFocus: Focus) {
      if (fraction === nextFraction && focus === nextFocus) return
      fraction = THREE.MathUtils.clamp(nextFraction, 0, 1)
      focus = nextFocus
      sizeType()
      invalidate()
    },
    resize(w: number, h: number) {
      width = w; height = h
      sizeType()
      frameView()
    },
    sample(dt: number, open: number, snap: boolean) {
      const next = wantedX()
      focusX = snap || Math.abs(focusX - next) < 0.00005 ? next : THREE.MathUtils.damp(focusX, next, 12, dt)
      thickness = snap || Math.abs(thickness - fraction) < 0.0005 ? fraction : THREE.MathUtils.damp(thickness, fraction, 9, dt)
      binding.update(thickness, open)
      frameView()
    },
    project(camera: THREE.PerspectiveCamera, coverOpening = 1) { opening = coverOpening; print(camera); drawTurn() },
    trackFocus(from: PageSide, to: PageSide, progress: number) {
      dragFocus = THREE.MathUtils.lerp(from === 'left' ? leftPage.x : rightPage.x, to === 'left' ? leftPage.x : rightPage.x, progress)
      invalidate()
    },
    startTurn(segments: HTMLElement[], forward: boolean, shadow: HTMLElement, grip = .5) {
      turn = { segments, forward, shadow, grip, progress: 0 }; drawTurn()
    },
    turnTo(progress: number) { if (turn) { turn.progress = progress; drawTurn() } },
    endTurn() { turn = null; if (dragFocus !== null) { dragFocus = null; invalidate() } },
    contact(amount: number, opening: number) {
      contact.visible = amount > 0
      contactMaterial.uniforms.opacityAtDesk.value = amount
      contactMaterial.uniforms.leftEdge.value = -0.002 - 0.183 * THREE.MathUtils.smoothstep(opening, 0.43, 1)
    },
    dispose() { contact.removeFromParent(); contact.geometry.dispose(); contactMaterial.dispose(); root = null; turn = null },
  }
}

// Live controls stay on the fixed leaves. Only this temporary sheet is printed on both sides.
export function turnDeskSheet(host: HTMLElement, rig: DeskReading, front: HTMLElement, back: HTMLElement,
  under: HTMLElement | undefined, forward: boolean, grip: number) {
  const sourceSide = forward ? 'right' : 'left', landingSide = forward ? 'left' : 'right'
  if (under) { under.classList.add('desk-underlay', 'on-' + landingSide); host.append(under) }
  const shadow = document.createElement('div')
  shadow.className = 'desk-fold-shadow on-' + sourceSide
  host.append(shadow)
  const segments: HTMLElement[] = []
  const cut = rig.cutSheet()
  for (const column of cut.columns) {
    const strip = document.createElement('div')
    strip.className = 'desk-turn-strip'
    strip.style.backgroundPosition = -column.start + 'px 0, 0 0'
    strip.style.setProperty('--shade-direction', forward ? '90deg' : '270deg')
    strip.style.width = (column.width + 0.45) + 'px'
    strip.style.height = cut.height + 'px'
    for (const [face, page] of [['front', front], ['back', back]] as const) {
      const side = document.createElement('div')
      side.className = 'desk-strip-' + face
      const ink = page.cloneNode(true) as HTMLElement
      const rightLeaf = (face === 'front') === forward
      const fromLeft = rightLeaf ? column.start : cut.width - column.start - column.width
      ink.style.left = (cut.marginX + (rightLeaf ? cut.gutter : 0) - fromLeft) + 'px'
      ink.style.top = cut.marginY + 'px'
      side.append(ink); strip.append(side)
    }
    host.append(strip); segments.push(strip)
  }
  rig.startTurn(segments, forward, shadow, grip)
  return (progress: number) => rig.turnTo(progress)
}
