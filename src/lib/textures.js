import THREE from './three.js';
import { Noise2D } from './noise.js';

/**
 * TextureKit - procedural canvas textures. No image files, so the project stays
 * offline and asset-free while surfaces stop reading as flat colour blocks.
 *
 * Every generator returns a CanvasTexture (or null in a headless context), and
 * all of them are cheap: 256-512 px, generated once and shared across materials.
 */
export class TextureKit {
  constructor({ seed = 'textures', size = 512 } = {}) {
    this.enabled = typeof document !== 'undefined';
    this.size = size;
    this.noise = new Noise2D(seed);
    this.cache = new Map();
    this.stats = { created: 0 };
  }

  _canvas(size = this.size) {
    if (!this.enabled) return null;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    return canvas;
  }

  _finish(canvas, { repeat = [1, 1], srgb = true, aniso = 4 } = {}) {
    if (!canvas) return null;
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    // GeometryBatch bakes tiling into world-space UVs, so textures must not scale
    // again or the two multiplies fight each other.
    texture.repeat.set(1, 1);
    texture.anisotropy = aniso;
    texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.needsUpdate = true;
    this.stats.created++;
    return texture;
  }

  /** Memoised generator: same key always returns the same texture instance. */
  get(key, factory) {
    if (!this.enabled) return null;
    if (!this.cache.has(key)) this.cache.set(key, factory());
    return this.cache.get(key);
  }

  // ---------------------------------------------------------------- concrete
  /**
   * Concrete: fine aggregate noise, panel seams, form-tie marks and a few
   * vertical water stains. Tinted lightly so per-instance colours still read.
   */
  concrete(repeat = [1, 1], options = {}) {
    const { seams = 4, stains = 0.35, tint = [255, 255, 255], base = [240, 236, 229] } = options;
    return this.get(`concrete:${seams}:${stains}:${base.join()}:${repeat.join()}`, () => {
      const size = this.size;
      const canvas = this._canvas(size);
      if (!canvas) return null;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`;
      ctx.fillRect(0, 0, size, size);

      const image = ctx.getImageData(0, 0, size, size);
      const data = image.data;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const index = (y * size + x) * 4;
          const grain = this.noise.fbm(x * 0.09, y * 0.09, 4);
          const blotch = this.noise.fbm(x * 0.012, y * 0.012, 3);
          const value = (grain - 0.5) * 20 + (blotch - 0.5) * 16;
          data[index] = Math.max(0, Math.min(255, data[index] + value + (tint[0] - 255) * 0.25));
          data[index + 1] = Math.max(0, Math.min(255, data[index + 1] + value + (tint[1] - 255) * 0.25));
          data[index + 2] = Math.max(0, Math.min(255, data[index + 2] + value * 0.9 + (tint[2] - 255) * 0.25));
        }
      }
      ctx.putImageData(image, 0, 0);

      // Panel seams.
      ctx.strokeStyle = 'rgba(120,116,108,0.55)';
      ctx.lineWidth = 2;
      for (let i = 0; i <= seams; i++) {
        const p = (i / seams) * size;
        ctx.beginPath();
        ctx.moveTo(p, 0);
        ctx.lineTo(p, size);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, p);
        ctx.lineTo(size, p);
        ctx.stroke();
      }
      // Form-tie marks.
      ctx.fillStyle = 'rgba(150,146,138,0.5)';
      for (let i = 0; i < 18; i++) {
        const x = this.noise.value(i * 3.1, 1.7) * size;
        const y = this.noise.value(1.3, i * 2.9) * size;
        ctx.beginPath();
        ctx.arc(x, y, 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
      // Water stains running down from the top (kept light: a dark multiplier map
      // would darken the whole surface, not just the stain).
      const stainCount = Math.round(6 * stains * 2);
      for (let i = 0; i < stainCount; i++) {
        const x = this.noise.value(i * 5.3, 0.4) * size;
        const width = 8 + this.noise.value(i * 1.7, 2.2) * 26;
        const height = size * (0.3 + this.noise.value(i * 2.3, 4.1) * 0.7);
        const gradient = ctx.createLinearGradient(0, 0, 0, height);
        gradient.addColorStop(0, 'rgba(150,146,138,0.18)');
        gradient.addColorStop(1, 'rgba(150,146,138,0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(x - width / 2, 0, width, height);
      }
      return this._finish(canvas, { repeat });
    });
  }

  // ------------------------------------------------------------------- glass
  /**
   * Curtain-wall glass: vertical mullion rhythm, graded reflection and a handful
   * of lit interior panes (used as an emissive map so night windows glow).
   */
  glass(repeat = [1, 1]) {
    return this.get(`glass:${repeat.join()}`, () => {
      const size = this.size;
      const canvas = this._canvas(size);
      if (!canvas) return null;
      const ctx = canvas.getContext('2d');
      const gradient = ctx.createLinearGradient(0, 0, size * 0.35, size);
      gradient.addColorStop(0, '#9ec4d8');
      gradient.addColorStop(0.45, '#5d7f95');
      gradient.addColorStop(1, '#33505f');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);
      // Sky slivers reflected on the upper part of each pane.
      ctx.globalAlpha = 0.22;
      for (let i = 0; i < 14; i++) {
        ctx.fillStyle = '#dcecf5';
        ctx.fillRect(this.noise.value(i * 4.4, 1) * size, this.noise.value(i, 2.4) * size * 0.5, 3 + this.noise.value(i, 3) * 6, size * 0.32);
      }
      ctx.globalAlpha = 1;
      // Mullions.
      ctx.strokeStyle = 'rgba(24,34,42,0.75)';
      ctx.lineWidth = 3;
      for (let i = 0; i <= 4; i++) {
        const p = (i / 4) * size;
        ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, size); ctx.stroke();
      }
      for (let i = 1; i < 4; i++) {
        const p = (i / 4) * size;
        ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(size, p); ctx.stroke();
      }
      return this._finish(canvas, { repeat });
    });
  }

  /** Emissive companion for glass: mostly black with some warm lit panes. */
  glassEmissive(repeat = [1, 1]) {
    return this.get(`glassEmissive:${repeat.join()}`, () => {
      const size = this.size;
      const canvas = this._canvas(size);
      if (!canvas) return null;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, size, size);
      const cell = size / 4;
      for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 4; col++) {
          const roll = this.noise.value(col * 7.3 + 0.5, row * 5.1 + 0.5);
          if (roll < 0.46) continue;
          const warm = roll > 0.78 ? '#fff2d2' : roll > 0.62 ? '#ffd9a0' : '#cfe2f0';
          ctx.fillStyle = warm;
          ctx.globalAlpha = 0.55 + roll * 0.45;
          ctx.fillRect(col * cell + 4, row * cell + 5, cell - 8, cell - 10);
        }
      }
      ctx.globalAlpha = 1;
      return this._finish(canvas, { repeat });
    });
  }

  // ----------------------------------------------------------------- asphalt
  /** Worn asphalt: aggregate speckle, patch repairs, cracks and faded paint. */
  asphalt(repeat = [1, 1]) {
    return this.get(`asphalt:${repeat.join()}`, () => {
      const size = this.size;
      const canvas = this._canvas(size);
      if (!canvas) return null;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#4c525a';
      ctx.fillRect(0, 0, size, size);
      const image = ctx.getImageData(0, 0, size, size);
      const data = image.data;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const index = (y * size + x) * 4;
          const speckle = this.noise.value(x * 0.7, y * 0.7);
          const patch = this.noise.fbm(x * 0.02, y * 0.02, 3);
          const value = (speckle - 0.5) * 46 + (patch - 0.5) * 30;
          data[index] = Math.max(0, Math.min(255, data[index] + value));
          data[index + 1] = Math.max(0, Math.min(255, data[index + 1] + value));
          data[index + 2] = Math.max(0, Math.min(255, data[index + 2] + value * 1.05));
        }
      }
      ctx.putImageData(image, 0, 0);
      // Patch repairs.
      ctx.globalAlpha = 0.3;
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = i % 2 ? '#4a4f56' : '#33373c';
        const w = 40 + this.noise.value(i * 3, 1) * 90;
        const h = 30 + this.noise.value(i, 4) * 70;
        ctx.fillRect(this.noise.value(i * 2.2, 2) * size, this.noise.value(3, i * 2.6) * size, w, h);
      }
      ctx.globalAlpha = 1;
      // Cracks.
      ctx.strokeStyle = 'rgba(24,26,30,0.7)';
      for (let i = 0; i < 7; i++) {
        ctx.lineWidth = 1 + this.noise.value(i, 9) * 2;
        ctx.beginPath();
        let x = this.noise.value(i * 6.1, 1.2) * size;
        let y = this.noise.value(1.4, i * 5.7) * size;
        ctx.moveTo(x, y);
        for (let step = 0; step < 6; step++) {
          x += (this.noise.value(i + step, 3.3) - 0.5) * 70;
          y += (this.noise.value(step + 2, i + 4.4) - 0.5) * 70;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      return this._finish(canvas, { repeat });
    });
  }

  // -------------------------------------------------------------------- dirt
  /** Site ground: compacted gravel, tyre scuffs and scattered debris. */
  dirt(repeat = [1, 1]) {
    return this.get(`dirt:${repeat.join()}`, () => {
      const size = this.size;
      const canvas = this._canvas(size);
      if (!canvas) return null;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ab9878';
      ctx.fillRect(0, 0, size, size);
      const image = ctx.getImageData(0, 0, size, size);
      const data = image.data;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const index = (y * size + x) * 4;
          const grain = this.noise.value(x * 0.9, y * 0.9);
          const patch = this.noise.fbm(x * 0.014, y * 0.014, 4);
          const value = (grain - 0.5) * 40 + (patch - 0.5) * 52;
          data[index] = Math.max(0, Math.min(255, data[index] + value));
          data[index + 1] = Math.max(0, Math.min(255, data[index + 1] + value * 0.96));
          data[index + 2] = Math.max(0, Math.min(255, data[index + 2] + value * 0.78));
        }
      }
      ctx.putImageData(image, 0, 0);
      // Tyre scuffs.
      ctx.strokeStyle = 'rgba(58,52,44,0.32)';
      for (let i = 0; i < 6; i++) {
        ctx.lineWidth = 9 + this.noise.value(i, 2) * 8;
        ctx.beginPath();
        const y = this.noise.value(i * 3.7, 5) * size;
        ctx.moveTo(0, y);
        ctx.bezierCurveTo(size * 0.3, y + 40, size * 0.6, y - 40, size, y + 12);
        ctx.stroke();
      }
      // Debris.
      ctx.fillStyle = 'rgba(120,112,100,0.5)';
      for (let i = 0; i < 120; i++) {
        const x = this.noise.value(i * 1.3, 0.7) * size;
        const y = this.noise.value(0.9, i * 1.7) * size;
        ctx.fillRect(x, y, 1 + this.noise.value(i, 8) * 3, 1 + this.noise.value(i, 6) * 3);
      }
      return this._finish(canvas, { repeat });
    });
  }

  // -------------------------------------------------------------- fence skin
  /** Hoarding panel: corrugation shading, rust streaks and a stencilled mark. */
  fencePanel(repeat = [1, 1]) {
    return this.get(`fence:${repeat.join()}`, () => {
      const size = this.size;
      const canvas = this._canvas(size);
      if (!canvas) return null;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size, size);
      // Corrugation.
      for (let x = 0; x < size; x += 10) {
        const shade = 210 + Math.round(this.noise.value(x * 0.4, 1) * 40);
        ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
        ctx.fillRect(x, 0, 6, size);
      }
      // Rust streaks from the top rail.
      for (let i = 0; i < 9; i++) {
        const x = this.noise.value(i * 4.1, 2.2) * size;
        const gradient = ctx.createLinearGradient(0, 0, 0, size * 0.5);
        gradient.addColorStop(0, 'rgba(120,72,40,0.35)');
        gradient.addColorStop(1, 'rgba(120,72,40,0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(x, 0, 4 + this.noise.value(i, 3) * 10, size * 0.5);
      }
      // Stencil band.
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.fillRect(0, size * 0.42, size, size * 0.08);
      ctx.fillStyle = 'rgba(40,40,40,0.5)';
      for (let i = 0; i < 5; i++) ctx.fillRect(size * (0.06 + i * 0.19), size * 0.44, size * 0.11, size * 0.04);
      return this._finish(canvas, { repeat });
    });
  }

  /** Sand / aggregate pile surface. */
  aggregate(repeat = [1, 1], warm = true) {
    return this.get(`aggregate:${warm}:${repeat.join()}`, () => {
      const size = this.size;
      const canvas = this._canvas(size, size);
      if (!canvas) return null;
      const ctx = canvas.getContext('2d');
      const base = warm ? [214, 190, 142] : [170, 168, 162];
      ctx.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`;
      ctx.fillRect(0, 0, size, size);
      for (let i = 0; i < 2600; i++) {
        const x = this.noise.value(i * 0.7, 1.1) * size;
        const y = this.noise.value(1.9, i * 0.6) * size;
        const r = 0.8 + this.noise.value(i, 4) * 2.6;
        const shade = base[0] + (this.noise.value(i, 7) - 0.5) * 70;
        ctx.fillStyle = `rgba(${Math.round(shade)},${Math.round(shade * 0.9)},${Math.round(shade * 0.72)},0.55)`;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      return this._finish(canvas, { repeat });
    });
  }

  /** Generic roughness companion: noise-driven, keeps highlights from looking plastic. */
  roughness(repeat = [1, 1], base = 0.75, variance = 0.25) {
    return this.get(`rough:${base}:${variance}:${repeat.join()}`, () => {
      const size = 256;
      const canvas = this._canvas(size);
      if (!canvas) return null;
      const ctx = canvas.getContext('2d');
      const image = ctx.createImageData(size, size);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const index = (y * size + x) * 4;
          const value = base + (this.noise.fbm(x * 0.05, y * 0.05, 3) - 0.5) * variance * 2;
          const byte = Math.max(0, Math.min(255, Math.round(value * 255)));
          image.data[index] = byte;
          image.data[index + 1] = byte;
          image.data[index + 2] = byte;
          image.data[index + 3] = 255;
        }
      }
      ctx.putImageData(image, 0, 0);
      return this._finish(canvas, { repeat, srgb: false });
    });
  }
}
