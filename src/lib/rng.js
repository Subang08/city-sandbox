const TWO32 = 4294967296;

export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / TWO32;
  };
}

export class Rng {
  constructor(seed = 'sandbox') {
    this.seed = typeof seed === 'number' ? seed : hashSeed(seed);
    this.next = mulberry32(this.seed);
  }
  range(a, b) {
    return a + (b - a) * this.next();
  }
  int(a, b) {
    return Math.floor(this.range(a, b + 1 - 1e-9));
  }
  pick(list) {
    return list[Math.min(list.length - 1, Math.floor(this.next() * list.length))];
  }
  chance(p) {
    return this.next() < p;
  }
  sign() {
    return this.next() < 0.5 ? -1 : 1;
  }
  fork(tag) {
    return new Rng((this.seed ^ hashSeed(tag)) >>> 0);
  }
}
