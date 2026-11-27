import * as THREE from 'three'

/** A narrow flax ticket with handset titles that read head-to-tail on the spine. */
export function drawSpineTitle(name: string) {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 768
  const ink = canvas.getContext('2d')
  if (!ink) return null
  const title = name.trim() || 'Folio'
  ink.fillStyle = '#ede8d4'
  ink.fillRect(0, 0, 128, 768)
  ink.fillStyle = '#46503c'
  ink.textAlign = 'center'
  ink.textBaseline = 'middle'
  for (const y of [45, 716]) ink.fillRect(30, y, 68, 3)
  const glyphs = Array.from(title)
  if (/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\s]+$/u.test(title) && glyphs.length <= 14) {
    const size = Math.min(72, 575/glyphs.length)
    ink.font = size + 'px "Songti SC", SimSun, serif'
    glyphs.forEach((c,i) => ink.fillText(c, 64, 384+(i-(glyphs.length-1)/2)*size*1.06))
  } else {
    ink.translate(64, 384)
    ink.rotate(Math.PI/2)
    ink.font = '67px Georgia, "Songti SC", SimSun, serif'
    ink.fillText(title, 0, 0, 625)
  }
  const map = new THREE.CanvasTexture(canvas)
  map.colorSpace = THREE.SRGBColorSpace
  return map
}
