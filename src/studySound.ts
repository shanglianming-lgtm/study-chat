/** Short, dry impacts. Samples are generated locally once and left/right soles differ slightly. */
function impact(context: AudioContext, surface: 'oak' | 'rug' | 'latch', variant: number) {
  const latch = surface === 'latch', rug = surface === 'rug'
  const length = Math.ceil(context.sampleRate * (latch ? .14 : .24))
  const buffer = context.createBuffer(1, length, context.sampleRate)
  const samples = buffer.getChannelData(0), pitch = 1 + (variant - 1.5) * .029
  let grain = 0, brush = 0, seed = 423819 + variant * 141
  for (let i = 0; i < length; i++) {
    const t = i / context.sampleRate
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    const white = (seed / 0x100000000) * 2 - 1
    grain += (white - grain) * (latch ? .32 : rug ? .032 : .085)
    brush += (grain - brush) * .07
    const attack = 1 - Math.exp(-t * (latch ? 1200 : 275))
    if (latch) {
      const tap = Math.max(0, t - .036)
      samples[i] = attack * (.07 * grain * Math.exp(-105*t) + .028 * Math.sin(t*3190)*Math.exp(-95*t))
        + .038 * Math.sin(tap*1110) * Math.exp(-85*tap)
    } else {
      const sole = Math.max(0, t - .039), radians = 2 * Math.PI * t * pitch
      const thump = .080 * Math.sin(radians * 86) * Math.exp(-40*t)
        + .026 * Math.sin(radians * 140) * Math.exp(-54*t)
      const contact = .25 * grain * Math.exp(-37*t) + .13 * brush * (1 - Math.exp(-160*sole)) * Math.exp(-32*sole)
      samples[i] = attack * ((rug ? .53 : 1) * thump + (rug ? .65 : 1) * contact)
    }
  }
  return buffer
}

export function roomSoundEnabled() {
  try { return localStorage.getItem('study-room-muted') !== 'true' } catch { return true }
}

export function createStudySound() {
  let context: AudioContext | undefined
  const buffers = new Map<string, AudioBuffer>()
  let step = 0
  function play(surface: 'oak' | 'rug' | 'latch', power: number) {
    if (!context || context.state !== 'running') return
    const variant = surface === 'latch' ? 0 : (step++ % 4)
    const key = surface + variant
    let buffer = buffers.get(key)
    if (!buffer) { buffer = impact(context, surface, variant); buffers.set(key, buffer) }
    const voice = context.createBufferSource(), gain = context.createGain()
    voice.buffer = buffer
    gain.gain.value = power
    voice.connect(gain).connect(context.destination)
    voice.onended = () => { voice.disconnect(); gain.disconnect() }
    voice.start()
  }
  return {
    unlock() {
      if (typeof AudioContext === 'undefined') return
      try {
        context ??= new AudioContext()
        if (context.state === 'suspended') void context.resume().catch(() => {})
      } catch { /* Room navigation also works without an audio output. */ }
    },
    footstep(x: number, z: number, pace: number) {
      const rug = (Math.abs(x + 2.28) <= 1.275 && Math.abs(z - .12) <= 1.7)
        || (Math.abs(x - 2.18) <= 1.45 && Math.abs(z + 1.94) <= 1.075)
      play(rug ? 'rug' : 'oak', .6 + Math.min(1, pace / 1.52) * .4)
    },
    latch() { play('latch', .75) },
    dispose() { if (context) void context.close().catch(() => {}); buffers.clear() },
  }
}
