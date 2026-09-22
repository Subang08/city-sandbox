/**
 * Deterministic value noise + fbm. No dependencies, stable across runs.
 */
import { hashSeed } from './rng.js';

function hash2(x, y, seed) {
  let h = seed ^ Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smooth(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export class Noise2D {
  constructor(seed = 'noise') {
    this.seed = hashSeed(seed);
  }

  value(x, y) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = smooth(xf);
    const v = smooth(yf);
    const a = hash2(xi, yi, this.seed);
    const b = hash2(xi + 1, yi, this.seed);
    const c = hash2(xi, yi + 1, this.seed);
    const d = hash2(xi + 1, yi + 1, this.seed);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  }

  fbm(x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * this.value(x * freq, y * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }
}

export class Noise1D {
  constructor(seed = 'noise1') {
    this.noise = new Noise2D(seed);
  }
  value(x) {
    return this.noise.value(x, 0.5);
  }
  fbm(x, octaves = 3) {
    return this.noise.fbm(x, 0.5, octaves);
  }
}
