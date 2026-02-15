import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import maplibregl from 'maplibre-gl'
import * as h3 from 'h3-js'
import * as Astronomy from 'astronomy-engine'
import { calculate, getMoonImageURLs, getHemisphere, geocode } from './utils'
import { initDB, getCachedResults, cacheResults } from './utils/db'

const YALLOP_CRITERIA = {
  A: "Hilal easily visible",
  B: "Hilal visible under perfect conditions",
  C: "May need optical aid to find crescent",
  D: "Will need optical aid to find crescent",
  E: "Crescent not visible with telescope",
  F: "Hilal not visible - below the Danjon limit (7°)",
  G: "Hilal not visible - Sunset is before new moon",
  H: "Hilal not visible - No Moonset on location",
  I: "Hilal not visible - Moonset before sunset",
}

const MAP_STYLES = [
  { id: 'dark', label: 'Dark', url: 'https://basemaps.cartocdn.com/gl/dark-matter-nolabels-gl-style/style.json' },
  { id: 'light', label: 'Light', url: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json' },
  { id: 'voyager', label: 'Voyager', url: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json' },
]

const WEATHER_LAYER_SOURCE_ID = 'weather-radar-source'
const WEATHER_LAYER_ID = 'weather-radar-layer'

const VISIBILITY_COLORS = [
  { code: 'A', color: '#22c55e', label: 'Hilal easily visible' },
  { code: 'B', color: '#84cc16', label: 'Hilal visible under perfect conditions' },
  { code: 'C', color: '#2dd4bf', label: 'May need optical aid' },
  { code: 'D', color: '#facc15', label: 'Will need optical aid' },
  { code: 'E', color: '#fb923c', label: 'Not visible with telescope' },
  { code: 'F', color: 'rgba(0,0,0,0)', label: 'Below Danjon limit (7°)' },
  { code: 'G', color: '#a855f7', label: 'Sunset before new moon' },
  { code: 'H', color: '#3b82f6', label: 'No moonset' },
  { code: 'I', color: '#ef4444', label: 'Moonset before sunset' },
]

function formatDate(date) {
  const options = { weekday: "short", year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }
  return date.toLocaleString("en-US", options)
}

function formatDuration(duration) {
  const hours = Math.floor(duration), minutes = Math.floor((duration - hours) * 60), seconds = Math.floor(((duration - hours) * 60 - minutes) * 60)
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`
}

function toIsoDateInput(date) {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return localDate.toISOString().split('T')[0]
}

function getIslamicDateParts(date) {
  const parts = new Intl.DateTimeFormat('en-US-u-ca-islamic', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    weekday: 'long',
  }).formatToParts(date)
  const pick = (type) => parts.find((p) => p.type === type)?.value
  return {
    weekday: pick('weekday') || '',
    day: pick('day') || '--',
    monthName: pick('month') || '--',
    year: pick('year') || '--',
  }
}

function getIslamicNumeric(date) {
  const parts = new Intl.DateTimeFormat('en-US-u-ca-islamic', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  }).formatToParts(date)
  const day = parseInt(parts.find((p) => p.type === 'day')?.value ?? '0', 10)
  const month = parseInt(parts.find((p) => p.type === 'month')?.value ?? '0', 10)
  const year = parseInt(parts.find((p) => p.type === 'year')?.value ?? '0', 10)
  return { day, month, year }
}

function getDaysUntilRamadan(date) {
  const oneDay = 24 * 60 * 60 * 1000
  for (let i = 0; i <= 420; i += 1) {
    const probe = new Date(date.getTime() + i * oneDay)
    const islamic = getIslamicNumeric(probe)
    if (islamic.month === 9 && islamic.day === 1) return i
  }
  return null
}

function getQiblaBearing(lat, lng) {
  const kaabaLat = 21.4225 * (Math.PI / 180)
  const kaabaLng = 39.8262 * (Math.PI / 180)
  const latRad = lat * (Math.PI / 180)
  const lngRad = lng * (Math.PI / 180)
  const dLng = kaabaLng - lngRad
  const y = Math.sin(dLng) * Math.cos(kaabaLat)
  const x = Math.cos(latRad) * Math.sin(kaabaLat) - Math.sin(latRad) * Math.cos(kaabaLat) * Math.cos(dLng)
  const bearing = (Math.atan2(y, x) * 180) / Math.PI
  return (bearing + 360) % 360
}

function getWeatherCodeLabel(code) {
  if (code === 0) return 'Clear sky'
  if ([1, 2, 3].includes(code)) return 'Partly cloudy'
  if ([45, 48].includes(code)) return 'Fog'
  if ([51, 53, 55, 56, 57].includes(code)) return 'Drizzle'
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 'Rain'
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'Snow'
  if ([95, 96, 99].includes(code)) return 'Thunderstorm'
  return 'Unknown'
}

async function fetchElevationMeters(lat, lng) {
  const url = `https://api.open-meteo.com/v1/elevation?latitude=${lat.toFixed(5)}&longitude=${lng.toFixed(5)}`
  const res = await fetch(url)
  if (!res.ok) throw new Error('Elevation API request failed')
  const data = await res.json()
  const value = data?.elevation?.[0]
  if (typeof value !== 'number' || Number.isNaN(value)) throw new Error('Invalid elevation payload')
  return value
}

function getAntimeridianSafeFeature(h3Id, color) {
  const boundary = h3.cellToBoundary(h3Id)
  const lngs = boundary.map(b => b[1])
  let crosses = false
  for (let i = 0; i < lngs.length; i++) {
    const next = lngs[(i + 1) % lngs.length]
    if (Math.abs(lngs[i] - next) > 180) { crosses = true; break }
  }
  if (!crosses) {
    const coords = boundary.map(b => [b[1], b[0]])
    coords.push(coords[0])
    return { type: 'Feature', properties: { color }, geometry: { type: 'Polygon', coordinates: [coords] } }
  }
  const leftCoords = boundary.map(b => [b[1] < 0 ? b[1] + 360 : b[1], b[0]])
  const rightCoords = boundary.map(b => [b[1] > 0 ? b[1] - 360 : b[1], b[0]])
  leftCoords.push(leftCoords[0]); rightCoords.push(rightCoords[0])
  return { type: 'Feature', properties: { color }, geometry: { type: 'MultiPolygon', coordinates: [[leftCoords], [rightCoords]] } }
}

export default function App() {
  const [date, setDate] = useState(new Date())
  const [elevation, setElevation] = useState(100)
  const [coords, setCoords] = useState(null)
  const [recalculating, setRecalculating] = useState(false)
  const [hemisphere, setHemisphere] = useState('north')
  const [mapLoaded, setMapLoaded] = useState(false)
  const [dbReady, setDbReady] = useState(false)
  const [moonError, setMoonError] = useState(null)
  const [moonPhaseMsg, setMoonPhaseMsg] = useState(null)
  const [manualRes, setManualRes] = useState(null)
  const [mapStyle, setMapStyle] = useState(MAP_STYLES[0].id)
  const [mapMode, setMapMode] = useState('2d')
  const [locationName, setLocationName] = useState('Unknown location')
  const [locationLoading, setLocationLoading] = useState(false)
  const [weather, setWeather] = useState(null)
  const [weatherLoading, setWeatherLoading] = useState(false)
  const [weatherError, setWeatherError] = useState(null)
  const [showWeatherOverlay, setShowWeatherOverlay] = useState(false)
  const [weatherOverlayURL, setWeatherOverlayURL] = useState(null)
  const [elevationLoading, setElevationLoading] = useState(false)
  const [toast, setToast] = useState(null)

  const mapContainerRef = useRef(null)
  const mapRef = useRef(null)
  const markerRef = useRef(null)
  const workerRef = useRef(null)
  const toastTimerRef = useRef(null)
  const displayedResults = useRef(new Map())
  const currentResolution = useRef(1)

  const showToast = useCallback((message, tone = 'warning') => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setToast({ message, tone })
    toastTimerRef.current = setTimeout(() => setToast(null), 4500)
  }, [])

  useEffect(() => {
    initDB().then(() => setDbReady(true))
    workerRef.current = new Worker(new URL('./utils/worker.js', import.meta.url), { type: 'module' })
    workerRef.current.onmessage = async (e) => {
      const results = e.data
      await cacheResults(results, date, elevation)
      results.forEach(res => displayedResults.current.set(res.id, res))
      if (mapRef.current && mapLoaded) {
        updateMapWithResultsRef.current(Array.from(displayedResults.current.values()))
      }
      setRecalculating(false)
    }
    return () => workerRef.current?.terminate()
  }, [date, elevation, mapLoaded])

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (mapRef.current && coords && mapLoaded) {
      if (markerRef.current) markerRef.current.remove()
      markerRef.current = new maplibregl.Marker({ color: '#ef4444' }).setLngLat([coords[1], coords[0]]).addTo(mapRef.current)
    }
  }, [coords, mapLoaded])

  const updateMapWithResults = useCallback((results) => {
    if (!mapRef.current || !mapLoaded) return
    const features = results.map(res => getAntimeridianSafeFeature(res.id, res.color))
    const source = mapRef.current.getSource('moonsighting-grid')
    if (source) {
      source.setData({ type: 'FeatureCollection', features })
    } else {
      mapRef.current.addSource('moonsighting-grid', { type: 'geojson', data: { type: 'FeatureCollection', features } })
      mapRef.current.addLayer({
        id: 'moonsighting-grid', type: 'fill', source: 'moonsighting-grid',
        paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.4, 'fill-antialias': false }
      })
    }
  }, [mapLoaded])

  const updateMapWithResultsRef = useRef(updateMapWithResults)
  updateMapWithResultsRef.current = updateMapWithResults

  const syncWeatherOverlay = useCallback(() => {
    if (!mapRef.current || !mapLoaded) return
    const map = mapRef.current
    const existingLayer = map.getLayer(WEATHER_LAYER_ID)
    const existingSource = map.getSource(WEATHER_LAYER_SOURCE_ID)

    if (!showWeatherOverlay || !weatherOverlayURL) {
      if (existingLayer) map.removeLayer(WEATHER_LAYER_ID)
      if (existingSource) map.removeSource(WEATHER_LAYER_SOURCE_ID)
      return
    }

    if (!existingSource) {
      map.addSource(WEATHER_LAYER_SOURCE_ID, {
        type: 'raster',
        tiles: [weatherOverlayURL],
        tileSize: 256,
      })
    }
    if (!existingLayer) {
      map.addLayer({
        id: WEATHER_LAYER_ID,
        type: 'raster',
        source: WEATHER_LAYER_SOURCE_ID,
        paint: {
          'raster-opacity': 0.55,
          'raster-resampling': 'linear',
        },
      })
    }
  }, [mapLoaded, showWeatherOverlay, weatherOverlayURL])

  const updateH3Grid = useCallback(async () => {
    if (!mapRef.current || !mapLoaded || !dbReady) return
    const map = mapRef.current, bounds = map.getBounds(), zoom = map.getZoom()
    
    let res = manualRes
    if (res === null) {
      res = 1
      if (zoom > 3) res = 2
      if (zoom > 4.5) res = 3
      if (zoom > 6) res = 4
      if (zoom > 8) res = 5
    }

    if (currentResolution.current !== res) {
      displayedResults.current.clear()
      currentResolution.current = res
    }

    const nw = bounds.getNorthWest(), ne = bounds.getNorthEast(), se = bounds.getSouthEast(), sw = bounds.getSouthWest()
    const polygon = [[nw.lat, nw.lng], [ne.lat, ne.lng], [se.lat, se.lng], [sw.lat, sw.lng], [nw.lat, nw.lng]]

    try {
      const hexes = h3.polygonToCells(polygon, res)
      const cached = await getCachedResults(hexes, date, elevation)
      const cachedIds = new Set(cached.map(c => c.id))
      const missingHexes = hexes.filter(h => !cachedIds.has(h))
      cached.forEach(c => displayedResults.current.set(c.id, c))
      
      if (missingHexes.length > 0) {
        setRecalculating(true)
        const points = missingHexes.map(h => { const [lat, lng] = h3.cellToLatLng(h); return { id: h, lat, lng } })
        workerRef.current.postMessage({ points, elevation, date, options: { yallop: true } })
      } else {
        updateMapWithResults(Array.from(displayedResults.current.values()))
      }
    } catch (e) { console.error("H3 Grid Error:", e) }
  }, [date, elevation, mapLoaded, dbReady, manualRes, updateMapWithResults])

  const locateUser = useCallback(() => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition((p) => {
        const { latitude, longitude } = p.coords
        setCoords([latitude, longitude]); setHemisphere(getHemisphere(latitude))
        if (mapRef.current) mapRef.current.flyTo({ center: [longitude, latitude], zoom: 5 })
      })
    }
  }, [])

  useEffect(() => { if (mapLoaded && dbReady) { updateH3Grid(); locateUser() } }, [mapLoaded, dbReady, locateUser])
  useEffect(() => {
    if (mapLoaded && dbReady) {
      displayedResults.current.clear(); updateH3Grid()
      const phase = Astronomy.MoonPhase(Astronomy.MakeTime(date))
      setMoonPhaseMsg(phase > 180 ? "Waning phase (Moonsighting is for waxing crescent)" : null)
    }
  }, [date, elevation, mapLoaded, dbReady, updateH3Grid])

  useEffect(() => {
    if (moonPhaseMsg) showToast(`⚠️ ${moonPhaseMsg}`, 'warning')
  }, [moonPhaseMsg, showToast])

  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return
    const onMoveEnd = () => updateH3Grid()
    mapRef.current.on('moveend', onMoveEnd)
    return () => mapRef.current.off('moveend', onMoveEnd)
  }, [mapLoaded, updateH3Grid])

  useEffect(() => {
    if (mapRef.current) return
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: MAP_STYLES[0].url,
      center: [20, 0], zoom: 2,
      preserveDrawingBuffer: true,
    })
    map.on('load', () => { mapRef.current = map; setMapLoaded(true) })
    map.on('click', (e) => { setCoords([e.lngLat.lat, e.lngLat.lng]); setHemisphere(getHemisphere(e.lngLat.lat)) })
    return () => map.remove()
  }, [])

  useEffect(() => {
    if (!mapRef.current) return
    const selected = MAP_STYLES.find((style) => style.id === mapStyle)
    if (!selected) return
    mapRef.current.setStyle(selected.url)
    mapRef.current.once('style.load', () => {
      updateMapWithResultsRef.current(Array.from(displayedResults.current.values()))
      syncWeatherOverlay()
    })
  }, [mapStyle, syncWeatherOverlay])

  useEffect(() => {
    if (!mapRef.current) return
    if (mapMode === '3d') {
      mapRef.current.easeTo({ pitch: 60, bearing: 20, duration: 600 })
    } else {
      mapRef.current.easeTo({ pitch: 0, bearing: 0, duration: 600 })
    }
  }, [mapMode])

  useEffect(() => {
    if (!coords) return
    let cancelled = false
    setLocationLoading(true)
    geocode([coords[1], coords[0]])
      .then((name) => {
        if (!cancelled) setLocationName(name)
      })
      .catch(() => {
        if (!cancelled) setLocationName('Location name unavailable')
      })
      .finally(() => {
        if (!cancelled) setLocationLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [coords])

  useEffect(() => {
    if (!coords) {
      setElevation(100)
      return
    }

    let cancelled = false
    setElevationLoading(true)

    fetchElevationMeters(coords[0], coords[1])
      .then((value) => {
        if (!cancelled) setElevation(Math.round(value))
      })
      .catch(() => {
        if (!cancelled) setElevation(100)
      })
      .finally(() => {
        if (!cancelled) setElevationLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [coords])

  useEffect(() => {
    if (!coords) return
    const controller = new AbortController()
    setWeatherLoading(true)
    setWeatherError(null)

    const [lat, lng] = coords
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}&current=temperature_2m,relative_humidity_2m,cloud_cover,wind_speed_10m,precipitation,weather_code&timezone=auto`
    fetch(url, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error('Weather API request failed')
        return res.json()
      })
      .then((data) => {
        if (!data.current) throw new Error('Weather data unavailable')
        const current = data.current
        setWeather({
          tempC: current.temperature_2m,
          humidity: current.relative_humidity_2m,
          cloudCover: current.cloud_cover,
          windKph: current.wind_speed_10m,
          precipitation: current.precipitation,
          weatherCode: current.weather_code,
          weatherLabel: getWeatherCodeLabel(current.weather_code),
          time: current.time,
        })
      })
      .catch((err) => {
        if (err.name === 'AbortError') return
        setWeatherError('Weather data unavailable')
      })
      .finally(() => {
        if (!controller.signal.aborted) setWeatherLoading(false)
      })

    return () => controller.abort()
  }, [coords])

  useEffect(() => {
    let cancelled = false
    fetch('https://api.rainviewer.com/public/weather-maps.json')
      .then((res) => {
        if (!res.ok) throw new Error('RainViewer request failed')
        return res.json()
      })
      .then((data) => {
        if (cancelled) return
        const latestPast = data?.radar?.past?.at(-1)
        if (!latestPast?.path || !data?.host) return
        setWeatherOverlayURL(`${data.host}${latestPast.path}/256/{z}/{x}/{y}/2/1_1.png`)
      })
      .catch(() => {
        if (!cancelled) setWeatherOverlayURL(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    syncWeatherOverlay()
  }, [syncWeatherOverlay])

  const details = coords ? calculate(coords[0], coords[1], elevation, date, { yallop: true }) : null
  const moonImageURLs = getMoonImageURLs(date, hemisphere === 'south')
  const moonIllumination = useMemo(() => {
    const illum = Astronomy.Illumination(Astronomy.Body.Moon, Astronomy.MakeTime(date))
    return Math.max(0, Math.min(100, illum.phase_fraction * 100))
  }, [date])
  const islamicDate = useMemo(() => getIslamicDateParts(date), [date])
  const islamicNumeric = useMemo(() => getIslamicNumeric(date), [date])
  const daysUntilRamadan = useMemo(() => getDaysUntilRamadan(date), [date])
  const qiblaBearing = useMemo(() => {
    if (!coords) return null
    return getQiblaBearing(coords[0], coords[1])
  }, [coords])

  const handleDateChange = (d) => {
    const next = new Date(date); next.setDate(date.getDate() + d); setDate(next)
  }

  const exportMap = () => {
    if (!mapRef.current) return
    try {
      const link = document.createElement('a')
      link.download = `moonsighting-${date.toISOString().split('T')[0]}.png`
      link.href = mapRef.current.getCanvas().toDataURL('image/png')
      link.click()
      showToast('Map snapshot exported.', 'success')
    } catch (error) {
      console.error('Map export failed', error)
      showToast('Map snapshot failed. Try changing basemap or reload.', 'error')
    }
  }

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-slate-950 text-slate-100 font-sans">
      <header className="h-16 flex items-center justify-between px-6 bg-slate-900/95 border-b border-slate-700/60 z-10 backdrop-blur">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🌙</span>
          <h1 className="text-xl font-semibold tracking-tight">
            Hilal-liqo Moon Sighting Dashboard
            <span className="text-cyan-300 font-normal text-sm ml-2">Global Visibility & Ramadan Sighting</span>
          </h1>
        </div>

        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 bg-slate-950 rounded-xl p-1 border border-slate-700/70">
            <button onClick={() => handleDateChange(-1)} className="p-1 px-3 hover:bg-slate-700 rounded-lg transition">←</button>
            <input type="date" value={toIsoDateInput(date)} onChange={(e) => setDate(new Date(e.target.value))}
              className="bg-transparent border-none focus:ring-0 text-sm px-2 cursor-pointer" />
            <button onClick={() => handleDateChange(1)} className="p-1 px-3 hover:bg-slate-700 rounded-lg transition">→</button>
          </div>

          <div className="flex items-center gap-2 text-sm">
            <span className="text-slate-400 uppercase text-xs font-bold">Elev:</span>
            <input type="number" value={elevation} onChange={(e) => setElevation(parseFloat(e.target.value) || 0)}
              className="w-20 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-center" />
            <span className="text-slate-400">m</span>
            {elevationLoading && <span className="text-[11px] text-cyan-300">auto...</span>}
          </div>

          <button onClick={locateUser} className="bg-cyan-600 hover:bg-cyan-500 text-white px-4 py-2 rounded-xl text-sm font-medium transition shadow-lg flex items-center gap-2">
            <span>📍</span> Locate Me
          </button>
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden relative">
        <aside className="w-88 flex flex-col border-r border-slate-700/60 bg-slate-900/85 overflow-y-auto shrink-0">
          <section className="p-5 border-b border-slate-700/60">
            {details ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-slate-700/70 bg-slate-950/70 p-3">
                  <div className="flex items-start gap-3">
                    <div className="min-w-14 h-14 rounded-xl bg-cyan-500/20 border border-cyan-400/40 flex items-center justify-center">
                      <span className="text-3xl font-black text-cyan-300 leading-none">{details.qcode}</span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs text-slate-400 font-bold uppercase tracking-wider mb-1">Visibility Status</p>
                      <p className="text-sm font-semibold text-slate-100 leading-snug break-words">{YALLOP_CRITERIA[details.qcode]}</p>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-4 text-slate-500 italic text-sm">
                Click map to inspect location details
              </div>
            )}
          </section>

          <section className="p-5 border-b border-slate-700/60 space-y-3">
            <h3 className="text-xs font-bold uppercase text-slate-400 tracking-wider">Legend</h3>
            <div className="space-y-2">
              {VISIBILITY_COLORS.filter(c => c.code !== 'J' && c.code !== 'F').map((item) => (
                <div key={item.code} className="flex items-center gap-3 text-sm">
                  <span className="w-4 h-4 rounded-sm border border-black/20" style={{ background: item.color }}></span>
                  <span className="font-bold w-5 text-slate-400">{item.code}</span>
                  <span className="text-slate-300">{item.label}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="p-5 border-b border-slate-700/60 space-y-4">
            <h3 className="text-xs font-bold uppercase text-slate-400 tracking-wider">Astronomical Data</h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800">
                <p className="text-slate-400 mb-1 text-xs">Lag Time</p>
                <p className="font-mono text-slate-100">{details ? formatDuration(details.lagTime) : '--:--:--'}</p>
              </div>
              <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800">
                <p className="text-slate-400 mb-1 text-xs">Elongation</p>
                <p className="text-slate-100">{details ? `${details.arcl?.toFixed(2)}°` : '--°'}</p>
              </div>
              <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800">
                <p className="text-slate-400 mb-1 text-xs">Sunset</p>
                <p className="text-slate-100">{details ? formatDate(details.sunsetSunrise).split(',')[1] : '--'}</p>
              </div>
              <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800">
                <p className="text-slate-400 mb-1 text-xs">Moonset</p>
                <p className="text-slate-100">{details ? formatDate(details.moonsetMoonrise).split(',')[1] : '--'}</p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-2 text-sm">
              <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800">
                <p className="text-slate-400 mb-1 text-xs">Moon Illumination</p>
                <p className="text-slate-100 font-medium">{moonIllumination.toFixed(1)}%</p>
              </div>
              <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800">
                <p className="text-slate-400 mb-1 text-xs">Qibla Bearing</p>
                <p className="text-slate-100 font-medium">{qiblaBearing == null ? '--' : `${qiblaBearing.toFixed(1)}° from North`}</p>
              </div>
            </div>
          </section>

          <section className="p-5 border-b border-slate-700/60 space-y-4">
            <h3 className="text-xs font-bold uppercase text-slate-400 tracking-wider">Islamic Calendar</h3>
            <div className="bg-slate-950/70 p-4 rounded-xl border border-slate-800 space-y-2">
              <p className="text-sm font-semibold text-slate-100">🗓️ {islamicDate.weekday}</p>
              <p className="text-lg font-semibold text-cyan-300">{islamicDate.day} {islamicDate.monthName} {islamicDate.year} AH</p>
              <p className="text-xs text-slate-400">
                {islamicNumeric.month === 9
                  ? `Ramadan day ${islamicNumeric.day}`
                  : daysUntilRamadan == null
                    ? 'Ramadan estimate unavailable'
                    : `${daysUntilRamadan} day(s) until 1 Ramadan`}
              </p>
            </div>
          </section>

          <div className="flex-1" />
        </aside>

        <section className="flex-1 relative bg-slate-950">
          <div ref={mapContainerRef} className="w-full h-full" />

          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 rounded-full border border-slate-700/70 bg-slate-900/80 px-2 py-2 backdrop-blur">
            <span className="text-xs text-slate-300 px-2">Basemap</span>
            {MAP_STYLES.map((style) => (
              <button
                key={style.id}
                onClick={() => setMapStyle(style.id)}
                className={`rounded-full px-3 py-1.5 text-xs transition ${mapStyle === style.id ? 'bg-cyan-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
              >
                {style.label}
              </button>
            ))}
            <div className="mx-1 h-5 w-px bg-slate-700" />
            <button
              onClick={() => setMapMode(mapMode === '2d' ? '3d' : '2d')}
              className={`rounded-full px-3 py-1.5 text-xs transition ${mapMode === '3d' ? 'bg-violet-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
            >
              {mapMode === '3d' ? '3D' : '2D'}
            </button>
            <button
              onClick={() => setShowWeatherOverlay((prev) => !prev)}
              className={`rounded-full px-3 py-1.5 text-xs transition ${showWeatherOverlay ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
              title={weatherOverlayURL ? 'Toggle precipitation radar overlay (RainViewer)' : 'Radar overlay not available right now'}
            >
              Radar
            </button>
          </div>

          <div className="absolute top-4 right-4 z-20 rounded-xl border border-slate-700/70 bg-slate-900/70 backdrop-blur px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="text-[11px] uppercase tracking-wider text-slate-400">Grid</span>
              {[null, 1, 2, 3, 4].map((r) => (
                <button
                  key={r}
                  onClick={() => setManualRes(r)}
                  className={`text-[11px] px-2 py-1 rounded-md border transition ${manualRes === r ? 'bg-cyan-600 border-cyan-500 text-white' : 'bg-slate-950/60 border-slate-700 text-slate-300 hover:border-slate-500'}`}
                >
                  {r === null ? 'Auto' : `R${r}`}
                </button>
              ))}
              <button
                onClick={exportMap}
                className="text-[11px] px-2.5 py-1 rounded-md border border-slate-600 bg-slate-800 text-slate-100 hover:bg-slate-700 transition"
              >
                Export PNG
              </button>
            </div>
          </div>

          {(recalculating || !dbReady) && (
            <div className="absolute top-20 left-1/2 -translate-x-1/2 bg-slate-900/90 backdrop-blur-md border border-slate-700 px-6 py-3 rounded-full shadow-2xl z-20 flex items-center gap-3">
              <div className="w-4 h-4 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-xs font-medium text-cyan-300 tracking-wide uppercase">
                {!dbReady ? 'System Initialization...' : 'Analyzing Visibility...'}
              </span>
            </div>
          )}

          <div className="absolute bottom-6 left-6 bg-slate-900/80 backdrop-blur border border-slate-700 p-3 rounded-xl text-xs text-slate-300 max-w-sm pointer-events-none">
            <p className="font-medium text-slate-100 mb-1">Interactive hints</p>
            <p>Pan/zoom to recalculate visibility. H3 Resolution: {currentResolution.current}. 3D mode uses camera pitch for terrain-like perspective.</p>
          </div>

          {toast && (
            <div className={`absolute right-6 bottom-6 z-30 max-w-sm rounded-xl border px-4 py-3 text-sm shadow-xl backdrop-blur ${
              toast.tone === 'warning'
                ? 'bg-amber-900/70 border-amber-600/60 text-amber-100'
                : toast.tone === 'error'
                  ? 'bg-rose-900/70 border-rose-600/60 text-rose-100'
                  : 'bg-emerald-900/70 border-emerald-600/60 text-emerald-100'
            }`}>
              <div className="flex items-start gap-3">
                <p className="leading-snug">{toast.message}</p>
                <button onClick={() => setToast(null)} className="text-xs opacity-80 hover:opacity-100">✕</button>
              </div>
            </div>
          )}
        </section>

        <aside className="w-80 border-l border-slate-700/60 bg-slate-900/85 flex flex-col shrink-0 overflow-y-auto">
          <section className="p-6 space-y-6">
            <div className="space-y-3">
              <h3 className="text-xs font-bold uppercase text-slate-400 tracking-wider text-center">Moon Visual</h3>
              {moonError ? (
                <div className="aspect-square bg-slate-950 rounded-xl flex items-center justify-center text-xs text-red-400 p-4 text-center">
                  {moonError}
                </div>
              ) : (
                <div className="relative group">
                  <div className="absolute -inset-1 bg-gradient-to-r from-cyan-600 to-violet-600 rounded-xl blur opacity-25 group-hover:opacity-45 transition duration-1000"></div>
                  <img src={moonImageURLs.jpg} alt="Moon Phase" className="relative aspect-square w-full rounded-xl shadow-2xl border border-slate-700" />
                </div>
              )}
              <div className="text-center space-y-1">
                <p className="text-sm font-semibold text-slate-100">{formatDate(date).split(',')[0]}</p>
                <p className="text-xs text-slate-400">Hemisphere view: <span className="text-slate-200">{hemisphere}</span></p>
                <a href="https://svs.gsfc.nasa.gov/" target="_blank" rel="noopener noreferrer" className="text-xs text-cyan-300 hover:underline">NASA Scientific Visualization Studio</a>
              </div>
            </div>

            <div className="bg-slate-950/70 rounded-xl border border-slate-800 p-4 space-y-2">
              <p className="text-xs text-slate-400 uppercase tracking-wider">Location details</p>
              {coords ? (
                <>
                  <p className="text-sm text-slate-200 font-medium">📍 {coords[0].toFixed(4)}°, {coords[1].toFixed(4)}° ({hemisphere})</p>
                  <p className="text-xs text-slate-400">{locationLoading ? 'Finding location...' : locationName}</p>
                </>
              ) : (
                <p className="text-sm text-slate-400">Select a location on the map to view coordinates.</p>
              )}
            </div>

            <div className="bg-slate-950/70 rounded-xl border border-slate-800 p-4 space-y-2">
              <p className="text-xs text-slate-400 uppercase tracking-wider">Local weather</p>
              {!coords ? (
                <p className="text-sm text-slate-400">Select a location on the map to load weather.</p>
              ) : weatherLoading ? (
                <p className="text-sm text-slate-300">Loading weather...</p>
              ) : weatherError ? (
                <p className="text-sm text-amber-300">{weatherError}</p>
              ) : weather ? (
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-2">
                    <p className="text-xs text-slate-400">Condition</p>
                    <p className="font-medium text-slate-100">{weather.weatherLabel}</p>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-2">
                    <p className="text-xs text-slate-400">Temperature</p>
                    <p className="font-medium text-slate-100">{weather.tempC?.toFixed(1)}°C</p>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-2">
                    <p className="text-xs text-slate-400">Cloud cover</p>
                    <p className="font-medium text-slate-100">{weather.cloudCover ?? '--'}%</p>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-2">
                    <p className="text-xs text-slate-400">Wind</p>
                    <p className="font-medium text-slate-100">{weather.windKph?.toFixed(1)} km/h</p>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-2">
                    <p className="text-xs text-slate-400">Humidity</p>
                    <p className="font-medium text-slate-100">{weather.humidity ?? '--'}%</p>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-2">
                    <p className="text-xs text-slate-400">Precipitation</p>
                    <p className="font-medium text-slate-100">{weather.precipitation?.toFixed(1)} mm</p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-slate-400">Weather data unavailable.</p>
              )}
              <p className="text-xs text-slate-500">
                Source: Open-Meteo (point forecast){' '}
                {showWeatherOverlay ? 'and RainViewer radar overlay enabled.' : 'and RainViewer radar overlay is off.'}
              </p>
            </div>

            <div className="pt-2 border-t border-slate-700 space-y-3 text-sm text-slate-400 leading-relaxed">
              <p>Visibility is modeled with Yallop criteria using Sun-Moon geometry near best observation time.</p>
              {/* <p className="flex items-center gap-2"><span className="inline-block h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />Use high-contrast crescent windows near Ramadan verification dates.</p> */}
            </div>
          </section>
        </aside>
      </main>
    </div>
  )
}
