import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import { bookInk, inkDebug } from './spatialInk'

// Temporary, explicitly opt-in harness. No library/provider data is changed.
export function InkDebugPanel() {
  const state = useSyncExternalStore(inkDebug.subscribe, inkDebug.snapshot)
  const stream = useRef<ReturnType<typeof setInterval> | undefined>(undefined)
  useEffect(() => () => clearInterval(stream.current), [])
  if (!import.meta.env.DEV && !new URLSearchParams(location.search).has('inkDebug')) return null
  const prepare = () => {
    clearInterval(stream.current)
    inkDebug.set({ enabled: true, mode: 'scrub', text: inkDebug.sample, progress: 0 })
  }
  const simulate = () => {
    clearInterval(stream.current)
    inkDebug.set({ enabled: true, mode: 'stream', text: '', progress: 0 })
    const tokens = ['Star', 'light ', 'gathers ', 'into ', 'ancient ', 'ink.']
    let next = 0
    // This interval simulates backend token arrival ONLY. Activation is
    // exclusively the real 3D hand's spatial detector in the room RAF loop.
    stream.current = setInterval(() => {
      const state = inkDebug.snapshot()
      if (next === tokens.length || !state.enabled) { clearInterval(stream.current); return }
      inkDebug.set({ text: state.text + tokens[next++] })
    }, 340)
  }
  return <aside className="ink-debug-panel" aria-label="Ink debug" onPointerDown={e => e.stopPropagation()}>
    <strong>Ink debug · temporary</strong>
    <label>Hand sweep <output>{Math.round(state.progress * 100)}%</output>
      <input aria-label="手部横扫进度" type="range" min="0" max="100" step="1" value={state.progress * 100}
        onChange={e => { clearInterval(stream.current); inkDebug.set({ enabled: true, mode: 'scrub', text: inkDebug.sample, progress: +e.target.value / 100 }) }} />
    </label>
    <div><button onClick={prepare}>Reset sample</button><button onClick={simulate}>Simulate streaming</button></div>
    <button onClick={() => { clearInterval(stream.current); inkDebug.set({ enabled: false }) }}>Exit debug</button>
    <small>Scrub freezes the spatial simulation. Streaming runs the live hand. No library data is changed.</small>
  </aside>
}

export function InkDebugSample() {
  const state = useSyncExternalStore(inkDebug.subscribe, inkDebug.snapshot)
  const host = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (!state.enabled || !host.current) return
    return bookInk.register(host.current, 'right', { animate: true, debug: true })
  }, [state.enabled, state.mode])
  if (!state.enabled) return null
  return <section className="ink-debug-sample" aria-label="空间显字调试书页">
    <div className="ink-debug-caption">Spatial ink · {state.mode === 'scrub' ? 'frozen inspection' : 'live token stream'}</div>
    <div ref={host} className="ink-debug-line"><p>{state.text}</p></div>
  </section>
}
