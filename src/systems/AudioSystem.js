import { clamp, clamp01, damp } from '../lib/mathx.js';

/**
 * AudioSystem - fully procedural WebAudio (no asset files).
 * Ambience beds respond to weather + time of day; events trigger short synthesized
 * hits (hammer, impact, horn, beep). Created lazily on the first user gesture.
 */
export class AudioSystem {
  constructor({ bus, enabled = true }) {
    this.bus = bus;
    this.enabled = enabled && typeof window !== 'undefined';
    this.ready = false;
    this.volume = 0.55;
    this.muted = false;
    this.layers = {};
    this._bind();
  }

  _bind() {
    if (typeof window === 'undefined') return;
    this._unlock = () => this.start();
    window.addEventListener('pointerdown', this._unlock, { once: true });
    window.addEventListener('keydown', this._unlock, { once: true });

    this.bus.on('construction:floorComplete', () => this.hit('impact', { gain: 0.35, freq: 90 }));
    this.bus.on('crane:pickup', () => this.hit('latch', { gain: 0.2 }));
    this.bus.on('crane:drop', () => this.hit('impact', { gain: 0.3, freq: 120 }));
    this.bus.on('vehicle:beep', () => this.beep());
    this.bus.on('character:hammer', () => this.hit('hammer', { gain: 0.16 }));
    this.bus.on('ui:click', () => this.click());
    this.bus.on('weather:changed', ({ name }) => this.onWeather(name));
  }

  start() {
    if (!this.enabled || this.ready) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) {
      this.enabled = false;
      return;
    }
    try {
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(this.ctx.destination);
      this.noise = this._noiseBuffer(4);
      this._buildLayers();
      this.ready = true;
      this.bus.emit('audio:ready', {});
    } catch (error) {
      this.enabled = false;
      this.bus.emit('audio:error', { message: String(error && error.message) });
    }
  }

  _noiseBuffer(seconds) {
    const length = Math.floor(this.ctx.sampleRate * seconds);
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.2 + white * 0.35;
    }
    return buffer;
  }

  _buildLayers() {
    const mk = (filterType, frequency, q, gainValue) => {
      const source = this.ctx.createBufferSource();
      source.buffer = this.noise;
      source.loop = true;
      const filter = this.ctx.createBiquadFilter();
      filter.type = filterType;
      filter.frequency.value = frequency;
      filter.Q.value = q;
      const gain = this.ctx.createGain();
      gain.gain.value = gainValue;
      source.connect(filter).connect(gain).connect(this.master);
      source.start();
      return { source, filter, gain };
    };
    this.layers.wind = mk('lowpass', 420, 0.7, 0.0);
    this.layers.rain = mk('bandpass', 2400, 0.5, 0.0);
    this.layers.site = mk('lowpass', 220, 1.2, 0.0);

    const rumble = this.ctx.createOscillator();
    rumble.type = 'sine';
    rumble.frequency.value = 46;
    const rumbleGain = this.ctx.createGain();
    rumbleGain.gain.value = 0.0;
    rumble.connect(rumbleGain).connect(this.master);
    rumble.start();
    this.layers.rumble = { source: rumble, gain: rumbleGain };
  }

  onWeather(name) {
    this.weatherName = name;
  }

  _env({ wind = 0, rain = 0, site = 0, rumble = 0 } = {}) {
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    const ramps = [
      [this.layers.wind, wind * 0.5],
      [this.layers.rain, rain * 0.42],
      [this.layers.site, site * 0.2],
      [this.layers.rumble, rumble * 0.16],
    ];
    for (const [layer, value] of ramps) {
      if (!layer) continue;
      layer.gain.gain.setTargetAtTime(value, now, 1.1);
    }
    if (this.layers.wind) this.layers.wind.filter.frequency.setTargetAtTime(320 + wind * 900, now, 1.5);
    if (this.layers.rain) this.layers.rain.filter.frequency.setTargetAtTime(1800 + rain * 2600, now, 1.2);
  }

  update(dt, { weather, time } = {}) {
    if (!this.ready) return;
    const rain = weather ? (weather.rainAmount || 0) : 0;
    const snow = weather ? (weather.snowAmount || 0) : 0;
    const wind = weather ? clamp01((weather.windSpeed || 0) / 7) : 0.15;
    const workHours = time ? time.isWorkHours : true;
    const site = workHours ? 0.75 : 0.16;
    const target = { wind: 0.12 + wind * 0.7, rain: rain * 0.9 + snow * 0.25, site, rumble: workHours ? 0.8 : 0.25 };
    this.env = this.env || { wind: 0, rain: 0, site: 0, rumble: 0 };
    for (const key of Object.keys(target)) this.env[key] = damp(this.env[key], target[key], 0.4, dt);
    this._env(this.env);
  }

  hit(kind, { gain = 0.2, freq = 200 } = {}) {
    if (!this.ready || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    const env = this.ctx.createGain();
    if (kind === 'hammer') {
      osc.type = 'square';
      osc.frequency.value = freq * 3.4;
      filter.type = 'bandpass';
      filter.frequency.value = 2600;
      filter.Q.value = 3.5;
      env.gain.setValueAtTime(gain, now);
      env.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);
      noise.connect(filter).connect(env);
      osc.connect(env);
      noise.start(now);
      noise.stop(now + 0.12);
      osc.start(now);
      osc.stop(now + 0.12);
    } else if (kind === 'latch') {
      osc.type = 'triangle';
      osc.frequency.value = freq * 6;
      env.gain.setValueAtTime(gain, now);
      env.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
      osc.connect(env).connect(this.master);
      osc.start(now);
      osc.stop(now + 0.09);
    } else {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.45, now + 0.35);
      filter.type = 'lowpass';
      filter.frequency.value = 700;
      env.gain.setValueAtTime(gain, now);
      env.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
      noise.connect(filter).connect(env).connect(this.master);
      osc.connect(env);
      noise.start(now);
      noise.stop(now + 0.5);
      osc.start(now);
      osc.stop(now + 0.5);
    }
  }

  beep() {
    if (!this.ready || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = 1180;
    gain.gain.setValueAtTime(0.0, now);
    gain.gain.linearRampToValueAtTime(0.06, now + 0.02);
    gain.gain.setValueAtTime(0.06, now + 0.16);
    gain.gain.linearRampToValueAtTime(0, now + 0.2);
    osc.connect(gain).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.22);
  }

  click() {
    if (!this.ready || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = 720;
    gain.gain.setValueAtTime(0.05, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
    osc.connect(gain).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.07);
  }

  setVolume(value) {
    this.volume = clamp(value, 0, 1);
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
    this.bus.emit('audio:muted', { muted: this.muted });
  }

  toggleMute() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  get status() {
    if (!this.enabled) return typeof window === 'undefined' ? 'headless' : 'unsupported';
    if (this.muted) return 'muted';
    return this.ready ? 'running' : 'idle';
  }
}
