import { useId } from 'react'
import './medals.css'

// Trail medals, drawn as struck-metal badges: a bevelled metal rim, a glossy enamel field, a raised
// emblem lit by a specular filter, a bead ring and engraved lettering. Honour medals add a ribbon,
// a laurel and a sunburst; the legend adds a gem. The base art is a static SVG; the moving light
// (sheen sweep and sparkles) is a second SVG on top, so animating it never re-renders the filters.

const C = 100 // centre of the 200 × 220 frame

const METALS = {
  bronze: ['#4a250c', '#9a5a26', '#f6c896', '#b8763c', '#5e3214'],
  silver: ['#4f5961', '#c3ccd3', '#ffffff', '#a7b1b9', '#59636b'],
  gold: ['#6a440a', '#c99024', '#fff3bf', '#e2b347', '#80560f'],
  platinum: ['#33425a', '#a9bad0', '#ffffff', '#c9d8ea', '#4d5f78'],
}

/* --------------------------------- shapes --------------------------------- */

const f = n => Math.round(n * 100) / 100

function polar(fn, steps = 240) {
  let d = ''
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2 - Math.PI / 2
    const r = fn(a)
    d += `${i ? 'L' : 'M'}${f(C + r * Math.cos(a))} ${f(C + r * Math.sin(a))}`
  }
  return d + 'Z'
}

function roundedPolygon(points, radius) {
  const n = points.length
  let d = ''
  for (let i = 0; i < n; i++) {
    const p = points[i], prev = points[(i - 1 + n) % n], next = points[(i + 1) % n]
    const v1 = [prev[0] - p[0], prev[1] - p[1]], v2 = [next[0] - p[0], next[1] - p[1]]
    const l1 = Math.hypot(...v1), l2 = Math.hypot(...v2)
    const a = [p[0] + (v1[0] / l1) * radius, p[1] + (v1[1] / l1) * radius]
    const b = [p[0] + (v2[0] / l2) * radius, p[1] + (v2[1] / l2) * radius]
    d += `${i ? 'L' : 'M'}${f(a[0])} ${f(a[1])} Q${f(p[0])} ${f(p[1])} ${f(b[0])} ${f(b[1])}`
  }
  return d + 'Z'
}

const SHAPES = {
  round: R => polar(() => R, 120),
  scallop: (R, n = 20, depth = 0.045) => polar(a => R * (1 - depth * (0.5 - 0.5 * Math.cos(n * a))), 360),
  burst: R => polar(a => R * (1 - 0.07 * Math.pow(0.5 - 0.5 * Math.cos(16 * a), 1.6)), 480),
  hex: R => roundedPolygon(Array.from({ length: 6 }, (_, i) => {
    const a = (i / 6) * Math.PI * 2 - Math.PI / 2
    return [C + R * 1.04 * Math.cos(a), C + R * 1.04 * Math.sin(a)]
  }), R * 0.16),
  shield: R => {
    const w = R * 0.92, top = C - R * 0.92, mid = C + R * 0.18, bot = C + R * 0.98
    return `M${f(C)} ${f(top - R * 0.06)} C${f(C + w * 0.45)} ${f(top + R * 0.06)} ${f(C + w * 0.8)} ${f(top)} ${f(C + w)} ${f(top + R * 0.04)}`
      + ` L${f(C + w)} ${f(mid)} C${f(C + w)} ${f(C + R * 0.62)} ${f(C + w * 0.45)} ${f(C + R * 0.86)} ${f(C)} ${f(bot)}`
      + ` C${f(C - w * 0.45)} ${f(C + R * 0.86)} ${f(C - w)} ${f(C + R * 0.62)} ${f(C - w)} ${f(mid)}`
      + ` L${f(C - w)} ${f(top + R * 0.04)} C${f(C - w * 0.8)} ${f(top)} ${f(C - w * 0.45)} ${f(top + R * 0.06)} ${f(C)} ${f(top - R * 0.06)}Z`
  },
}

/* -------------------------------- emblems -------------------------------- */

const pine = (x, y, h) => {
  const w = h * 0.36
  return `M${x} ${y - h} L${x + w * 0.6} ${y - h * 0.62} L${x + w * 0.34} ${y - h * 0.62} L${x + w * 0.85} ${y - h * 0.28} L${x + w * 0.5} ${y - h * 0.28} L${x + w} ${y - h * 0.08}`
    + ` L${x - w} ${y - h * 0.08} L${x - w * 0.5} ${y - h * 0.28} L${x - w * 0.85} ${y - h * 0.28} L${x - w * 0.34} ${y - h * 0.62} L${x - w * 0.6} ${y - h * 0.62}Z`
    + ` M${x - 2.2} ${y - h * 0.1} h4.4 v${h * 0.12} h-4.4Z`
}
const peak = (x, base, h, hw) => `M${x - hw} ${base} L${x} ${base - h} L${x + hw} ${base}Z`
const star = (x, y, r, inner = 0.45, n = 5) => {
  let d = ''
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2, rr = i % 2 ? r * inner : r
    d += `${i ? 'L' : 'M'}${f(x + rr * Math.cos(a))} ${f(y + rr * Math.sin(a))}`
  }
  return d + 'Z'
}

// Each emblem: filled metal shapes (`fill`), optional engraved detail lines (`cut`, drawn in the enamel colour),
// and stroked metal shapes (`stroke`).
const EMBLEMS = {
  trailhead: {
    fill: 'M96.5 64 h7 v74 h-7Z M68 70 H126 L136 79.5 L126 89 H68Z M132 97 H74 L64 106.5 L74 116 H132Z M78 138 C88 132 112 132 122 138Z',
    cut: 'M76 79.5 H118 M82 106.5 H124',
  },
  'valley-walker': {
    fill: `M46 132 C62 100 74 92 86 104 C92 110 96 112 100 110 C104 112 108 110 114 104 C126 92 138 100 154 132Z M100 76 m-11 0 a11 11 0 1 0 22 0 a11 11 0 1 0 -22 0`,
    cut: 'M100 132 C88 124 112 120 100 114',
  },
  'ridge-walker': {
    fill: `M46 132 L70 100 L84 110 L104 80 L124 104 L136 96 L154 132Z ${pine(70, 140, 40)} ${pine(132, 140, 34)}`,
    cut: 'M104 80 L98 92 L106 90 L112 96',
  },
  summit: {
    fill: 'M44 136 L84 80 L96 94 L110 70 L156 136Z M108.5 70 V42 h3 V70Z M111.5 43 L134 50 L111.5 57Z',
    cut: 'M96 94 L103 84 L110 92 L117 82',
  },
  'seven-mountains': {
    fill: [peak(62, 122, 30, 17), peak(86, 122, 36, 18), peak(114, 122, 36, 18), peak(138, 122, 30, 17)].join(' '),
    front: [peak(74, 138, 40, 21), peak(100, 138, 48, 22), peak(126, 138, 40, 21)].join(' '),
    extra: star(100, 64, 11),
  },
  'allegheny-front': {
    back: 'M126 92 m-24 0 a24 24 0 1 0 48 0 a24 24 0 1 0 -48 0',
    rays: true,
    fill: 'M40 140 C50 136 54 122 60 112 C66 102 72 98 78 92 C84 86 90 84 98 84 C120 83 142 84 160 86 L160 140Z',
    cut: 'M58 122 C66 116 72 116 80 112 M66 106 C74 102 80 102 88 98 M96 96 C118 95 138 96 156 98 M92 110 C116 108 136 109 156 111 M88 124 C112 122 134 123 156 125',
    extra: `${star(62, 70, 7, 0.4, 4)} ${star(80, 58, 4.5, 0.4, 4)}`,
  },
  explorer: {
    ring: true,
    fill: 'M100 56 L108.5 100 L100 144 L91.5 100Z',
    fill2: 'M56 100 L100 93 L144 100 L100 107Z',
    extra: 'M100 100 m-5 0 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0',
  },
  'car-free': {
    stroke: 'M70 116 m-17 0 a17 17 0 1 0 34 0 a17 17 0 1 0 -34 0 M130 116 m-17 0 a17 17 0 1 0 34 0 a17 17 0 1 0 -34 0 M70 116 L90 86 L120 86 L130 116 M90 86 L102 116 L120 86 M102 116 L70 116 M84 78 L98 78 M120 86 L116 72 L128 70',
  },
  'four-seasons': {
    fill: 'M100 50 L106 68 L118 62 L114 82 L132 76 L126 90 L144 96 L124 107 L129 120 L108 114 L104 136 L100 131 L96 136 L92 114 L71 120 L76 107 L56 96 L74 90 L68 76 L86 82 L82 62 L94 68Z M98.5 130 h3 v22 h-3Z',
    cut: 'M100 132 V76 M100 108 L82 92 M100 108 L118 92 M100 96 L88 80 M100 96 L112 80',
  },
  'trail-guide': {
    fill: 'M100 142 C62 116 50 96 60 80 C70 64 90 66 100 82 C110 66 130 64 140 80 C150 96 138 116 100 142Z',
    cut: 'M82 92 C88 84 96 86 100 94',
    extra: `${star(140, 62, 7, 0.38, 4)} ${star(152, 78, 4, 0.38, 4)}`,
  },
}

/* --------------------------------- designs --------------------------------- */

export const DESIGNS = {
  trailhead: { shape: 'round', metal: 'bronze', enamel: ['#5fae76', '#2f6b47', '#173f2a'], text: 'FIRST TRAIL', sparkles: 2 },
  'valley-walker': { shape: 'round', metal: 'silver', enamel: ['#8fd0a0', '#3e8558', '#1e4a32'], text: 'FIVE TRAILS', sparkles: 2 },
  'ridge-walker': { shape: 'hex', metal: 'silver', enamel: ['#cf9a62', '#8a5a2e', '#4a2d14'], sparkles: 3 },
  summit: { shape: 'shield', metal: 'gold', enamel: ['#4c86c8', '#1b4b86', '#001e44'], ribbon: ['#001e44', '#ffffff'], sparkles: 3 },
  'seven-mountains': { shape: 'scallop', metal: 'gold', enamel: ['#3f8f76', '#1d5a54', '#0a2a3c'], text: 'HONOUR MEDAL', ribbon: ['#0b2a4a', '#f5c04a'], laurel: true, rays: true, sparkles: 4 },
  'allegheny-front': { shape: 'burst', metal: 'platinum', accent: 'gold', enamel: ['#6f62c9', '#2d2a7a', '#0a1236'], text: 'LEGEND', ribbon: ['#2a1f66', '#f5c04a'], laurel: true, rays: true, gem: true, sparkles: 6 },
  explorer: { shape: 'hex', metal: 'silver', enamel: ['#7cc0ef', '#2c7fbf', '#123f6c'], sparkles: 2 },
  'car-free': { shape: 'round', metal: 'bronze', enamel: ['#6fd0c4', '#22857c', '#0f4b46'], text: 'CAR-FREE', sparkles: 2 },
  'four-seasons': { shape: 'round', metal: 'silver', seasons: true, enamel: ['#f7d78b', '#d2873c', '#7a4416'], text: 'ALL SEASONS', sparkles: 3 },
  'trail-guide': { shape: 'shield', metal: 'gold', enamel: ['#ffcf7a', '#e0892e', '#8a4410'], sparkles: 3 },
}

function MetalGradient({ id, metal, angle = 135 }) {
  const s = METALS[metal]
  return (
    <linearGradient id={id} gradientTransform={`rotate(${angle - 90} .5 .5)`}>
      <stop offset="0" stopColor={s[0]} /><stop offset=".28" stopColor={s[1]} /><stop offset=".5" stopColor={s[2]} />
      <stop offset=".7" stopColor={s[3]} /><stop offset="1" stopColor={s[4]} />
    </linearGradient>
  )
}

const scaleAt = k => `translate(${C} ${C}) scale(${k}) translate(${-C} ${-C})`

function Laurel({ fill }) {
  const leaves = []
  for (const side of [-1, 1]) {
    for (let i = 0; i < 13; i++) {
      const t = i / 12
      const deg = side < 0 ? 100 + t * 118 : 80 - t * 118           // from the bottom up each side
      const a = deg * (Math.PI / 180)
      for (const off of [-1, 1]) {
        const r = 90 + off * 4.2
        const x = C + r * Math.cos(a + side * 0.035), y = C + r * Math.sin(a + side * 0.035)
        const rot = deg + 90 + off * side * 34 + (side < 0 ? 180 : 0)
        leaves.push(<ellipse key={`${side}${i}${off}`} cx={f(x)} cy={f(y)} rx={f(8 - t * 2.4)} ry={f(3.4 - t * 0.8)} transform={`rotate(${f(rot)} ${f(x)} ${f(y)})`} fill={fill} />)
      }
    }
  }
  const stem = side => {
    const a0 = (side < 0 ? 100 : 80) * Math.PI / 180, a1 = (side < 0 ? 218 : -38) * Math.PI / 180
    return `M${f(C + 90 * Math.cos(a0))} ${f(C + 90 * Math.sin(a0))} A90 90 0 0 ${side < 0 ? 1 : 0} ${f(C + 90 * Math.cos(a1))} ${f(C + 90 * Math.sin(a1))}`
  }
  return <g>{[-1, 1].map(s => <path key={s} d={stem(s)} fill="none" stroke={fill} strokeWidth="1.6" />)}{leaves}</g>
}

function Ribbon({ colors, id }) {
  const [base, stripe] = colors
  const tail = s => `M${C + s * 34} 140 L${C + s * 64} 212 L${C + s * 46} 204 L${C + s * 36} 219 L${C + s * 4} 150Z`
  const band = s => `M${C + s * 23} 145 L${C + s * 50} 209 L${C + s * 42} 207 L${C + s * 15} 147Z`
  return (
    <g>
      <defs>
        <linearGradient id={`${id}rs`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#000" stopOpacity=".35" /><stop offset=".5" stopColor="#000" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity=".3" />
        </linearGradient>
      </defs>
      {[-1, 1].map(s => <g key={s}>
        <path d={tail(s)} fill={base} />
        <path d={band(s)} fill={stripe} opacity=".9" />
        <path d={tail(s)} fill={`url(#${id}rs)`} />
      </g>)}
    </g>
  )
}

/**
 * <Medal id="summit" earned size={120} />
 * mini: a small chip-sized version (no lettering, beads, laurel or moving light).
 */
export default function Medal({ id, earned = true, size = 120, mini = false, className = '', title }) {
  const d = DESIGNS[id] || DESIGNS.trailhead
  const uid = useId().replace(/:/g, '')
  const k = s => `${uid}${s}`
  const shape = SHAPES[d.shape]
  const outer = shape(84), inner = shape(76), field = shape(69)
  const e = EMBLEMS[id] || EMBLEMS.trailhead
  const light = METALS[d.accent || d.metal]
  const round = d.shape === 'round' || d.shape === 'scallop' || d.shape === 'burst'
  const showFx = earned && !mini
  return (
    <span className={`md ${earned ? 'md-earned' : 'md-locked'} ${mini ? 'md-mini' : ''} ${className}`} style={{ width: size, height: size * 1.1 }} role="img" aria-label={title || id}>
      <svg className="md-base" viewBox="0 0 200 220" aria-hidden="true">
        <defs>
          <MetalGradient id={k('m')} metal={d.metal} />
          <MetalGradient id={k('mr')} metal={d.metal} angle={315} />
          <MetalGradient id={k('a')} metal={d.accent || d.metal} angle={120} />
          <radialGradient id={k('e')} cx=".36" cy=".3" r=".85">
            <stop offset="0" stopColor={d.enamel[0]} /><stop offset=".55" stopColor={d.enamel[1]} /><stop offset="1" stopColor={d.enamel[2]} />
          </radialGradient>
          <radialGradient id={k('g')} cx=".32" cy=".18" r=".6">
            <stop offset="0" stopColor="#fff" stopOpacity=".55" /><stop offset=".55" stopColor="#fff" stopOpacity=".08" /><stop offset="1" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={k('ray')} cx=".5" cy=".5" r=".5">
            <stop offset=".55" stopColor={light[2]} stopOpacity=".9" /><stop offset="1" stopColor={light[1]} stopOpacity="0" />
          </radialGradient>
          <clipPath id={k('cf')}><path d={field} /></clipPath>
          {!mini && <>
            {/* the raised parts catch a point light: real bevel and specular shine */}
            <filter id={k('bv')} x="-20%" y="-20%" width="140%" height="140%" colorInterpolationFilters="sRGB">
              <feGaussianBlur in="SourceAlpha" stdDeviation="1.6" result="blur" />
              <feSpecularLighting in="blur" surfaceScale="3.2" specularConstant="1.05" specularExponent="26" lightingColor="#ffffff" result="spec">
                <fePointLight x="40" y="10" z="140" />
              </feSpecularLighting>
              <feComposite in="spec" in2="SourceAlpha" operator="in" result="specIn" />
              <feComposite in="SourceGraphic" in2="specIn" operator="arithmetic" k1="0" k2="1" k3=".85" k4="0" result="lit" />
              <feDropShadow in="lit" dx="0" dy="1.8" stdDeviation="1.2" floodColor="#000" floodOpacity=".45" />
            </filter>
            <filter id={k('in')} x="-10%" y="-10%" width="120%" height="120%">
              <feGaussianBlur stdDeviation="3" />
            </filter>
            <path id={k('arc')} d={`M${C - 56} ${C} A56 56 0 0 0 ${C + 56} ${C}`} fill="none" />
          </>}
        </defs>

        {/* sunburst behind honour medals */}
        {d.rays && !mini && (
          <g className={earned ? 'md-rays' : ''} opacity=".9">
            {Array.from({ length: 28 }, (_, i) => {
              const a = (i / 28) * Math.PI * 2, b = a + 0.06
              return <path key={i} d={`M${C} ${C} L${f(C + 112 * Math.cos(a))} ${f(C + 112 * Math.sin(a))} L${f(C + 112 * Math.cos(b))} ${f(C + 112 * Math.sin(b))}Z`} fill={`url(#${k('ray')})`} />
            })}
          </g>
        )}
        {d.ribbon && <Ribbon colors={d.ribbon} id={uid} />}
        {d.laurel && !mini && <g filter={`url(#${k('bv')})`}><Laurel fill={`url(#${k('a')})`} /></g>}

        {/* cast shadow, rim, chamfer, enamel */}
        {!mini && <ellipse cx={C} cy={C + 88} rx="58" ry="6" fill="#0b1d14" opacity=".18" filter={`url(#${k('in')})`} />}
        <g filter={mini ? undefined : `url(#${k('bv')})`}>
          <path d={outer} fill={`url(#${k('m')})`} />
          <path d={inner} fill={`url(#${k('mr')})`} />
        </g>
        <path d={outer} fill="none" stroke="#fff" strokeOpacity=".55" strokeWidth="1.2" transform={scaleAt(0.985)} />
        {d.seasons ? (
          <g clipPath={`url(#${k('cf')})`}>
            <path d={`M${C} ${C} L${C} 0 L0 0 L0 ${C}Z`} fill="#6fb46a" />
            <path d={`M${C} ${C} L${C} 0 L200 0 L200 ${C}Z`} fill="#3d8fd0" />
            <path d={`M${C} ${C} L200 ${C} L200 200 L${C} 200Z`} fill="#d2873c" />
            <path d={`M${C} ${C} L${C} 200 L0 200 L0 ${C}Z`} fill="#c9d9e6" />
            <path d={field} fill={`url(#${k('e')})`} opacity=".25" />
          </g>
        ) : <path d={field} fill={`url(#${k('e')})`} />}
        {!mini && <path d={field} fill="none" stroke="#000" strokeOpacity=".45" strokeWidth="5" clipPath={`url(#${k('cf')})`} filter={`url(#${k('in')})`} />}

        {/* bead ring or engraved inner line */}
        {!mini && (round
          ? <g fill={`url(#${k('a')})`}>{Array.from({ length: 40 }, (_, i) => {
            const a = (i / 40) * Math.PI * 2
            return <circle key={i} cx={f(C + 64 * Math.cos(a))} cy={f(C + 64 * Math.sin(a))} r="1.5" />
          })}</g>
          : <path d={shape(63)} fill="none" stroke={`url(#${k('a')})`} strokeWidth="1.4" strokeDasharray="2 3" />)}

        {/* emblem */}
        <g filter={mini ? undefined : `url(#${k('bv')})`} transform={round && d.text && !mini ? 'translate(0 -5) translate(100 100) scale(.86) translate(-100 -100)' : undefined}>
          {e.rays && Array.from({ length: 9 }, (_, i) => {
            const a = Math.PI + (i / 8) * Math.PI
            return <path key={i} d={`M${f(126 + 29 * Math.cos(a))} ${f(92 + 29 * Math.sin(a))} L${f(126 + 40 * Math.cos(a))} ${f(92 + 40 * Math.sin(a))}`} stroke={`url(#${k('a')})`} strokeWidth="3.2" strokeLinecap="round" />
          })}
          {e.back && <path d={e.back} fill={`url(#${k('a')})`} opacity=".9" />}
          {e.ring && <circle cx={C} cy={C} r="31" fill="none" stroke={`url(#${k('a')})`} strokeWidth="5" />}
          {e.fill && <path d={e.fill} fill={`url(#${k('a')})`} />}
          {e.fill2 && <path d={e.fill2} fill={`url(#${k('m')})`} />}
          {e.front && <path d={e.front} fill={`url(#${k('a')})`} stroke={d.enamel[2]} strokeWidth="3" strokeLinejoin="round" />}
          {e.stroke && <path d={e.stroke} fill="none" stroke={`url(#${k('a')})`} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />}
          {e.extra && <path d={e.extra} fill={`url(#${k('a')})`} />}
          {e.cut && <path d={e.cut} fill="none" stroke={d.enamel[2]} strokeOpacity=".75" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />}
        </g>

        {/* engraved lettering along the bottom of round medals */}
        {round && d.text && !mini && (
          <text fontSize="8.2" fontWeight="800" letterSpacing="2.6" fill={light[3]} stroke={d.enamel[2]} strokeWidth=".4" paintOrder="stroke" textAnchor="middle">
            <textPath href={`#${k('arc')}`} startOffset="50%">{d.text}</textPath>
          </text>
        )}

        {/* enamel gloss */}
        <path d={field} fill={`url(#${k('g')})`} />

        {/* legend gem at the crown */}
        {d.gem && (
          <g transform={`translate(${C} ${C - 84})`}>
            <path d="M0 -9 L8 -2 L5 8 L-5 8 L-8 -2Z" fill="#7fd3ff" stroke="#fff" strokeWidth="1" />
            <path d="M0 -9 L3 -2 L0 8 L-3 -2Z" fill="#fff" opacity=".7" />
            <path d="M-8 -2 H8" stroke="#2b7fc0" strokeWidth=".8" />
          </g>
        )}
      </svg>

      {showFx && (
        <svg className="md-fx" viewBox="0 0 200 220" aria-hidden="true">
          <defs>
            <clipPath id={k('co')}><path d={outer} /></clipPath>
            <linearGradient id={k('sh')} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#fff" stopOpacity="0" /><stop offset=".5" stopColor="#fff" stopOpacity=".75" /><stop offset="1" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
          </defs>
          <g clipPath={`url(#${k('co')})`}>
            <rect className="md-sheen" x="-60" y="-40" width="46" height="300" fill={`url(#${k('sh')})`} transform="rotate(22 100 100)" />
          </g>
          {SPARKS.slice(0, d.sparkles).map(([x, y, r], i) => (
            <path key={i} className="md-spark" style={{ animationDelay: `${i * 0.9}s` }} d={star(x, y, r, 0.22, 4)} fill="#fff" />
          ))}
        </svg>
      )}
      {!earned && <span className="md-lock" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M7 11V8a5 5 0 0 1 10 0v3" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /><rect x="5" y="11" width="14" height="10" rx="2.5" fill="currentColor" /></svg></span>}
    </span>
  )
}

const SPARKS = [[42, 46, 9], [160, 58, 7], [150, 150, 8], [52, 150, 6], [100, 14, 7], [172, 108, 5]]
