import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import * as mgrs from 'mgrs'
import './style.css'

const SATLAS_OVERHEAD = 'https://satlas.app/api/overhead'
const OBSTRUCTION_SECTORS = 12
const MAX_OBSTRUCTION_DEG = 90

function normalizeObstructions(text) {
  const values = text
    .split(/[\s,;]+/)
    .map((value) => value.trim())
    .filter(Boolean)
    .map(Number)

  if (values.length !== OBSTRUCTION_SECTORS || values.some((value) => !Number.isFinite(value))) {
    return null
  }

  return values.map((value) => Math.min(Math.max(value, 0), MAX_OBSTRUCTION_DEG) / MAX_OBSTRUCTION_DEG)
}

function normalizeArray(values) {
  if (values.length !== OBSTRUCTION_SECTORS || values.some((value) => !Number.isFinite(value))) {
    return null
  }

  const maxValue = Math.max(...values)
  const divisor = maxValue <= 1 ? 1 : maxValue <= MAX_OBSTRUCTION_DEG ? MAX_OBSTRUCTION_DEG : 100
  return values.map((value) => Math.min(Math.max(value / divisor, 0), 1))
}

function scorePath(path) {
  const lowerPath = path.toLowerCase()
  let score = 0
  for (const word of ['obstruction', 'obstructed', 'wedge', 'sky', 'azimuth', 'fraction']) {
    if (lowerPath.includes(word)) score += 2
  }
  if (lowerPath.includes('debug')) score += 1
  return score
}

function findObstructionArray(value, path = 'debug') {
  if (Array.isArray(value)) {
    if (value.length === OBSTRUCTION_SECTORS && value.every((item) => typeof item === 'number')) {
      return { values: value, path, score: scorePath(path) }
    }

    return value.reduce((best, item, index) => {
      const found = findObstructionArray(item, `${path}[${index}]`)
      return found && (!best || found.score > best.score) ? found : best
    }, null)
  }

  if (!value || typeof value !== 'object') return null

  return Object.entries(value).reduce((best, [key, item]) => {
    const nextPath = `${path}.${key}`
    const found = findObstructionArray(item, nextPath)
    return found && (!best || found.score > best.score) ? found : best
  }, null)
}

function polarPoint(angleDeg, radius, center, northOffset = -90) {
  const angleRad = ((angleDeg + northOffset) * Math.PI) / 180
  return {
    x: center + radius * Math.cos(angleRad),
    y: center + radius * Math.sin(angleRad),
  }
}

function ObstructionMap({ wedges }) {
  const size = 600
  const center = size / 2
  const radius = 290
  const angleSpan = 360 / OBSTRUCTION_SECTORS

  return (
    <svg className="obstructionMap" viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Starlink obstruction map">
      <circle cx={center} cy={center} r={radius} fill="#0067bc" />
      {wedges.map((value, index) => {
        const obstructionRadius = radius * value
        if (!obstructionRadius) return null

        const startAngle = index * angleSpan
        const endAngle = startAngle + angleSpan
        const start = polarPoint(startAngle, obstructionRadius, center)
        const end = polarPoint(endAngle, obstructionRadius, center)
        const outerStart = polarPoint(startAngle, radius, center)
        const outerEnd = polarPoint(endAngle, radius, center)

        return (
          <g key={index}>
            <path
              d={`M ${center} ${center} L ${start.x} ${start.y} A ${obstructionRadius} ${obstructionRadius} 0 0 1 ${end.x} ${end.y} Z`}
              fill="#820000"
              opacity="0.88"
            />
            <path d={`M ${outerStart.x} ${outerStart.y} A ${radius} ${radius} 0 0 1 ${outerEnd.x} ${outerEnd.y}`} stroke="#ffffff44" strokeWidth="2" fill="none" />
          </g>
        )
      })}
      <line x1={center} y1="10" x2={center} y2="590" stroke="white" strokeWidth="2" />
      <line x1="10" y1={center} x2="590" y2={center} stroke="white" strokeWidth="2" />
      <text x={center} y="24" textAnchor="middle">N</text>
      <text x={center} y="594" textAnchor="middle">S</text>
      <text x="7" y={center + 5}>W</text>
      <text x="593" y={center + 5} textAnchor="end">E</text>
    </svg>
  )
}

function App() {
  const [mgrsText, setMgrsText] = useState('')
  const [minElevation, setMinElevation] = useState(25)
  const [limit, setLimit] = useState(25)
  const [obstructionText, setObstructionText] = useState('0 0 0 0 0 0 0 0 0 0 0 0')
  const [debugText, setDebugText] = useState('')
  const [obstructions, setObstructions] = useState(Array(OBSTRUCTION_SECTORS).fill(0))
  const [obstructionError, setObstructionError] = useState('')
  const [obstructionSource, setObstructionSource] = useState('Manual input')
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  function generateObstructions(event) {
    event.preventDefault()
    const nextObstructions = normalizeObstructions(obstructionText)
    if (!nextObstructions) {
      setObstructionError(`Enter ${OBSTRUCTION_SECTORS} numbers between 0 and ${MAX_OBSTRUCTION_DEG}, separated by spaces or commas.`)
      return
    }

    setObstructions(nextObstructions)
    setObstructionSource('Manual input')
    setObstructionError('')
  }

  function importDebugJson(event) {
    event.preventDefault()
    setObstructionError('')

    let debugData
    try {
      debugData = JSON.parse(debugText)
    } catch {
      setObstructionError('Paste valid Starlink debug JSON, or a JSON array of 12 numbers.')
      return
    }

    const found = findObstructionArray(debugData)
    const nextObstructions = found && normalizeArray(found.values)
    if (!nextObstructions) {
      setObstructionError('Could not find a numeric 12-sector obstruction array in that JSON.')
      return
    }

    setObstructions(nextObstructions)
    setObstructionText(found.values.map((value) => String(value)).join(' '))
    setObstructionSource(`Imported from ${found.path}`)
  }

  async function search(event) {
    event.preventDefault()
    setError('')
    setResult(null)

    let latitude, longitude
    try {
      ;[longitude, latitude] = mgrs.toPoint(mgrsText.trim().replace(/\s+/g, ' '))
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) throw new Error()
    } catch {
      setError('Enter a valid MGRS coordinate, for example: 33UXP04')
      return
    }

    const params = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      min_elevation: String(minElevation),
      category: 'STARLINK',
      limit: String(limit),
    })

    setLoading(true)
    try {
      const response = await fetch(`${SATLAS_OVERHEAD}?${params}`)
      if (!response.ok) throw new Error(await response.text())
      const data = await response.json()
      setResult({ latitude, longitude, data })
    } catch (err) {
      setError(`Satlas request failed: ${err.message || 'unknown error'}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">Starlink horizon search</p>
        <h1>Find Starlink satellites visible from an MGRS grid.</h1>
        <p>
          Converts your MGRS coordinate to latitude/longitude and asks Satlas for Starlink satellites currently above your usable horizon.
        </p>
      </section>

      <form className="card form" onSubmit={search}>
        <label>
          MGRS coordinate
          <input value={mgrsText} onChange={(e) => setMgrsText(e.target.value)} placeholder="33UXP04" autoFocus />
        </label>
        <label>
          Usable horizon / obstruction angle
          <input type="number" min="0" max="89" value={minElevation} onChange={(e) => setMinElevation(e.target.value)} />
          <small>Use 10° for a clear horizon, 25–40° for nearby trees/buildings around a terminal.</small>
        </label>
        <label>
          Max results
          <input type="number" min="1" max="50" value={limit} onChange={(e) => setLimit(e.target.value)} />
        </label>
        <button disabled={loading}>{loading ? 'Searching…' : 'Search visible Starlinks'}</button>
      </form>

      <section className="card obstructionCard">
        <div>
          <h2>Obstruction generator</h2>
          <p>
            Paste Starlink debug JSON from your phone, or use 12 manual obstruction values clockwise from north. Arrays using 0–1 fractions, 0–90 degrees, or 0–100 percentages are normalized automatically.
          </p>
          <form className="obstructionForm" onSubmit={importDebugJson}>
            <label>
              Starlink debug JSON
              <textarea value={debugText} onChange={(e) => setDebugText(e.target.value)} rows="6" placeholder='{"obstructions":[0,5,12,25,40,55,80,90,30,15,0,0]}' />
            </label>
            <button>Parse debug JSON</button>
          </form>
          <form className="obstructionForm" onSubmit={generateObstructions}>
            <label>
              Manual obstruction sectors
              <textarea value={obstructionText} onChange={(e) => setObstructionText(e.target.value)} rows="4" />
            </label>
            <button>Generate obstruction map</button>
          </form>
          <p className="source">{obstructionSource}</p>
          {obstructionError && <p className="error">{obstructionError}</p>}
        </div>
        <ObstructionMap wedges={obstructions} />
      </section>

      {error && <p className="error">{error}</p>}

      {result && (
        <section className="card">
          <div className="summary">
            <div>
              <strong>{result.data.count}</strong> Starlink satellites above {minElevation}°
            </div>
            <span>{result.latitude.toFixed(6)}, {result.longitude.toFixed(6)}</span>
          </div>
          <div className="tableWrap">
            <table>
              <thead><tr><th>Name</th><th>NORAD</th><th>Elevation</th><th>Azimuth</th><th>Direction</th></tr></thead>
              <tbody>
                {result.data.satellites.map((sat) => (
                  <tr key={sat.norad_id}>
                    <td>{sat.name}</td><td>{sat.norad_id}</td><td>{sat.elevation_deg.toFixed(1)}°</td><td>{sat.azimuth_deg.toFixed(1)}°</td><td>{sat.direction}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="note">
        <h2>Elevation map note</h2>
        <p>
          Satlas calculates geometric visibility above a flat local horizon. The obstruction angle above approximates terrain, trees, and roofs. A production version can improve this with a digital elevation model plus a tree/building survey to compute azimuth-specific horizon masks instead of one global angle.
        </p>
      </section>
    </main>
  )
}

createRoot(document.getElementById('root')).render(<App />)
