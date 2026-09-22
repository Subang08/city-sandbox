import THREE from '../lib/three.js';
import { clamp01, damp, lerp } from '../lib/mathx.js';
import { Rng } from '../lib/rng.js';

const RAIN_VERT = /* glsl */ `
varying float vFade;
void main() {
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  vFade = 1.0;
  gl_Position = projectionMatrix * mv;
}
`;

/**
 * WeatherSystem - five presets with smooth transitions, GPU-cheap precipitation
 * (two InstancedMesh fields), wet ground, puddles, snow cover and wind.
 */
export class WeatherSystem {
  constructor({ scene, bus, kits, config, presets, rng }) {
    this.scene = scene;
    this.bus = bus;
    this.kits = kits;
    this.config = config;
    this.presets = presets;
    this.rng = rng || new Rng('weather');
    this.current = config.weather?.default || 'clear';
    this.from = this.presets[this.current];
    this.to = this.presets[this.current];
    this.blend = 1;
    this.transitionDuration = presets.transitions?.durationSeconds || 6;
    this.state = this._instantiate(this.current);
    this.wetness = this.to.wetness ?? 0;
    this.snowCover = this.to.snowCover ?? 0;
    this.time = 0;
    this.windVector = new THREE.Vector3();
    this._rainCursor = 0;
    this._snowCursor = 0;
    this.enabled = config.weather?.presets ? true : true;
    this._buildRain(5200);
    this._buildSnow(4200);
    this._buildGround();
    this.set(this.current, { instant: true });
  }

  _instantiate(name) {
    const preset = this.presets[name];
    if (!preset) throw new Error(`WeatherSystem: unknown preset "${name}"`);
    return JSON.parse(JSON.stringify(preset));
  }

  _buildRain(count) {
    const geometry = new THREE.BoxGeometry(0.035, 0.7, 0.035);
    const material = new THREE.MeshBasicMaterial({
      color: 0xa8c4d8,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      fog: true,
    });
    this.rain = new THREE.InstancedMesh(geometry, material, count);
    this.rain.name = 'rainField';
    this.rain.frustumCulled = false;
    this.rain.castShadow = false;
    this.rain.receiveShadow = false;
    this.rain.count = 0;
    this.rain.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.rain, { dynamic: true });
    this.rainCount = count;
    const { position, velocity } = this._makeField(count);
    this.rainData = { position, velocity };
    this._rainMaterial = material;
    this._rainShader = RAIN_VERT;
  }

  _buildSnow(count) {
    const geometry = new THREE.BoxGeometry(0.085, 0.085, 0.085);
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      fog: true,
    });
    this.snow = new THREE.InstancedMesh(geometry, material, count);
    this.snow.name = 'snowField';
    this.snow.frustumCulled = false;
    this.snow.castShadow = false;
    this.snow.count = 0;
    this.snow.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.snow, { dynamic: true });
    this.snowCount = count;
    const { position, velocity } = this._makeField(count);
    this.snowData = { position, velocity };
    this._snowMaterial = material;
  }

  _makeField(count) {
    const position = new Float32Array(count * 3);
    const velocity = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      position[i * 3] = this.rng.range(-this.field.x / 2, this.field.x / 2);
      position[i * 3 + 1] = this.rng.range(0, this.field.y);
      position[i * 3 + 2] = this.rng.range(-this.field.z / 2, this.field.z / 2);
      velocity[i * 3] = this.rng.range(-0.4, 0.4);
      velocity[i * 3 + 1] = -this.rng.range(6, 11);
      velocity[i * 3 + 2] = this.rng.range(-0.4, 0.4);
    }
    return { position, velocity };
  }

  get field() {
    return { x: 78, y: 44, z: 78 };
  }

  _buildGround() {
    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.rotateX(-Math.PI / 2);
    const material = this.kits.get('snow');
    material.opacity = 0;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'snowCover';
    mesh.scale.set(112, 1, 90);
    mesh.position.set(0, 0.02, 0);
    mesh.receiveShadow = false;
    mesh.castShadow = false;
    mesh.renderOrder = 1;
    this.scene.add(mesh, { dynamic: true });
    this.snowCoverMesh = mesh;

    const puddleGeometry = new THREE.CircleGeometry(1, 14);
    puddleGeometry.rotateX(-Math.PI / 2);
    const puddleMaterial = this.kits.get('water');
    puddleMaterial.opacity = 0;
    this.puddles = new THREE.InstancedMesh(puddleGeometry, puddleMaterial, 14);
    this.puddles.name = 'puddles';
    this.puddles.castShadow = false;
    this.puddles.receiveShadow = false;
    this.puddles.frustumCulled = false;
    const matrix = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const spots = [
      [-30, 20], [-12, 26], [8, 24], [26, 18], [34, 2], [30, -18],
      [12, -26], [-8, -24], [-26, -16], [-33, -2], [-18, 6], [18, 10],
      [6, -8], [-6, 14],
    ];
    spots.forEach((spot, index) => {
      quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.rng.range(0, Math.PI));
      const s = this.rng.range(1.6, 4.2);
      matrix.compose(
        new THREE.Vector3(spot[0], 0.035, spot[1]),
        quat,
        new THREE.Vector3(s, 1, s * this.rng.range(0.6, 1.1)),
      );
      this.puddles.setMatrixAt(index, matrix);
    });
    this.puddles.instanceMatrix.needsUpdate = true;
    this._puddleMaterial = puddleMaterial;
    this.scene.add(this.puddles, { dynamic: true });
  }

  set(name, { instant = false, duration = null } = {}) {
    if (!this.presets[name]) return;
    if (name === this.current && this.blend >= 1) return;
    this.from = this._instantiate(this.current);
    this.to = this._instantiate(name);
    this.fromWetness = this.wetness;
    this.fromSnow = this.snowCover;
    this.current = name;
    this.blend = instant ? 1 : 0;
    this.transitionDuration = duration || this.presets.transitions?.durationSeconds || 6;
    if (instant) this.state = this._instantiate(name);
    this.bus.emit('weather:changed', { name, preset: this.presets[name], instant });
  }

  cycleNext(direction = 1) {
    const list = this.config.weather?.presets || Object.keys(this.presets);
    const index = list.indexOf(this.current);
    const next = list[(index + direction + list.length) % list.length];
    this.set(next);
    return next;
  }

  _mix(key, sub = null) {
    const a = this.from;
    const b = this.to;
    if (sub) {
      const av = a[key]?.[sub] ?? 0;
      const bv = b[key]?.[sub] ?? 0;
      return lerp(av, bv, this.blend);
    }
    const av = a[key] ?? 0;
    const bv = b[key] ?? 0;
    return typeof av === 'number' ? lerp(av, bv, this.blend) : bv;
  }

  update(dt, camera) {
    this.time += dt;
    if (this.blend < 1) this.blend = clamp01(this.blend + dt / this.transitionDuration);

    const precipitation = this.blend > 0.5 ? this.to.precipitation : this.from.precipitation;
    const intensity = this.blend > 0.5 ? this.blend : 1 - this.blend;
    const rainAmount = precipitation === 'rain' ? intensity : 0;
    const snowAmount = precipitation === 'snow' ? intensity : 0;

    // Stateful ground response: rain wets the site, sun dries it, snow accumulates.
    const targetWet = precipitation === 'rain' ? 1 : this.to.wetness ?? 0;
    const targetSnow = precipitation === 'snow' ? 1 : this.to.snowCover ?? 0;
    const dryRate = this.presets.transitions?.wetnessDryRate ?? 0.08;
    const meltRate = this.presets.transitions?.snowMeltRate ?? 0.05;
    this.wetness = targetWet > this.wetness ? damp(this.wetness, targetWet, 0.5, dt) : Math.max(targetWet, this.wetness - dryRate * dt);
    this.snowCover = targetSnow > this.snowCover ? damp(this.snowCover, targetSnow, 0.25, dt) : Math.max(targetSnow, this.snowCover - meltRate * dt);

    this.kits.setWetness(this.wetness);
    this._puddleMaterial.opacity = 0.82 * clamp01(this.wetness * (this.to.puddle ?? 1));
    this.snowCoverMesh.material.opacity = 0.88 * clamp01(this.snowCover);
    this.snowCoverMesh.visible = this.snowCover > 0.01;

    const windSpeed = this._mix('wind', 'speed');
    const gust = this._mix('wind', 'gust');
    const windDir = this._mix('wind', 'direction');
    const gustWave = 0.5 + 0.5 * Math.sin(this.time * 0.35) * Math.sin(this.time * 0.13 + 1.7);
    const effectiveWind = windSpeed + gust * gustWave;
    this.windVector.set(Math.cos(windDir) * effectiveWind, 0, Math.sin(windDir) * effectiveWind);
    this.windSpeed = effectiveWind;

    this._updateRain(dt, camera, rainAmount);
    this._updateSnow(dt, camera, snowAmount);

    const fogNear = this._mix('fog', 'near');
    const fogFar = this._mix('fog', 'far');
    const sunScale = this._mix('sun', 'intensity') / 3.1;
    const hemiScale = clamp01(this._mix('hemi', 'intensity'));
    const exposure = this._mix('exposure');
    const envScale = lerp(1.0, 0.55, clamp01(this._mix('clouds')));

    this.bus.emit('weather:state', {
      name: this.current,
      rainAmount,
      snowAmount,
      windSpeed: effectiveWind,
      windDirection: windDir,
      wetness: this.wetness,
      snowCover: this.snowCover,
      fogNear,
      fogFar,
    });

    return {
      fogNear,
      fogFar,
      sunScale,
      hemiScale,
      exposure,
      envScale,
      fillColor: precipitation === 'rain' || precipitation === 'snow' ? 0xc9d6e2 : null,
    };
  }

  /** World-space field wrapping: keeps precipitation around the active camera. */
  _anchor(cameraPos) {
    const half = { x: this.field.x / 2, y: this.field.y, z: this.field.z / 2 };
    this.fieldOrigin = this.fieldOrigin || new THREE.Vector3();
    this.fieldOrigin.set(Math.round(cameraPos.x / 8) * 8, 0, Math.round(cameraPos.z / 8) * 8);
    return { half };
  }

  _updateRain(dt, camera, amount) {
    const active = Math.round(this.rainCount * clamp01(amount));
    this.rain.count = active;
    this._rainMaterial.opacity = 0.28 + 0.3 * clamp01(amount);
    if (!active) return;
    if (!camera) return;
    const { position, velocity } = this.rainData;
    const matrix = this._m || (this._m = new THREE.Matrix4());
    const quat = this._q || (this._q = new THREE.Quaternion());
    const pos = this._p || (this._p = new THREE.Vector3());
    const scl = this._s || (this._s = new THREE.Vector3(1, 1, 1));
    const halfX = this.field.x / 2;
    const halfZ = this.field.z / 2;
    const originX = Math.round(camera.position.x / 10) * 10;
    const originZ = Math.round(camera.position.z / 10) * 10;
    const wind = this.windVector;
    const tilt = Math.atan2(wind.x, 9) * 0.8;
    quat.setFromAxisAngle(this._axisZ || (this._axisZ = new THREE.Vector3(0, 0, 1)), -tilt);

    for (let i = 0; i < active; i++) {
      const i3 = i * 3;
      position[i3] += (velocity[i3] + wind.x) * dt;
      position[i3 + 1] += velocity[i3 + 1] * dt;
      position[i3 + 2] += (velocity[i3 + 2] + wind.z) * dt;
      if (position[i3 + 1] < 0) {
        position[i3 + 1] += this.field.y;
        position[i3] = this.rng.range(-halfX, halfX);
        position[i3 + 2] = this.rng.range(-halfZ, halfZ);
      }
      pos.set(
        originX + ((((position[i3] + halfX) % this.field.x) + this.field.x) % this.field.x) - halfX,
        position[i3 + 1],
        originZ + ((((position[i3 + 2] + halfZ) % this.field.z) + this.field.z) % this.field.z) - halfZ,
      );
      scl.set(1, 1 + amount * 0.6, 1);
      matrix.compose(pos, quat, scl);
      this.rain.setMatrixAt(i, matrix);
    }
    this.rain.instanceMatrix.needsUpdate = true;
  }

  _updateSnow(dt, camera, amount) {
    const active = Math.round(this.snowCount * clamp01(amount));
    this.snow.count = active;
    this._snowMaterial.opacity = 0.75 + 0.2 * clamp01(amount);
    if (!active || !camera) return;
    const { position, velocity } = this.snowData;
    const matrix = this._m2 || (this._m2 = new THREE.Matrix4());
    const quat = this._q2 || (this._q2 = new THREE.Quaternion());
    const pos = this._p2 || (this._p2 = new THREE.Vector3());
    const scl = this._s2 || (this._s2 = new THREE.Vector3(1, 1, 1));
    const euler = this._e2 || (this._e2 = new THREE.Euler());
    const halfX = this.field.x / 2;
    const halfZ = this.field.z / 2;
    const originX = Math.round(camera.position.x / 10) * 10;
    const originZ = Math.round(camera.position.z / 10) * 10;
    const wind = this.windVector;
    for (let i = 0; i < active; i++) {
      const i3 = i * 3;
      const flutter = Math.sin(this.time * 2.2 + i * 0.7) * 0.6;
      position[i3] += (velocity[i3] * 0.35 + wind.x * 0.55 + flutter) * dt;
      position[i3 + 1] += (velocity[i3 + 1] * 0.28 - 1.1) * dt;
      position[i3 + 2] += (velocity[i3 + 2] * 0.35 + wind.z * 0.55) * dt;
      if (position[i3 + 1] < 0) {
        position[i3 + 1] += this.field.y;
        position[i3] = this.rng.range(-halfX, halfX);
        position[i3 + 2] = this.rng.range(-halfZ, halfZ);
      }
      pos.set(
        originX + ((((position[i3] + halfX) % this.field.x) + this.field.x) % this.field.x) - halfX,
        position[i3 + 1],
        originZ + ((((position[i3 + 2] + halfZ) % this.field.z) + this.field.z) % this.field.z) - halfZ,
      );
      euler.set(this.time * 1.4 + i, this.time * 1.1 + i * 0.3, 0);
      quat.setFromEuler(euler);
      scl.setScalar(0.7 + (i % 5) * 0.12);
      matrix.compose(pos, quat, scl);
      this.snow.setMatrixAt(i, matrix);
    }
    this.snow.instanceMatrix.needsUpdate = true;
  }
}
