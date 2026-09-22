export const DEG = Math.PI / 180;
export const TAU = Math.PI * 2;

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
export function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
export function lerp(a, b, t) {
  return a + (b - a) * t;
}
export function invLerp(a, b, v) {
  return a === b ? 0 : clamp01((v - a) / (b - a));
}
export function remap(v, a, b, c, d) {
  return lerp(c, d, invLerp(a, b, v));
}
export function smoothstep(t) {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}
export function smootherstep(t) {
  const x = clamp01(t);
  return x * x * x * (x * (x * 6 - 15) + 10);
}
export function damp(a, b, lambda, dt) {
  return lerp(a, b, 1 - Math.exp(-lambda * dt));
}
export function wrapAngle(a) {
  let x = (a + Math.PI) % TAU;
  if (x < 0) x += TAU;
  return x - Math.PI;
}
export function angleLerp(a, b, t) {
  return a + wrapAngle(b - a) * t;
}
export function angleDamp(a, b, lambda, dt) {
  return a + wrapAngle(b - a) * (1 - Math.exp(-lambda * dt));
}
export function roundTo(v, step) {
  return Math.round(v / step) * step;
}
export function distance2(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}
export function formatClock(minutes) {
  const m = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = Math.floor(m % 60);
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
