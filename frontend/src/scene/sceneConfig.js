// Shared layout of the outdoor scene, so the WebGL landscape and the SVG wildlife overlays agree.
export const SCENE = {
  horizon: 0.36,          // 0..1 from the bottom: farthest ridge line
  sun: [0.66, 0.86],      // sun position, 0..1 (x from left, y from bottom)
  riverX: 0.58,           // river centre where it leaves the bottom edge, 0..1
  clearing: [0.30, 0.47], // meadow clearing without foreground trees (deer and hiker live here)
}
