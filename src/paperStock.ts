let stock: { sheet: HTMLCanvasElement; url: string } | undefined

/** One fibre field follows the paper through the fixed mesh, curled leaf and flat reader. */
export function paperStock() {
  if (stock) return stock
  const sheet = document.createElement('canvas')
  const size = 256
  sheet.width = sheet.height = size
  const ctx = sheet.getContext('2d')
  if (!ctx) return
  let seed = 3271
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }
  const pulp = ctx.createImageData(size, size)
  const density = Array.from({ length: 64 }, random)
  const sample = (x: number, y: number) => density[(y % 8) * 8 + x % 8]
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const col = x >> 5, row = y >> 5, u = (x % 32) / 32, v = (y % 32) / 32
      const a = sample(col, row) * (1 - u) + sample(col + 1, row) * u
      const b = sample(col, row + 1) * (1 - u) + sample(col + 1, row + 1) * u
      const value = 239 + 10 * (a * (1 - v) + b * v) + 8 * random()
      const i = (y * size + x) * 4
      pulp.data[i] = pulp.data[i + 1] = pulp.data[i + 2] = value
      pulp.data[i + 3] = 255
    }
  }
  ctx.putImageData(pulp, 0, 0)
  for (let layer = 0; layer < 2; layer++) {
    ctx.strokeStyle = layer ? 'rgba(255,255,251,.46)' : 'rgba(90,77,57,.13)'
    ctx.lineWidth = layer ? .65 : .5
    ctx.beginPath()
    for (let i = 0; i < 1650; i++) {
      const x = random() * size, y = random() * size, angle = (random() - .5) * 2.4 + 1.08
      const length = 1.2 + random() ** 2 * 8
      const dx = Math.cos(angle) * length, dy = Math.sin(angle) * length
      ctx.moveTo(x, y)
      ctx.quadraticCurveTo(x + dx * .55 + .5, y + dy * .45, x + dx, y + dy)
    }
    ctx.stroke()
  }
  return stock = { sheet, url: `url("${sheet.toDataURL()}")` }
}
