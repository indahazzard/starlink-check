<script>
  import * as mgrs from 'mgrs'
  import ObstructionMap from './ObstructionMap.svelte'

  const SATLAS_OVERHEAD = 'https://satlas.app/api/overhead'
  const OBSTRUCTION_SECTORS = 12
  const MAX_OBSTRUCTION_DEG = 90

  let mgrsText = $state('')
  let minElevation = $state(25)
  let limit = $state(25)
  let obstructionText = $state('0 0 0 0 0 0 0 0 0 0 0 0')
  let debugText = $state('')
  let obstructions = $state(Array(OBSTRUCTION_SECTORS).fill(0))
  let obstructionError = $state('')
  let obstructionSource = $state('Manual input')
  let result = $state(null)
  let error = $state('')
  let loading = $state(false)

  const debugPlaceholder = '{"obstructions":[0,5,12,25,40,55,80,90,30,15,0,0]}'

  function normalizeObstructions(text) {
    const values = text
      .split(/[\s,;]+/)
      .map((v) => v.trim())
      .filter(Boolean)
      .map(Number)
    if (values.length !== OBSTRUCTION_SECTORS || values.some((v) => !Number.isFinite(v))) return null
    return values.map((v) => Math.min(Math.max(v, 0), MAX_OBSTRUCTION_DEG) / MAX_OBSTRUCTION_DEG)
  }

  function normalizeArray(values) {
    if (values.length !== OBSTRUCTION_SECTORS || values.some((v) => !Number.isFinite(v))) return null
    const maxValue = Math.max(...values)
    const divisor = maxValue <= 1 ? 1 : maxValue <= MAX_OBSTRUCTION_DEG ? MAX_OBSTRUCTION_DEG : 100
    return values.map((v) => Math.min(Math.max(v / divisor, 0), 1))
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
      const found = findObstructionArray(item, `${path}.${key}`)
      return found && (!best || found.score > best.score) ? found : best
    }, null)
  }

  function generateObstructions(event) {
    event.preventDefault()
    const next = normalizeObstructions(obstructionText)
    if (!next) {
      obstructionError = `Enter ${OBSTRUCTION_SECTORS} numbers between 0 and ${MAX_OBSTRUCTION_DEG}, separated by spaces or commas.`
      return
    }
    obstructions = next
    obstructionSource = 'Manual input'
    obstructionError = ''
  }

  function importDebugJson(event) {
    event.preventDefault()
    obstructionError = ''
    let debugData
    try {
      debugData = JSON.parse(debugText)
    } catch {
      obstructionError = 'Paste valid Starlink debug JSON, or a JSON array of 12 numbers.'
      return
    }
    const found = findObstructionArray(debugData)
    const next = found && normalizeArray(found.values)
    if (!next) {
      obstructionError = 'Could not find a numeric 12-sector obstruction array in that JSON.'
      return
    }
    obstructions = next
    obstructionText = found.values.map(String).join(' ')
    obstructionSource = `Imported from ${found.path}`
  }

  function isClear(sat) {
    const sector = Math.floor(sat.azimuth_deg / (360 / OBSTRUCTION_SECTORS)) % OBSTRUCTION_SECTORS
    return sat.elevation_deg > obstructions[sector] * MAX_OBSTRUCTION_DEG
  }

  async function search(event) {
    event.preventDefault()
    error = ''
    result = null
    let latitude, longitude
    try {
      ;[longitude, latitude] = mgrs.toPoint(mgrsText.trim().replace(/\s+/g, ' '))
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) throw new Error()
    } catch {
      error = 'Enter a valid MGRS coordinate, for example: 33UXP04'
      return
    }
    const params = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      min_elevation: String(minElevation),
      category: 'STARLINK',
      limit: String(limit),
    })
    loading = true
    try {
      const response = await fetch(`${SATLAS_OVERHEAD}?${params}`)
      if (!response.ok) throw new Error(await response.text())
      const data = await response.json()
      result = { latitude, longitude, data }
    } catch (err) {
      error = `Satlas request failed: ${err.message || 'unknown error'}`
    } finally {
      loading = false
    }
  }
</script>

<main class="shell">
  <section class="hero">
    <p class="eyebrow">Starlink horizon search</p>
    <h1>Find Starlink satellites visible from an MGRS grid.</h1>
    <p>Converts your MGRS coordinate to latitude/longitude and asks Satlas for Starlink satellites currently above your usable horizon.</p>
  </section>

  <form class="card form" onsubmit={search}>
    <label>
      MGRS coordinate
      <input bind:value={mgrsText} placeholder="33UXP04" autofocus />
    </label>
    <label>
      Usable horizon / obstruction angle
      <input type="number" min="0" max="89" bind:value={minElevation} />
    </label>
    <label>
      Max results
      <input type="number" min="1" max="50" bind:value={limit} />
    </label>
    <button disabled={loading}>{loading ? 'Searching…' : 'Search visible Starlinks'}</button>
    <p class="hint">Use 10° for a clear horizon, 25–40° for nearby trees/buildings around a terminal.</p>
  </form>

  <section class="card obstructionCard">
    <div>
      <h2>Obstruction generator</h2>
      <p>Paste Starlink debug JSON from your phone, or use 12 manual obstruction values clockwise from north. Arrays using 0–1 fractions, 0–90 degrees, or 0–100 percentages are normalized automatically.</p>
      <form class="obstructionForm" onsubmit={importDebugJson}>
        <label>
          Starlink debug JSON
          <textarea bind:value={debugText} rows="6" placeholder={debugPlaceholder}></textarea>
        </label>
        <button>Parse debug JSON</button>
      </form>
      <form class="obstructionForm" onsubmit={generateObstructions}>
        <label>
          Manual obstruction sectors
          <textarea bind:value={obstructionText} rows="4"></textarea>
        </label>
        <button>Generate obstruction map</button>
      </form>
      <p class="source">{obstructionSource}</p>
      {#if obstructionError}
        <p class="error">{obstructionError}</p>
      {/if}
    </div>
    <ObstructionMap wedges={obstructions} />
  </section>

  {#if error}
    <p class="error">{error}</p>
  {/if}

  {#if result}
    {@const clearSats = result.data.satellites.filter(isClear)}
    {@const blockedCount = result.data.satellites.length - clearSats.length}
    <section class="card">
      <div class="summary">
        <div><strong>{clearSats.length}</strong> Starlink satellites visible above obstruction{blockedCount ? ` (${blockedCount} blocked)` : ''}</div>
        <span>{result.latitude.toFixed(6)}, {result.longitude.toFixed(6)}</span>
      </div>
      <div class="tableWrap">
        <table>
          <thead>
            <tr><th>Name</th><th>NORAD</th><th>Elevation</th><th>Azimuth</th><th>Direction</th></tr>
          </thead>
          <tbody>
            {#each clearSats as sat (sat.norad_id)}
              <tr>
                <td>{sat.name}</td>
                <td>{sat.norad_id}</td>
                <td>{sat.elevation_deg.toFixed(1)}°</td>
                <td>{sat.azimuth_deg.toFixed(1)}°</td>
                <td>{sat.direction}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>
  {/if}

  <section class="note">
    <h2>Elevation map note</h2>
    <p>Satlas calculates geometric visibility above a flat local horizon. The obstruction angle above approximates terrain, trees, and roofs. A production version can improve this with a digital elevation model plus a tree/building survey to compute azimuth-specific horizon masks instead of one global angle.</p>
  </section>
</main>
