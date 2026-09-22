import THREE from '../lib/three.js';
import { clamp01, damp, invLerp, lerp, smoothstep } from '../lib/mathx.js';

const SUN_DISTANCE = 150;
const _color = new THREE.Color();
const _targetA = new THREE.Color();
const _targetB = new THREE.Color();

function lerpColor(target, a, b, t) {
  _targetA.set(a);
  _targetB.set(b);
  return target.copy(_targetA).lerp(_targetB, t);
}

/**
 * LightingSystem - all light sources + atmosphere response to the virtual clock.
 * Day: directional sun + hemisphere + IBL. Night: moon, emissive windows, and a
 * small number of real PointLights for the work lamps (the rest is emissive).
 */
export class LightingSystem {
  constructor({ scene, config, bus, time, kits, palettes, renderer = null }) {
    this.scene = scene;
    this.sceneManager = scene;
    this.config = config;
    this.bus = bus;
    this.time = time;
    this.kits = kits;
    this.keys = (palettes.keys || []).slice().sort((a, b) => a.t - b.t);
    this.renderer = renderer;
    this.lightingConfig = config.lighting || {};
    this.workLamps = [];
    this.streetLightHeads = [];
    this._nightFactor = 0;
    this._streetOn = false;
    this._lastAppliedMinute = -1;
    this._scratch = {
      zenith: new THREE.Color(),
      horizon: new THREE.Color(),
      ground: new THREE.Color(),
      fog: new THREE.Color(),
      sunColor: new THREE.Color(),
      hemiSky: new THREE.Color(),
      hemiGround: new THREE.Color(),
      ambient: new THREE.Color(),
      moonColor: new THREE.Color(),
    };
    this._build();
    this.apply(true);
  }

  _build() {
    const sunConfig = this.lightingConfig.sun || {};
    this.sun = new THREE.DirectionalLight(0xfff3d8, 3.0);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(sunConfig.shadowMap || 2048, sunConfig.shadowMap || 2048);
    const size = sunConfig.shadowSize || 64;
    this.sun.shadow.camera.left = -size;
    this.sun.shadow.camera.right = size;
    this.sun.shadow.camera.top = size;
    this.sun.shadow.camera.bottom = -size;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = SUN_DISTANCE * 2.4;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.06;
    this.sunTarget = new THREE.Object3D();
    this.sunTarget.position.set(0, 4, -2);
    this.scene.scene.add(this.sunTarget);
    this.sun.target = this.sunTarget;
    this.scene.scene.add(this.sun);

    this.moon = new THREE.DirectionalLight(0x9fb6e0, 0.0);
    this.moon.castShadow = false;
    this.scene.scene.add(this.moon);
    this.moon.target = this.sunTarget;

    const hemiConfig = this.lightingConfig.hemisphere || {};
    this.hemi = new THREE.HemisphereLight(hemiConfig.skyColor || 0xbcd7ee, hemiConfig.groundColor || 0x6b6152, 0.55);
    this.scene.scene.add(this.hemi);

    const ambientConfig = this.lightingConfig.ambient || {};
    this.ambient = new THREE.AmbientLight(ambientConfig.color || 0x2c3550, 0.2);
    this.scene.scene.add(this.ambient);

    // Fill light keeps the miniature readable and soft, a diorama signature.
    this.fill = new THREE.DirectionalLight(0xdfe9ff, 0.35);
    this.fill.position.set(-40, 30, -30);
    this.fill.castShadow = false;
    this.scene.scene.add(this.fill);
  }

  registerWorkLamp(light, { head }) {
    this.workLamps.push({ light, head, baseIntensity: light.intensity });
    if (head) this.streetLightHeads.push(head);
  }

  registerPointLight(light) {
    this.workLamps.push({ light, head: null, baseIntensity: light.intensity });
  }

  /** Interpolated atmosphere key for a minute of day. */
  sample(minuteOfDay) {
    const keys = this.keys;
    let a = keys[0];
    let b = keys[keys.length - 1];
    for (let i = 0; i < keys.length - 1; i++) {
      if (minuteOfDay >= keys[i].t && minuteOfDay <= keys[i + 1].t) {
        a = keys[i];
        b = keys[i + 1];
        break;
      }
    }
    const t = a === b ? 0 : smoothstep(invLerp(a.t, b.t, minuteOfDay));
    return { a, b, t };
  }

  get nightFactor() {
    return this._nightFactor;
  }

  get streetLightsOn() {
    return this._streetOn;
  }

  sunDirection(target = new THREE.Vector3()) {
    return target.copy(this.sun.position).sub(this.sunTarget.position).normalize();
  }

  sunElevation() {
    return this.sunDirection(this._sunDirScratch || (this._sunDirScratch = new THREE.Vector3())).y;
  }

  apply(force = false) {
    const minute = this.time.minuteOfDay;
    if (!force && Math.abs(minute - this._lastAppliedMinute) < 0.35) return;
    this._lastAppliedMinute = minute;

    const { a, b, t } = this.sample(minute);
    const s = this._scratch;
    const lerpNum = (ka, kb) => lerp(ka, kb, t);

    const dayFraction = minute / 1440;
    const sunConfig = this.lightingConfig.sun || {};
    const maxElevation = sunConfig.maxElevation || 1.05;
    const elevation = Math.sin((dayFraction - 0.25) * Math.PI * 2) * maxElevation;
    const azimuthBase = (dayFraction - 0.25) * Math.PI * 2;
    const azimuth = azimuthBase + (sunConfig.azimuthOffset || 0) * Math.PI;
    const horizontal = Math.cos(elevation);
    const sunDir = new THREE.Vector3(
      Math.sin(azimuth) * horizontal,
      Math.sin(elevation),
      Math.cos(azimuth) * horizontal,
    ).normalize();
    // A directional light whose direction is (nearly) parallel to its up vector
    // produces a degenerate shadow view matrix: the shadow lands in the wrong
    // place and swallows the whole site. Keep a minimum horizontal component so
    // the light direction is never vertical.
    const minimumHorizontal = 0.22;
    const flat = Math.hypot(sunDir.x, sunDir.z);
    if (flat < minimumHorizontal) {
      const scale = flat < 1e-4 ? 1 : minimumHorizontal / flat;
      sunDir.x = (flat < 1e-4 ? Math.SQRT1_2 : sunDir.x * scale);
      sunDir.z = (flat < 1e-4 ? Math.SQRT1_2 : sunDir.z * scale);
      sunDir.normalize();
    }

    this.sun.position.copy(this.sunTarget.position).addScaledVector(sunDir, SUN_DISTANCE);
    this.moon.position.set(-sunDir.x * SUN_DISTANCE, Math.abs(sunDir.y) * SUN_DISTANCE * 0.7 + 30, -sunDir.z * SUN_DISTANCE);

    lerpColor(s.sunColor, a.sun.color, b.sun.color, t);
    this.sun.color.copy(s.sunColor);
    const clearSkyBoost = clamp01(1 - (this.weatherSunScale ?? 1) * 0.55);
    void clearSkyBoost;
    this.sun.intensity = lerpNum(a.sun.intensity, b.sun.intensity) * (this.weatherSunScale ?? 1);

    lerpColor(s.moonColor, a.moon.color, b.moon.color, t);
    this.moon.color.copy(s.moonColor);
    this.moon.intensity = lerpNum(a.moon.intensity ?? 0, b.moon.intensity ?? 0);

    lerpColor(s.hemiSky, a.hemi.skyColor, b.hemi.skyColor, t);
    lerpColor(s.hemiGround, a.hemi.groundColor, b.hemi.groundColor, t);
    this.hemi.color.copy(s.hemiSky);
    this.hemi.groundColor.copy(s.hemiGround);
    this.hemi.intensity = lerpNum(a.hemi.intensity, b.hemi.intensity) * (this.weatherHemiScale ?? 1);

    lerpColor(s.ambient, a.ambient.color, b.ambient.color, t);
    this.ambient.color.copy(s.ambient);
    this.ambient.intensity = lerpNum(a.ambient.intensity, b.ambient.intensity);
    this.fill.intensity = lerpNum(0.05, 0.42, clamp01(elevation + 0.4)) * (this.weatherHemiScale ?? 1);
    this.fill.color.set(this.weatherFillColor || 0xdfe9ff);

    lerpColor(s.zenith, a.sky.zenith, b.sky.zenith, t);
    lerpColor(s.horizon, a.sky.horizon, b.sky.horizon, t);
    lerpColor(s.ground, a.sky.ground, b.sky.ground, t);
    lerpColor(s.fog, a.fog.color, b.fog.color, t);

    const night = lerpNum(a.night, b.night);
    this._nightFactor = night;
    const lampThreshold = this.lightingConfig.streetLights?.onThreshold ?? 0.12;
    const wasOn = this._streetOn;
    this._streetOn = night > lampThreshold;
    if (wasOn !== this._streetOn) this.bus.emit('lighting:streetLights', { on: this._streetOn });

    // Emissive materials: interior windows, lamps, vehicle lights.
    this.kits.setNightFactor(smoothstep(clamp01(night * 1.15)), this._streetOn);

    for (const lamp of this.workLamps) {
      const target = lamp.baseIntensity * (this._streetOn ? clamp01(night * 1.4) : 0);
      lamp.light.intensity = damp(lamp.light.intensity, target, 4, 0.5);
      lamp.light.visible = lamp.light.intensity > 0.05;
    }

    this.scene.setAtmosphere({
      zenith: s.zenith,
      horizon: s.horizon,
      ground: s.ground,
      sunDir,
      sunColor: s.sunColor,
      sunIntensity: clamp01(elevation * 2 + 0.25),
      haze: lerpNum(a.haze, b.haze),
      fogColor: s.fog,
      fogNear: (this.weatherFogNear ?? 60) * lerp(1, a.fog.near / 100, 0.2),
      fogFar: (this.weatherFogFar ?? 240) * lerp(1, a.fog.far / 240, 0.2),
      environmentIntensity: lerp(0.25, 0.95, clamp01(elevation * 1.6 + 0.3)) * (this.weatherEnvScale ?? 1),
    });

    const exposure = lerpNum(a.exposure, b.exposure) * (this.weatherExposure ?? 1);
    this.exposure = exposure;
    if (this.renderer) this.renderer.toneMappingExposure = exposure;
  }

  /** WeatherSystem injects its multipliers here before apply(). */
  setWeatherResponse({ sunScale = 1, hemiScale = 1, fogNear = null, fogFar = null, exposure = 1, envScale = 1, fillColor = null }) {
    this.weatherSunScale = sunScale;
    this.weatherHemiScale = hemiScale;
    this.weatherEnvScale = envScale;
    this.weatherExposure = exposure;
    this.weatherFillColor = fillColor;
    if (fogNear !== null) this.weatherFogNear = fogNear;
    if (fogFar !== null) this.weatherFogFar = fogFar;
  }

  update(dt) {
    this.apply(false);
    // The dome must be re-centred on the camera every frame, otherwise the view
    // shows the dome's "ground" hemisphere and the whole frame goes muddy brown.
    if (this._cameraPos) this.scene.syncSky(this._cameraPos);
  }

  setCameraPosition(position) {
    this._cameraPos = position;
  }
}
