<script>
  const { wedges } = $props()

  const OBSTRUCTION_SECTORS = 12
  const size = 600
  const center = size / 2
  const radius = 290
  const angleSpan = 360 / OBSTRUCTION_SECTORS

  function polarPoint(angleDeg, r, northOffset = -90) {
    const angleRad = ((angleDeg + northOffset) * Math.PI) / 180
    return { x: center + r * Math.cos(angleRad), y: center + r * Math.sin(angleRad) }
  }
</script>

<svg class="obstructionMap" viewBox="0 0 {size} {size}" role="img" aria-label="Starlink obstruction map">
  <circle cx={center} cy={center} r={radius} fill="#0067bc" />
  {#each wedges as value, index}
    {@const obstructionRadius = radius * value}
    {#if obstructionRadius}
      {@const startAngle = index * angleSpan}
      {@const endAngle = startAngle + angleSpan}
      {@const start = polarPoint(startAngle, obstructionRadius)}
      {@const end = polarPoint(endAngle, obstructionRadius)}
      {@const outerStart = polarPoint(startAngle, radius)}
      {@const outerEnd = polarPoint(endAngle, radius)}
      <g>
        <path
          d="M {center} {center} L {start.x} {start.y} A {obstructionRadius} {obstructionRadius} 0 0 1 {end.x} {end.y} Z"
          fill="#820000"
          opacity="0.88"
        />
        <path
          d="M {outerStart.x} {outerStart.y} A {radius} {radius} 0 0 1 {outerEnd.x} {outerEnd.y}"
          stroke="#ffffff44"
          stroke-width="2"
          fill="none"
        />
      </g>
    {/if}
  {/each}
  <line x1={center} y1="10" x2={center} y2="590" stroke="white" stroke-width="2" />
  <line x1="10" y1={center} x2="590" y2={center} stroke="white" stroke-width="2" />
  <text x={center} y="24" text-anchor="middle">N</text>
  <text x={center} y="594" text-anchor="middle">S</text>
  <text x="7" y={center + 5}>W</text>
  <text x="593" y={center + 5} text-anchor="end">E</text>
</svg>
