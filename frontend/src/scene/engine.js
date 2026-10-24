// Realistic outdoor scene rendered with WebGL2 (no dependencies).
//
// Two passes per frame:
//   1. clouds  - cloud density at 1/4 resolution into a texture (drifts and evolves over time)
//   2. scene   - sky, sun, crepuscular rays (Tyndall effect through cloud gaps), shaded clouds,
//                layered ridges with aerial perspective and valley fog, autumn-flecked forest canopy,
//                a meadow with a river flowing toward the viewer, and dense foreground conifers.
// Rendered below device resolution and upscaled; throttled; paused while the tab is hidden.
// With reduced motion (or animate: false) a single still frame is drawn.

import { SCENE } from './sceneConfig'

const COMMON = /* glsl */ `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform float uHorizon;   // 0..1 from the bottom: where the farthest ridge meets the sky
uniform vec2 uSun;        // sun position, 0..1 (x from left, y from bottom)
uniform vec2 uPar;        // pointer parallax, -1..1
uniform float uSkyRef;    // pixels per sky unit: keeps clouds and sun the same size on any canvas shape

float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float noise1(float x) { float i = floor(x), f = fract(x); float u = f * f * (3.0 - 2.0 * f); return mix(hash11(i), hash11(i + 1.0), u); }
const mat2 ROT = mat2(1.6, 1.2, -1.2, 1.6);
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 6; i++) { s += a * vnoise(p); p = ROT * p; a *= 0.5; } return s; }
float fbm4(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = ROT * p; a *= 0.5; } return s; }
float fbm1(float x) { float s = 0.0, a = 0.5; for (int i = 0; i < 6; i++) { s += a * noise1(x); x = x * 2.03 + 17.1; a *= 0.5; } return s; }
`

const VERT = /* glsl */ `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`

// ---------- pass 1: cloud density ----------
// Fair-weather cumulus in three rows (near/high, middle, far/low) plus thin cirrus.
// Each heap has a flat base and a domed, billowing top. R = density, G = height inside the cloud
// (0 base .. 1 top), used for the darker undersides.
const CLOUD_FRAG = COMMON + /* glsl */ `
out vec4 o;
float ASPECT;

vec2 cumulus(vec2 uv, float alt, float base, float thick, float freq, float speed, float seed, float t) {
  float x = gl_FragCoord.x / uSkyRef * freq + t * speed + seed + uPar.x * 0.02 * freq;
  base += (fbm1(x * 0.35 + seed * 2.0) - 0.5) * thick * 0.5;   // bases at slightly different heights
  float hb = (alt - base) / thick;                       // 0 at the flat base, 1 = typical heap top
  if (hb < -0.1 || hb > 2.6) return vec2(0.0);
  // separate heaps along the row, a few towering ones, clear sky between
  float tower = pow(fbm1(x * 0.95 + seed), 2.0) * 3.4 - 0.62;
  vec2 q = vec2(x, alt * freq * 2.0);
  float warp = fbm4(q * 1.1 + vec2(seed, t * 0.012));
  float puff = fbm(q * 3.2 + warp * 1.3 + vec2(0.0, -t * 0.008));
  float cauli = 1.0 - abs(fbm4(q * 6.5 + warp) * 2.0 - 1.0);       // cauliflower detail on the crowns
  float edge = tower - hb + (puff - 0.5) * 1.15 + (cauli - 0.5) * 0.35 * hb;
  float d = smoothstep(0.0, 0.18, edge);
  d *= smoothstep(-0.06, 0.10, hb + (puff - 0.5) * 0.16);             // flat, ragged base
  d *= 1.0 - smoothstep(2.2, 2.6, hb);
  return vec2(d, clamp(hb / max(tower, 0.25), 0.0, 1.0));
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  ASPECT = uRes.x / uRes.y;
  float alt = (gl_FragCoord.y - uHorizon * uRes.y) / (uSkyRef * 0.64);   // 0 at the horizon, 1 one sky-height up
  float t = uTime;
  vec2 a = cumulus(uv, alt, 0.46, 0.22, 1.6, 0.020, 3.0, t);    // big, near
  vec2 b = cumulus(uv, alt, 0.22, 0.12, 3.0, 0.013, 21.0, t);   // middle row
  vec2 c = cumulus(uv, alt, 0.05, 0.06, 6.0, 0.008, 47.0, t);   // small heaps on the horizon
  // higher rows only appear on tall canvases (phone pages with a long sky)
  vec2 e = cumulus(uv, alt, 1.10, 0.22, 1.5, 0.022, 71.0, t);
  vec2 f = cumulus(uv, alt, 1.75, 0.24, 1.3, 0.024, 97.0, t);
  if (e.x > a.x) a = e;
  if (f.x > a.x) a = f;
  float cir = smoothstep(0.62, 0.85, fbm(vec2(gl_FragCoord.x / uSkyRef * 1.4 + t * 0.006, alt * 9.0))) * smoothstep(0.70, 0.9, alt) * (1.0 - smoothstep(1.3, 1.8, alt)) * 0.35;
  float d = max(max(a.x, b.x), max(c.x, cir));
  float g = a.x >= max(b.x, c.x) ? a.y : (b.x >= c.x ? b.y : c.y);
  if (cir > max(max(a.x, b.x), c.x)) g = 1.0;
  o = vec4(d, g, 0.0, 1.0);
}
`

// ---------- pass 2: everything else ----------
const SCENE_FRAG = COMMON + /* glsl */ `
uniform sampler2D uCloud;
uniform float uRiverX;      // river centre at the bottom edge, 0..1
uniform vec2 uClearing;     // meadow clearing (no foreground trees), x range 0..1
out vec4 o;

vec2 P;          // point in aspect-corrected space: x in [0, aspect], y in [0, 1]
float ASPECT;

// ridge profile (uv.y) for a layer: flat-topped Appalachian ridges with knolls
float ridgeSmooth(float x, float base, float amp, float freq, float seed, float flatness) {
  float n = fbm1(x * freq + seed);
  float plateau = smoothstep(0.28, 0.72, n);
  float h = mix(n, plateau, flatness);
  h += (noise1(x * freq * 6.0 + seed * 3.0) - 0.5) * 0.10;
  return base + amp * h;
}
// ragged tree line along the crest (silhouette only, never used for shading)
float treeLine(float x, float k) {
  float s = 1.0 + k * 1.6;
  float tips = abs(fract(x * 140.0 * s) - 0.5) * 2.0;
  return (0.6 + 0.4 * noise1(x * 60.0 * s)) * tips * (0.0015 + 0.0028 * k);
}

vec3 skyColor(vec2 uv, float sunD) {
  float alt = clamp((uv.y - uHorizon) * uRes.y / (uSkyRef * 0.64), 0.0, 1.0);
  vec3 zenith = vec3(0.09, 0.33, 0.70);
  vec3 mid = vec3(0.30, 0.58, 0.88);
  vec3 horizon = vec3(0.70, 0.84, 0.92);
  vec3 c = mix(horizon, mid, smoothstep(0.0, 0.45, alt));
  c = mix(c, zenith, smoothstep(0.35, 1.0, alt));
  // warm forward scattering around the sun
  c += vec3(1.0, 0.78, 0.38) * 0.42 * exp(-sunD * 2.6);
  return c;
}

vec3 hazeColor(float sunD) {
  return mix(vec3(0.66, 0.79, 0.84), vec3(0.94, 0.86, 0.66), 0.55 * exp(-sunD * 1.4));
}

// forested ridge surface: canopy texture, autumn patches, lit by the sun through a relief normal
vec3 canopy(vec2 p, float k, float depthIn, float crestSlope) {
  float sc = 1.0 + k * 0.7;
  // relief: ridges and ravines running down the slope
  vec2 rp = vec2(p.x * 9.0 * sc, depthIn * 14.0 * sc) + k * 5.0;
  float r0 = fbm4(rp);
  float rx = fbm4(rp + vec2(0.06, 0.0));
  float ry = fbm4(rp + vec2(0.0, 0.06));
  vec3 n = normalize(vec3((r0 - rx) * 9.0 - crestSlope * 2.5, (r0 - ry) * 6.0, 1.0));
  float diff = clamp(dot(n, normalize(vec3(0.75, 0.35, 0.55))), 0.0, 1.0);
  float fine = fbm(p * vec2(180.0, 260.0) * sc + k * 13.0);
  vec3 g = mix(vec3(0.05, 0.16, 0.08), vec3(0.16, 0.33, 0.14), fine);
  float autumn = smoothstep(0.55, 0.70, fbm4(p * vec2(10.0, 16.0) * sc + k * 3.1));
  vec3 a = mix(vec3(0.42, 0.20, 0.06), vec3(0.82, 0.50, 0.15), fine);
  g = mix(g, a, autumn * 0.75);
  return g * (0.38 + 1.05 * diff);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  ASPECT = uRes.x / uRes.y;
  P = vec2(uv.x * ASPECT, uv.y);
  float t = uTime;
  vec2 sunP = vec2(uSun.x * ASPECT, uSun.y);              // height units (land)
  vec2 Q = gl_FragCoord.xy / uSkyRef;                     // sky units
  vec2 sunQ = uSun * uRes / uSkyRef;
  float sunD = distance(Q, sunQ);
  float H = uHorizon;

  // ---------------- sky ----------------
  vec3 col = skyColor(uv, sunD);

  // clouds: density + self-shadowing toward the sun (lit tops, blue-grey undersides)
  vec4 cl = texture(uCloud, uv);
  float dens = cl.r;
  vec2 toSun = normalize(sunQ - Q) * uSkyRef / uRes;       // one sky unit, in uv
  float occ = texture(uCloud, uv + toSun * 0.015).r;
  float occ2 = texture(uCloud, uv + toSun * 0.040).r;
  float light = clamp(1.05 - (occ * 0.55 + occ2 * 0.45), 0.0, 1.0);
  vec3 cloudShadow = vec3(0.50, 0.58, 0.70);
  vec3 cloudLit = vec3(1.0, 0.995, 0.97);
  vec3 cloudCol = mix(cloudShadow, cloudLit, light);
  cloudCol *= mix(0.80, 1.06, cl.g);                         // darker bases, bright crowns
  cloudCol = mix(cloudCol, hazeColor(sunD) * 1.05, smoothstep(0.30, 0.0, (uv.y - H) * uRes.y / uSkyRef) * 0.55); // far heaps sink into haze
  // silver lining near the sun
  cloudCol += vec3(1.0, 0.88, 0.58) * smoothstep(0.7, 0.05, dens) * exp(-sunD * 3.5) * 1.6;
  // sun: white-hot disc, yellow glare, wide warm bloom; dimmed behind thick cloud
  float disc = smoothstep(0.032, 0.026, sunD);
  vec3 sun = vec3(1.0, 0.98, 0.90) * disc * 3.2
           + vec3(1.0, 0.92, 0.66) * exp(-sunD * 45.0) * 2.4
           + vec3(1.0, 0.80, 0.38) * exp(-sunD * 9.0) * 1.15
           + vec3(1.0, 0.76, 0.34) * exp(-sunD * 3.0) * 0.50;
  col += sun * (1.0 - dens * 0.8);
  col = mix(col, cloudCol, smoothstep(0.0, 0.55, dens) * 0.98);

  // crepuscular rays (Tyndall): march toward the sun through the cloud field
  vec2 stepv = (uSun - uv) / 36.0;
  vec2 s = uv;
  float rays = 0.0, decay = 1.0;
  for (int i = 0; i < 36; i++) {
    s += stepv;
    float c = texture(uCloud, s).r;
    float land = step(s.y, H - 0.02);
    rays += (1.0 - max(c, land)) * decay;
    decay *= 0.965;
  }
  rays /= 36.0 * 0.55;
  float rayMask = smoothstep(0.05, 0.9, rays) * exp(-sunD * 1.3);
  // light shafts are visible where something partly blocks them
  float shafts = rayMask * (0.30 + 0.70 * smoothstep(0.02, 0.4, dens + occ));
  // fanned beams radiating from the sun, slowly turning (Tyndall effect in hazy air)
  vec2 dv = Q - sunQ;
  float ang = atan(dv.y, dv.x);
  float beams = noise1(ang * 14.0 + t * 0.05) * 0.6 + noise1(ang * 37.0 - t * 0.08) * 0.4;
  beams = pow(beams, 3.2) * exp(-sunD * 1.4) * smoothstep(0.03, 0.14, sunD);
  shafts += beams * 0.32 * (0.5 + 0.5 * smoothstep(-0.2, 0.2, -dv.y));

  // ---------------- land ----------------
  // All land features live in a "virtual" frame where the land is 0.36 tall, so ridges, trees
  // and the river keep their proportions on any canvas shape (wide desktop, tall phone page).
  float HV = 0.36;
  float kv = HV / H;
  float vy = uv.y * kv;
  float vx = P.x * kv;
  float ASPV = ASPECT * kv;
  vec2 sunPv = sunP * kv;
  // layers, far -> near: [base, amp, freq, seed, flatness, aerial]
  float bases[5] = float[5](HV - 0.030, HV - 0.065, HV - 0.100, HV - 0.135, HV - 0.165);
  float amps[5]  = float[5](0.080, 0.085, 0.075, 0.060, 0.045);
  float freqs[5] = float[5](0.8, 1.3, 1.9, 2.6, 3.4);
  float aer[5]   = float[5](0.58, 0.42, 0.28, 0.16, 0.07);
  float landTop = -1.0;
  bool onLand = false;
  for (int k = 0; k < 5; k++) {
    float fk = float(k);
    float x = vx + uPar.x * 0.004 * (fk + 1.0);
    float seed = 11.0 + fk * 37.0;
    float hs = ridgeSmooth(x, bases[k], amps[k], freqs[k], seed, 0.55);
    float h = hs + treeLine(x, fk);
    if (k == 0) landTop = h;
    if (vy < h) {
      onLand = true;
      float e = 0.01;
      float crestSlope = (ridgeSmooth(x + e, bases[k], amps[k], freqs[k], seed, 0.55) - ridgeSmooth(x - e, bases[k], amps[k], freqs[k], seed, 0.55)) / (2.0 * e);
      float depthIn = hs - vy;
      vec3 c = canopy(vec2(x, vy), fk, depthIn, crestSlope);
      c *= 1.0 + 0.30 * smoothstep(0.010, 0.0, depthIn);                  // crest catches the light
      float fog = smoothstep(0.02, 0.09, depthIn) * (0.36 - fk * 0.06);    // valley fog below each ridge
      c = mix(c, hazeColor(sunD), clamp(aer[k] + fog * (1.0 - aer[k]), 0.0, 1.0));
      col = c;
    }
  }

  // meadow + river (ground plane below the near ridge)
  float gTop = HV - 0.175 + (fbm1(vx * 3.0 + 5.0) - 0.5) * 0.015;
  if (vy < gTop) {
    float sNear = clamp((gTop - vy) / gTop, 0.0, 1.0);   // 0 far, 1 at the bottom edge
    float z = 1.0 / (sNear + 0.045);
    // river meanders in world space, shrinks with distance
    float cx = uRiverX * ASPV + (sin(z * 0.50 + 1.3) * 0.75 + sin(z * 1.27) * 0.22) * sNear * 0.60;
    float halfW = 0.010 + 0.20 * sNear;
    float dx = (vx - cx) / halfW;                    // -1..1 across the river
    vec2 gp = vec2((vx - cx) / max(sNear, 0.03), z); // ground coordinates
    // grass, gold and soil
    float g1 = fbm(gp * vec2(5.0, 1.6));
    float g2 = fbm4(gp * vec2(28.0, 9.0));
    float blades = fbm4(vec2(gp.x * 60.0, z * 3.0)) * 0.6 + vnoise(vec2(vx * 900.0, vy * 260.0)) * 0.4 * smoothstep(0.3, 1.0, sNear);
    vec3 grass = mix(vec3(0.11, 0.22, 0.07), vec3(0.27, 0.36, 0.12), g2 * 0.6 + blades * 0.5);
    float shrub = smoothstep(0.66, 0.74, fbm4(gp * vec2(14.0, 4.0) + 9.0));
    grass = mix(grass, vec3(0.07, 0.16, 0.06), shrub * 0.8);
    grass = mix(grass, vec3(0.50, 0.40, 0.18), smoothstep(0.50, 0.72, g1) * 0.75);   // autumn gold
    grass = mix(grass, vec3(0.32, 0.22, 0.12), smoothstep(0.62, 0.80, fbm4(gp * vec2(3.0, 0.8) + 21.0)) * 0.6); // bracken brown
    vec3 ground = grass * (0.80 + 0.30 * g2);
    ground *= 0.62 + 0.38 * smoothstep(0.0, 0.25, sNear);                  // the far meadow lies in the forest's shade
    ground *= 1.0 + 0.35 * smoothstep(0.55, 0.8, fbm4(gp * vec2(1.5, 0.5) + vec2(t * 0.02, 0.0)));  // drifting sunlit patches
    // wet bank
    float bank = smoothstep(1.55, 1.0, abs(dx));
    ground = mix(ground, vec3(0.30, 0.22, 0.14), bank * 0.75);
    if (abs(dx) < 1.0) {
      float edge = abs(dx);
      float flow = fbm(vec2(gp.x * 3.0, (z + t * 1.5) * 1.6));
      float flow2 = fbm4(vec2(gp.x * 9.0, (z + t * 2.4) * 5.0));
      vec3 deep = vec3(0.04, 0.30, 0.34);
      vec3 refl = skyColor(vec2(uv.x, HV + 0.25 + 0.4 * (1.0 - sNear)), sunD);
      vec3 water = mix(deep, refl, 0.38 + 0.4 * (1.0 - sNear));
      // clear shallows: stony bed shows near the banks
      vec3 bed = mix(vec3(0.42, 0.33, 0.20), vec3(0.62, 0.52, 0.36), fbm4(gp * vec2(40.0, 12.0)));
      water = mix(water, bed, smoothstep(0.45, 1.0, edge) * 0.55);
      // ripples and white water over rocks
      water += vec3(0.85, 0.95, 1.0) * smoothstep(0.60, 0.78, flow) * 0.40;
      float rock = smoothstep(0.64, 0.74, fbm4(gp * vec2(6.0, 2.0) + 3.0));
      water = mix(water, vec3(0.93, 0.97, 1.0), rock * smoothstep(0.45, 0.8, flow2) * 0.8);
      // sun glints
      float glint = pow(vnoise(vec2(gp.x * 40.0, (z + t * 1.5) * 22.0)), 12.0) * exp(-abs(vx - sunPv.x) * 1.2);
      water += vec3(1.0, 0.95, 0.80) * glint * 6.0;
      ground = mix(water, ground, smoothstep(0.92, 1.0, edge));
    }
    // aerial perspective on the far meadow
    ground = mix(ground, hazeColor(sunD), (1.0 - smoothstep(0.0, 0.5, sNear)) * 0.45);
    col = ground;
  }

  // ---------------- foreground forest ----------------
  // rows of conifers, back to front; a clearing and the river stay open
  float riverBottom = uRiverX * ASPV;
  for (int r = 0; r < 4; r++) {
    float fr = float(r);
    float baseY = gTop - 0.012 - fr * 0.048;
    float hMin = 0.05 + fr * 0.045, hMax = 0.10 + fr * 0.085;
    float density = 28.0 - fr * 5.5;               // trees per unit width
    float seed = 91.0 + fr * 17.0;
    float sway = sin(t * 0.9 + fr) * 0.0012;
    float x = vx * density + seed + uPar.x * 0.02 * (fr + 1.0);
    float cell = floor(x);
    for (int n = -2; n <= 2; n++) {
      float c = cell + float(n);
      float rnd = hash11(c * 1.37 + seed);
      float cxT = c + 0.5 + (hash11(c * 7.13 + seed) - 0.5) * 0.7;
      float treeX = (cxT - seed - uPar.x * 0.02 * (fr + 1.0)) / density;   // back to P.x units
      float u = treeX / ASPV;
      if (u > uClearing.x && u < uClearing.y) continue;
      if (abs(treeX - riverBottom) < 0.10 + fr * 0.06) continue;
      float h = mix(hMin, hMax, rnd);
      float bottom = baseY + (hash11(c * 3.3 + seed) - 0.5) * 0.025;
      float yr = (vy - bottom) / h;              // 0 at the base, 1 at the tip
      if (yr < -0.25 || yr > 1.15) continue;
      bool deciduous = hash11(c * 5.9 + seed) > 0.88;
      float dxT = (x - cxT) / density + sway * yr * yr;   // in P units
      vec3 tc;
      bool hit = false;
      if (yr < 0.06) {
        // short trunk under the lowest branches
        if (abs(dxT) < h * 0.03 && yr > -0.10) { hit = true; tc = vec3(0.20, 0.13, 0.08) * (0.8 + 0.4 * step(0.0, dxT)); }
      } else if (deciduous) {
        // crown built from a few overlapping lumps, sized to fit the tree's cell
        float rw = 1.15 / density;                  // crown half-width in P units
        float rh = h * 0.42;                        // crown half-height
        vec2 q0 = vec2(dxT / rw, (vy - (bottom + h * 0.62)) / rh);
        float best = 9.0; vec2 bq = vec2(0.0);
        for (int L = 0; L < 4; L++) {
          float fl = float(L);
          vec2 off = vec2(hash11(c * 2.1 + fl * 3.7) - 0.5, hash11(c * 4.3 + fl * 1.9) - 0.4) * vec2(0.9, 0.9);
          float rad = 0.48 + hash11(c * 9.7 + fl) * 0.22;
          vec2 q = q0 - off;
          float dd = length(q) / rad;
          if (dd < best) { best = dd; bq = q / rad; }
        }
        float leafN = fbm4(vec2(x * 7.0, vy * 190.0));
        if (best + (leafN - 0.5) * 0.4 < 1.0 && length(q0) < 1.45) {
          hit = true;
          tc = mix(vec3(0.20, 0.07, 0.02), vec3(0.62, 0.34, 0.08), leafN);
          tc *= 0.55 + 0.6 * clamp(bq.x * 0.5 + bq.y * 0.55 + 0.35, 0.0, 1.0);   // lit from the upper right
        }
      } else {
        // spruce: irregular drooping branch tiers, ragged needle edge, backlit by the sun ahead
        float y2 = (yr - 0.04) / 0.96;
        float nt = 7.0 + rnd * 4.0;
        float tierF = y2 * nt + rnd;
        float tierI = floor(tierF);
        float side = step(0.0, dxT);
        float reach = 0.62 + 0.55 * hash11(tierI * 7.1 + c * 3.3 + side * 1.7);   // each branch its own length
        float droop = 1.0 - fract(tierF) * 0.45;
        float w = (1.0 - y2) * h * 0.30 * reach * droop;
        w *= 0.78 + 0.42 * vnoise(vec2(x * 34.0, vy * 520.0));                // needle clumps
        if (y2 > 1.0 || y2 < 0.0) w = 0.0;
        if (abs(dxT) < w) {
          hit = true;
          float sd = clamp(dxT / max(w, 1e-4), -1.0, 1.0);
          float needles = vnoise(vec2(x * 70.0, vy * 480.0));
          tc = mix(vec3(0.008, 0.025, 0.022), vec3(0.035, 0.085, 0.055), needles);
          tc *= 0.65 + 0.55 * fract(tierF);                                      // shadow under each tier
          tc *= 0.85 + 0.35 * clamp(sd * 0.7 + 0.3, 0.0, 1.0);
          // golden rim where sunlight grazes the needle tips
          float rim = smoothstep(0.70, 1.0, abs(sd)) * (0.5 + 0.5 * step(0.0, sd));
          tc += vec3(1.0, 0.76, 0.32) * rim * (1.0 - y2 * 0.4) * 0.42;
        }
      }
      if (hit) {
        tc = mix(tc, hazeColor(sunD), 0.42 - fr * 0.135);
        col = tc;
      }
    }
  }

  // ---------------- light, grading ----------------
  col += vec3(1.0, 0.86, 0.55) * shafts * (onLand ? 0.25 : 0.55);
  col = 1.0 - exp(-col * 1.25);                           // gentle filmic shoulder
  col = pow(col, vec3(0.95));
  float vig = smoothstep(1.25, 0.35, length((uv - 0.5) * vec2(1.0, 0.8)));
  col *= 0.86 + 0.14 * vig;
  col += (hash12(gl_FragCoord.xy + fract(t) * 91.0) - 0.5) * 0.018;   // film grain
  o = vec4(col, 1.0);
}
`

const FULLSCREEN = new Float32Array([-1, -1, 3, -1, -1, 3])

function compile(gl, type, src) {
  const sh = gl.createShader(type)
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh)
    gl.deleteShader(sh)
    throw new Error(`shader compile failed: ${log}`)
  }
  return sh
}

function program(gl, fragSrc) {
  const p = gl.createProgram()
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VERT))
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fragSrc))
  gl.bindAttribLocation(p, 0, 'aPos')
  gl.linkProgram(p)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`link failed: ${gl.getProgramInfoLog(p)}`)
  const u = {}
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS)
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i)
    u[info.name] = gl.getUniformLocation(p, info.name)
  }
  return { p, u }
}

/**
 * Start the scene on a canvas. Returns { setPointer, setView, destroy } or null if WebGL2 is missing.
 * view: { horizon (0..1 from bottom), sun: [x, y] (0..1, y from bottom) }
 */
export function createOutdoorScene(canvas, { scale = 0.5, fps = 30, animate = true, view = {}, layout = null } = {}) {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, powerPreference: 'low-power', preserveDrawingBuffer: false })
  if (!gl) return null

  let cloudProg, sceneProg
  try {
    cloudProg = program(gl, CLOUD_FRAG)
    sceneProg = program(gl, SCENE_FRAG)
  } catch (e) {
    console.warn('[scene]', e.message)
    return null
  }

  const vbo = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
  gl.bufferData(gl.ARRAY_BUFFER, FULLSCREEN, gl.STATIC_DRAW)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)

  const cloudTex = gl.createTexture()
  const fbo = gl.createFramebuffer()
  let cw = 0, ch = 0, w = 0, h = 0, skyRef = 1

  let horizon = view.horizon ?? SCENE.horizon
  let sun = view.sun ?? SCENE.sun
  const par = [0, 0], parTarget = [0, 0]
  let raf = 0, last = 0, start = performance.now(), running = true

  function resize() {
    const r = canvas.getBoundingClientRect()
    if (layout) {
      const l = layout(r.width, r.height)
      if (l.horizon != null) horizon = l.horizon
      if (l.sun) sun = l.sun
    }
    w = Math.max(2, Math.round(r.width * scale))
    h = Math.max(2, Math.round(r.height * scale))
    // sky unit = a desktop-height worth of sky; on tall phone pages clouds keep their size
    skyRef = Math.min(r.height, Math.max(r.width * 0.625, 560)) * scale
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
    const ncw = Math.max(2, Math.round(w / 4)), nch = Math.max(2, Math.round(h / 4))
    if (ncw !== cw || nch !== ch) {
      cw = ncw; ch = nch
      gl.bindTexture(gl.TEXTURE_2D, cloudTex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, cw, ch, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, cloudTex, 0)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    }
  }

  function common(prog, rw, rh, time) {
    gl.useProgram(prog.p)
    gl.uniform2f(prog.u.uRes, rw, rh)
    gl.uniform1f(prog.u.uTime, time)
    gl.uniform1f(prog.u.uHorizon, horizon)
    gl.uniform2f(prog.u.uSun, sun[0], sun[1])
    gl.uniform2f(prog.u.uPar, par[0], par[1])
    gl.uniform1f(prog.u.uSkyRef, skyRef * (rw / w))
  }

  function draw(now) {
    const time = 40 + (now - start) / 1000   // start mid-drift so clouds are already spread out
    par[0] += (parTarget[0] - par[0]) * 0.06
    par[1] += (parTarget[1] - par[1]) * 0.06
    // pass 1
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.viewport(0, 0, cw, ch)
    common(cloudProg, cw, ch, time)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    // pass 2
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, w, h)
    common(sceneProg, w, h, time)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, cloudTex)
    gl.uniform1i(sceneProg.u.uCloud, 0)
    gl.uniform1f(sceneProg.u.uRiverX, SCENE.riverX)
    gl.uniform2f(sceneProg.u.uClearing, SCENE.clearing[0], SCENE.clearing[1])
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  function loop(now) {
    raf = 0
    if (!running) return
    if (now - last >= 1000 / fps) { last = now; draw(now) }
    raf = requestAnimationFrame(loop)
  }

  const ro = new ResizeObserver(() => { resize(); if (!animate) draw(performance.now()) })
  ro.observe(canvas)
  const onVis = () => {
    running = document.visibilityState !== 'hidden' && animate
    if (running && !raf) raf = requestAnimationFrame(loop)
  }
  document.addEventListener('visibilitychange', onVis)

  resize()
  draw(performance.now())
  if (animate) raf = requestAnimationFrame(loop)

  return {
    setPointer(x, y) { parTarget[0] = x; parTarget[1] = y },
    setView(v) { if (v.horizon != null) horizon = v.horizon; if (v.sun) sun = v.sun; if (!animate) draw(performance.now()) },
    destroy() {
      running = false
      cancelAnimationFrame(raf)
      ro.disconnect()
      document.removeEventListener('visibilitychange', onVis)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    },
  }
}
