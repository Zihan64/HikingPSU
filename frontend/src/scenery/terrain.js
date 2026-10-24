// Procedural shapes for the scenery, generated once (deterministic, seeded) as SVG path strings.
// Everything is drawn in a 2400 × 600 frame (wide enough for desktop screens without cropping the
// far ridges); the SVGs scale it with `xMidYMax slice`, so phones show the middle, where the river runs.

export const W = 2400
export const H = 600

// small, fast, seeded PRNG (mulberry32)
export function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// smooth 1D value noise with octaves, 0..1
export function noise1(seed) {
  const r = rng(seed)
  const table = Array.from({ length: 512 }, () => r())
  const at = i => table[((i % 512) + 512) % 512]
  const smooth = x => {
    const i = Math.floor(x), f = x - i
    const u = f * f * (3 - 2 * f)
    return at(i) * (1 - u) + at(i + 1) * u
  }
  return (x, octaves = 4) => {
    let s = 0, a = 0.5, norm = 0
    for (let o = 0; o < octaves; o++) { s += a * smooth(x); norm += a; x = x * 2.03 + 17.3; a *= 0.5 }
    return s / norm
  }
}

const fmt = n => Math.round(n * 10) / 10

/**
 * A ridge line y(x). Central PA ridges are long and flat-topped, so the noise is pushed
 * toward plateaus (`flat`), with gentle knolls on top.
 */
export function ridgeFn({ seed, base, amp, freq, flat = 0.55 }) {
  const n = noise1(seed)
  return x => {
    const v = n(x * freq / W, 4)
    const plateau = v * v * (3 - 2 * v)          // smoothstep pushes toward flat tops
    const h = v * (1 - flat) + plateau * flat
    return base - amp * h
  }
}

/** Filled ridge silhouette down to the bottom of the frame. */
export function ridgePath(y, step = 8) {
  let d = `M${-40} ${fmt(y(-40))}`
  for (let x = -40 + step; x <= W + 40; x += step) d += ` L${x} ${fmt(y(x))}`
  return `${d} L${W + 40} ${H} L-40 ${H} Z`
}

/**
 * A forested ridge: the crest is a dense row of conifer tips (and a few rounded broadleaf
 * crowns), which is what a forested ridge looks like against the sky.
 * Returns the forest body (one path) and the autumn crowns (a second path, painted warm).
 */
export function forestPath(y, { seed, minH, maxH, spacing, broadleaf = 0.15, from = -40, to = W + 40, gap = null }) {
  const r = rng(seed)
  let body = `M${from} ${H} L${from} ${fmt(y(from))}`
  let crowns = ''
  const trees = []
  for (let x = from; x < to; x += spacing * (0.55 + r() * 0.9)) {
    if (gap && x > gap[0] && x < gap[1]) continue
    trees.push(x)
  }
  // ground under the trees, then each tree as its own sub-path on top
  body += ` ${ridgeLine(y, from, to)} L${to} ${H} Z`
  for (const x of trees) {
    const h = minH + (maxH - minH) * Math.pow(r(), 1.3)
    const b = y(x) + h * 0.25                 // trees stand slightly into the slope
    if (r() < broadleaf) {
      crowns += broadleafCrown(x, b, h * 0.8, r)
    } else {
      body += conifer(x, b, h, r)
    }
  }
  return { body, crowns }
}

function ridgeLine(y, from, to) {
  let d = ''
  for (let x = from; x <= to; x += 10) d += ` L${x} ${fmt(y(x))}`
  return d
}

// conifer silhouette: narrow spire, drooping branch tiers that widen toward the base, ragged edges
function conifer(x, b, h, r) {
  const tiers = 6 + Math.floor(r() * 4)
  const halfBase = h * (0.2 + r() * 0.08)
  const right = [], left = []
  for (let k = 1; k <= tiers; k++) {
    const t = k / tiers
    const yk = b - h + h * t
    const w = halfBase * Math.pow(t, 0.9) * (0.75 + r() * 0.5)
    const lift = h * 0.035 * (0.6 + r())
    right.push(`L${fmt(x + w * 0.55)} ${fmt(yk - lift * 1.4)} L${fmt(x + w)} ${fmt(yk)}`)
    const wl = halfBase * Math.pow(t, 0.9) * (0.75 + r() * 0.5)
    left.unshift(`L${fmt(x - wl)} ${fmt(yk)} L${fmt(x - wl * 0.55)} ${fmt(yk - lift * 1.4)}`)
  }
  return ` M${fmt(x)} ${fmt(b - h)} ${right.join(' ')} L${fmt(x)} ${fmt(b)} ${left.join(' ')} Z`
}

// broadleaf crown: a few overlapping round lumps (sub-paths, so they union when filled) on a short trunk
function broadleafCrown(x, b, h, r) {
  const w = h * (0.40 + r() * 0.12)
  let d = ` M${fmt(x - h * 0.03)} ${fmt(b)} L${fmt(x - h * 0.03)} ${fmt(b - h * 0.4)} L${fmt(x + h * 0.03)} ${fmt(b - h * 0.4)} L${fmt(x + h * 0.03)} ${fmt(b)} Z`
  const lumps = 4 + Math.floor(r() * 3)
  for (let i = 0; i < lumps; i++) {
    const cx = x + (r() - 0.5) * w * 1.1
    const cy = b - h * (0.55 + r() * 0.3)
    const rad = w * (0.45 + r() * 0.3)
    d += ` M${fmt(cx - rad)} ${fmt(cy)} a${fmt(rad)} ${fmt(rad)} 0 1 0 ${fmt(rad * 2)} 0 a${fmt(rad)} ${fmt(rad)} 0 1 0 ${fmt(-rad * 2)} 0 Z`
  }
  return d
}

/**
 * River ribbon seen in perspective: thin where it leaves the far valley, widening toward the
 * viewer, meandering. Returns the water outline and a few centre lines for the moving light.
 */
export function riverPaths({ seed = 7, x0 = 1290, y0 = 410, x1 = 1180, y1 = H + 10, w0 = 6, w1 = 240 }) {
  const n = noise1(seed)
  const pts = []
  const steps = 60
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const p = t * t                                        // perspective: slow far away, fast near
    const y = y0 + (y1 - y0) * p
    const meander = (n(t * 3.2, 3) - 0.5) * 2 * (40 + 360 * p) + Math.sin(t * 5.2 + 1) * 70 * p
    const x = x0 + (x1 - x0) * p + meander
    const w = w0 + (w1 - w0) * p
    pts.push({ x, y, w })
  }
  const leftSide = pts.map(q => `${fmt(q.x - q.w / 2)} ${fmt(q.y)}`)
  const rightSide = pts.map(q => `${fmt(q.x + q.w / 2)} ${fmt(q.y)}`).reverse()
  const outline = `M${leftSide.join(' L')} L${rightSide.join(' L')} Z`
  const lane = off => 'M' + pts.map(q => `${fmt(q.x + q.w * off)} ${fmt(q.y)}`).join(' L')
  return { outline, lanes: [lane(-0.22), lane(0.05), lane(0.28)] }
}
