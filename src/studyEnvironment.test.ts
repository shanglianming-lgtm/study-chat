// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearWeather, environmentAt, parseWeather, setOnlineWeather, watchStudyWeather, weatherPreferenceKey } from './studyEnvironment'

const at = (hour: number, minute = 0) => new Date(2026, 10, 27, hour, minute)
const response = (body: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response)
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
let stop: (() => void) | undefined
afterEach(() => { stop?.(); stop = undefined; localStorage.clear(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('shared light and weather', () => {
  it('eliminates direct sunlight at night and turns on the desk lamp', () => {
    for (const hour of [0, 3, 20, 23]) {
      const state = environmentAt(at(hour), clearWeather)
      expect(state.sun).toBe(0); expect(state.day).toBe(0); expect(state.lamp).toBe(1)
    }
    const noon = environmentAt(at(12), clearWeather)
    expect(noon.sun).toBe(1); expect(noon.lamp).toBe(0)
  })
  it('softens overcast sunlight and switches lamps on before it is fully dark', () => {
    const sunny = environmentAt(at(18), clearWeather)
    const cloudy = environmentAt(at(18), { ...clearWeather, cloud: 1 })
    expect(cloudy.sun).toBe(0); expect(cloudy.daylight).toBeLessThan(sunny.daylight)
    expect(cloudy.lamp).toBeGreaterThan(sunny.lamp)
    expect(Math.abs(environmentAt(at(17, 59), clearWeather).day - sunny.day)).toBeLessThan(.02)
  })
  it('distinguishes rain, snow and fog codes and rejects unusable cloud data', () => {
    expect(parseWeather({ current: { weather_code: 63, cloud_cover: 40 } }).rain).toBeGreaterThan(0)
    expect(parseWeather({ current: { weather_code: 75, cloud_cover: 90 } })).toMatchObject({ rain: 0, snow: .8 })
    expect(parseWeather({ current: { weather_code: 45, cloud_cover: 100 } }).fog).toBe(.85)
    expect(() => parseWeather({ current: { weather_code: 0, cloud_cover: null } })).toThrow()
    expect(() => parseWeather({ current: { weather_code: 0, cloud_cover: '50' } })).toThrow()
  })
  it('does no network work when the saved setting is off', () => {
    localStorage.setItem(weatherPreferenceKey, 'off')
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    stop = watchStudyWeather(vi.fn())
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('rounds location and refreshes conditions without persisting location', async () => {
    vi.useFakeTimers(); vi.setSystemTime(at(12))
    const fetcher = vi.fn().mockImplementationOnce(() => response({ latitude: 31.2345, longitude: 121.4867 }))
      .mockImplementationOnce(() => response({ current: { weather_code: 61, cloud_cover: 100 } }))
    vi.stubGlobal('fetch', fetcher)
    const changed = vi.fn(); stop = watchStudyWeather(changed); await flush()
    expect(fetcher.mock.calls[1][0]).toContain('latitude=31.2&longitude=121.5')
    expect(changed.mock.lastCall?.[0].rain).toBe(.75)
    expect(localStorage.length).toBe(0)
    await vi.advanceTimersByTimeAsync(29 * 60_000)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('ignores a late response after opt-out, aborts the request and restores clear weather', async () => {
    let resolve!: (response: Response) => void
    const fetcher = vi.fn().mockImplementationOnce(() => new Promise<Response>(r => { resolve = r }))
    vi.stubGlobal('fetch', fetcher)
    const changed = vi.fn(); stop = watchStudyWeather(changed)
    setOnlineWeather(false)
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true)
    resolve(await response({ latitude: 31, longitude: 121 })); await flush()
    expect(changed.mock.lastCall?.[0]).toEqual(clearWeather)
    // Aborted fetch stubs may still resolve, but never apply their result.
    expect(changed.mock.calls.every(([weather]) => weather.rain === 0)).toBe(true)
  })
  it('falls back after stale data and failed refreshes', async () => {
    vi.useFakeTimers(); vi.setSystemTime(at(12))
    const fetcher = vi.fn().mockImplementationOnce(() => response({ latitude: 31, longitude: 121 }))
      .mockImplementationOnce(() => response({ current: { weather_code: 63, cloud_cover: 100 } }))
      .mockRejectedValue(new Error('offline'))
    vi.stubGlobal('fetch', fetcher)
    const changed = vi.fn(); stop = watchStudyWeather(changed); await flush()
    expect(changed.mock.lastCall?.[0].rain).toBe(.75)
    await vi.advanceTimersByTimeAsync(61 * 60_000)
    expect(changed.mock.lastCall?.[0]).toEqual(clearWeather)
  })
  it('bounds requests by a timeout and cleans up requests on room disposal', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn(() => new Promise<Response>(() => {})); vi.stubGlobal('fetch', fetcher)
    stop = watchStudyWeather(vi.fn())
    const signal = (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].signal!
    await vi.advanceTimersByTimeAsync(8000)
    expect(signal.aborted).toBe(true)
    stop(); stop = undefined
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
