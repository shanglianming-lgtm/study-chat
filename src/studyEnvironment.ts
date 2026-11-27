/** Shared, renderer-independent environment. Local wall time is always authoritative. */
export type Weather = { cloud: number; rain: number; snow: number; fog: number }
export const clearWeather: Weather = { cloud: 0, rain: 0, snow: 0, fog: 0 }
export const weatherPreferenceKey = 'study-online-weather'
const preferenceEvent = 'study-weather-preference'
const clamp = (n: number) => Math.max(0, Math.min(1, n))
const smooth = (a: number, b: number, n: number) => { const t = clamp((n - a) / (b - a)); return t * t * (3 - 2 * t) }

export function environmentAt(date: Date, weather: Weather) {
  const hour = date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600
  // Soft dawn / dusk rather than switching lighting at a whole hour. Without a
  // location or network, this deliberately remains a local 06–19h day cycle.
  const day = smooth(5.5, 8, hour) * (1 - smooth(17, 19.5, hour))
  const sun = smooth(6.5, 9, hour) * (1 - smooth(16, 18.5, hour))
  const overcast = clamp(Math.max(weather.cloud, weather.fog * .9))
  const daylight = day * (1 - overcast * .65)
  return {
    day, daylight, sun: sun * (1 - smooth(.2, .85, overcast)),
    warm: (1 - smooth(.1, .9, day)) * day * 2 * (1 - overcast),
    lamp: 1 - smooth(.16, .58, daylight),
    cloud: overcast, rain: weather.rain, snow: weather.snow, fog: weather.fog,
    sunX: Math.round((2.5 + Math.sin((hour - 12) / 12 * Math.PI) * 2) * 100) / 100,
  }
}
export type Environment = ReturnType<typeof environmentAt>

export function onlineWeatherEnabled() {
  try { return localStorage.getItem(weatherPreferenceKey) !== 'off' } catch { return true }
}
export function setOnlineWeather(enabled: boolean) {
  try { localStorage.setItem(weatherPreferenceKey, enabled ? 'on' : 'off') } catch { /* session-only preference still works */ }
  window.dispatchEvent(new CustomEvent(preferenceEvent, { detail: enabled }))
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}
}
function finite(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}
/** Accept only the current conditions we use; malformed responses keep clear fallback. */
export function parseWeather(value: unknown): Weather {
  const data = record(record(value).current)
  if (!finite(data.weather_code, 0, 99) || !finite(data.cloud_cover, 0, 100)) throw new Error('Invalid weather')
  const code = data.weather_code
  const snow = [71, 73, 75, 77, 85, 86].includes(code)
  const rain = [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].includes(code)
  return { cloud: Math.max(data.cloud_cover / 100, (rain || snow) ? .85 : 0), rain: rain ? .75 : 0, snow: snow ? .8 : 0, fog: [45, 48].includes(code) ? .85 : 0 }
}

/** IP-level location only; no GPS prompt, credentials, coordinates or IP persisted. */
export function watchStudyWeather(changed: (weather: Weather) => void) {
  let enabled = onlineWeatherEnabled(), stopped = false, generation = 0
  let controller: AbortController | undefined
  let lastAttempt = -Infinity, lastSuccess = -Infinity, current = clearWeather
  const interval = 30 * 60_000, maxAge = 60 * 60_000
  async function json(url: string, signal: AbortSignal) {
    const response = await fetch(url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' })
    if (!response.ok) throw new Error('Weather unavailable')
    return response.json() as Promise<unknown>
  }
  async function refresh() {
    const now = Date.now()
    if (stopped || !enabled) return
    if (now - lastSuccess >= maxAge && current !== clearWeather) { current = clearWeather; changed(current) }
    if (now >= lastAttempt && now - lastAttempt < interval) return
    lastAttempt = now
    controller?.abort()
    const request = controller = new AbortController(), version = ++generation
    const timeout = window.setTimeout(() => request.abort(), 8000)
    try {
      const location = record(await json('https://ipapi.co/json/', request.signal))
      if (!finite(location.latitude, -90, 90) || !finite(location.longitude, -180, 180)) throw new Error('No approximate location')
      // Round to city-scale coordinates before sending to the weather service.
      const lat = location.latitude.toFixed(1), lon = location.longitude.toFixed(1)
      const weather = parseWeather(await json(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=weather_code,cloud_cover`, request.signal))
      if (!stopped && enabled && version === generation) { current = weather; lastSuccess = Date.now(); changed(current) }
    } catch { /* Offline, timeouts, rate limits and blocked providers are non-fatal. */ }
    finally { clearTimeout(timeout) }
  }
  const preference = (event: Event) => {
    if (event instanceof StorageEvent && event.key !== null && event.key !== weatherPreferenceKey) return
    enabled = event instanceof CustomEvent ? !!event.detail : onlineWeatherEnabled()
    generation++; controller?.abort(); lastAttempt = -Infinity
    current = clearWeather; changed(current)
    if (enabled) void refresh()
  }
  const visible = () => { if (!document.hidden) void refresh() }
  const online = () => {
    // A reconnect is an explicit recovery signal, not the regular poll. Retry a
    // failed lookup immediately without bypassing the cache after a success.
    if (lastSuccess < lastAttempt) lastAttempt = -Infinity
    visible()
  }
  const timer = window.setInterval(() => void refresh(), 60_000)
  window.addEventListener(preferenceEvent, preference)
  window.addEventListener('storage', preference)
  window.addEventListener('online', online)
  document.addEventListener('visibilitychange', visible)
  changed(current); void refresh()
  return () => {
    stopped = true; generation++; controller?.abort(); clearInterval(timer)
    window.removeEventListener(preferenceEvent, preference)
    window.removeEventListener('storage', preference)
    window.removeEventListener('online', online)
    document.removeEventListener('visibilitychange', visible)
  }
}
