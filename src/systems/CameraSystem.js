import THREE from '../lib/three.js';
import { clamp, clamp01, damp, lerp } from '../lib/mathx.js';
import { Orbit } from '../lib/orbit.js';

const TOUR_POINTS = [
  [44, 30], [36, 12], [30, -14], [10, -30], [-14, -30], [-36, -18],
  [-42, 6], [-32, 28], [-10, 34], [16, 33],
];

/**
 * CameraSystem - five presentation modes over one shared orbit rig.
 * diorama (free orbit) / autoOrbit / streetTour / follow / flyover.
 */
export class CameraSystem {
  constructor({ camera, renderer, bus, config, scene }) {
    this.camera = camera;
    this.renderer = renderer;
    this.bus = bus;
    this.config = config;
    this.sceneManager = scene;
    this.controls = new Orbit(camera, renderer ? renderer.domElement : { addEventListener() {}, removeEventListener() {}, clientHeight: 900 });
    this.mode = 'diorama';
    this.autoOrbit = { enabled: false, speed: 0.055, idleDelay: 3.0 };
    this.follow = { entityId: null, offset: new THREE.Vector3(0, 7, 12), damping: 3.4, lookHeight: 1.2 };
    this.tour = { speed: 0.018, t: 0.02, height: 2.6, sideOffset: 8.5 };
    this.flyover = { t: 0, speed: 0.02, height: 34, radius: 62 };
    this.shake = { amount: 0, time: 0 };
    this._presets = this._buildPresets();
    this._tourCurve = null;
    this._bindKeys();
    const start = this.config.world?.camera?.start;
    if (start) {
      this.controls.setPose(
        {
          target: new THREE.Vector3(start.target[0], start.target[1], start.target[2]),
          radius: start.radius,
          phi: start.phi,
          theta: start.theta,
        },
        true,
      );
    }
  }

  _buildPresets() {
    return {
      overlook: { label: '全景鸟瞰', mode: 'diorama', target: [0, 6, 0], radius: 118, phi: 0.62, theta: 0.85 },
      tower: { label: '主楼特写', mode: 'diorama', target: [0, 18, -2], radius: 58, phi: 0.95, theta: 0.35 },
      street: { label: '街道视角', mode: 'diorama', target: [0, 4, 20], radius: 40, phi: 1.32, theta: 2.15 },
      yard: { label: '材料堆场', mode: 'diorama', target: [26, 3, -6], radius: 34, phi: 1.12, theta: 2.6 },
      crane: { label: '塔吊视角', mode: 'diorama', target: [-14, 30, -14], radius: 62, phi: 0.78, theta: 0.55 },
      gate: { label: '大门入口', mode: 'diorama', target: [0, 3, 26], radius: 42, phi: 1.2, theta: 0.1 },
      tour: { label: '街道游览', mode: 'streetTour' },
      followForeman: { label: '跟随工长', mode: 'follow', entity: 'worker-01' },
      flyover: { label: '电影环绕', mode: 'flyover' },
    };
  }

  listPresets() {
    return Object.entries(this._presets).map(([id, preset]) => ({ id, label: preset.label, mode: preset.mode }));
  }

  _bindKeys() {
    if (typeof window === 'undefined') return;
    this._onKey = (event) => {
      if (event.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return;
      switch (event.code) {
        case 'Digit1': this.applyPreset('overlook'); break;
        case 'Digit2': this.applyPreset('tower'); break;
        case 'Digit3': this.applyPreset('street'); break;
        case 'Digit4': this.applyPreset('yard'); break;
        case 'Digit5': this.applyPreset('crane'); break;
        case 'Digit6': this.applyPreset('gate'); break;
        case 'Digit7': this.applyPreset('tour'); break;
        case 'Digit8': this.applyPreset('followForeman'); break;
        case 'Digit9': this.applyPreset('flyover'); break;
        case 'KeyO': this.toggleAutoOrbit(); break;
        default: break;
      }
    };
    window.addEventListener('keydown', this._onKey);
  }

  applyPreset(id, { instant = false } = {}) {
    const preset = this._presets[id];
    if (!preset) return false;
    this.mode = preset.mode;
    this.activePreset = id;
    if (preset.mode === 'diorama') {
      this.controls.enabled = true;
      this.controls.setPose(
        {
          target: new THREE.Vector3(preset.target[0], preset.target[1], preset.target[2]),
          radius: preset.radius,
          phi: preset.phi,
          theta: preset.theta,
        },
        instant,
      );
    } else if (preset.mode === 'follow') {
      this.setFollowTarget(preset.entity || 'worker-01');
    } else if (preset.mode === 'streetTour') {
      this.controls.enabled = false;
      if (this.tour.t > 0.5) this.tour.t = 0;
    } else if (preset.mode === 'flyover') {
      this.controls.enabled = false;
    }
    this.bus.emit('camera:mode', { mode: this.mode, preset: id, label: preset.label });
    return true;
  }

  setMode(mode, options = {}) {
    if (!['diorama', 'autoOrbit', 'streetTour', 'follow', 'flyover'].includes(mode)) return false;
    this.mode = mode;
    this.controls.enabled = mode === 'diorama' || mode === 'autoOrbit' || mode === 'follow';
    if (mode === 'follow' && options.entityId) this.setFollowTarget(options.entityId);
    if (mode === 'streetTour') this.tour.t = options.t ?? this.tour.t;
    if (mode === 'flyover') this.flyover.t = options.t ?? 0;
    this.bus.emit('camera:mode', { mode, preset: null, label: mode });
    return true;
  }

  setFollowTarget(entityId) {
    this.mode = 'follow';
    this.follow.entityId = entityId;
    this.controls.enabled = true;
    this.bus.emit('camera:follow', { entityId });
    return true;
  }

  toggleAutoOrbit(force = null) {
    this.autoOrbit.enabled = force === null ? !this.autoOrbit.enabled : Boolean(force);
    if (this.autoOrbit.enabled && this.mode !== 'follow') this.setMode('autoOrbit');
    else if (!this.autoOrbit.enabled && this.mode === 'autoOrbit') this.setMode('diorama');
    this.bus.emit('camera:autoOrbit', { enabled: this.autoOrbit.enabled });
    return this.autoOrbit.enabled;
  }

  setAutoOrbitSpeed(speed) {
    this.autoOrbit.speed = clamp(speed, 0.005, 0.4);
  }

  get tourCurve() {
    if (!this._tourCurve) {
      const points = TOUR_POINTS.map((p) => new THREE.Vector3(p[0], 1.6, p[1]));
      this._tourCurve = new THREE.CatmullRomCurve3(points, true, 'catmullrom', 0.5);
      this._tourCurve.arcLengthDivisions = 400;
    }
    return this._tourCurve;
  }

  addShake(amount, duration = 0.4) {
    this.shake.amount = Math.max(this.shake.amount, amount);
    this.shake.time = Math.max(this.shake.time, duration);
  }

  /** Entity follow needs the resolved position; WorldSystem supplies a resolver. */
  setEntityResolver(resolver) {
    this._resolveEntity = resolver;
  }

  update(dt, ctx) {
    const camera = this.camera;
    const entities = ctx && ctx.entities;
    switch (this.mode) {
      case 'diorama': {
        this.controls.enabled = true;
        if (this.controls.idleTime > this.autoOrbit.idleDelay && this.autoOrbit.enabled) {
          this.controls.sphericalTarget.theta += this.autoOrbit.speed * dt;
        }
        this.controls.update(dt);
        break;
      }
      case 'autoOrbit': {
        this.controls.enabled = true;
        this.controls.sphericalTarget.theta += this.autoOrbit.speed * dt;
        this.controls.update(dt);
        break;
      }
      case 'follow': {
        this.controls.enabled = true;
        const entity = this._resolveEntity ? this._resolveEntity(this.follow.entityId, entities) : null;
        if (entity) {
          const position = entity.getWorldPosition
            ? entity.getWorldPosition(this._tmpTarget || (this._tmpTarget = new THREE.Vector3()))
            : entity.object3d.position;
          this.controls.target.x = damp(this.controls.target.x, position.x, this.follow.damping, dt);
          this.controls.target.y = damp(this.controls.target.y, position.y + this.follow.lookHeight, this.follow.damping, dt);
          this.controls.target.z = damp(this.controls.target.z, position.z, this.follow.damping, dt);
        }
        this.controls.update(dt);
        break;
      }
      case 'streetTour': {
        this.tour.t = (this.tour.t + this.tour.speed * dt) % 1;
        const curve = this.tourCurve;
        const point = curve.getPointAt(this.tour.t, this._tourPoint || (this._tourPoint = new THREE.Vector3()));
        const ahead = curve.getPointAt((this.tour.t + 0.012) % 1, this._tourAhead || (this._tourAhead = new THREE.Vector3()));
        const right = this._tourRight || (this._tourRight = new THREE.Vector3());
        right.subVectors(ahead, point).setY(0).normalize().cross(new THREE.Vector3(0, 1, 0)).multiplyScalar(this.tour.sideOffset);
        camera.position.set(point.x + right.x, this.tour.height, point.z + right.z);
        const look = this._tourLook || (this._tourLook = new THREE.Vector3());
        look.set(point.x - right.x * 0.6, 3.2, point.z - right.z * 0.6);
        camera.lookAt(look);
        this.controls.target.copy(look);
        this.controls.spherical.setFromVector3(
          this._tmpOffset || (this._tmpOffset = new THREE.Vector3()).copy(camera.position).sub(this.controls.target),
        );
        this.controls.sphericalTarget.copy(this.controls.spherical);
        break;
      }
      case 'flyover': {
        this.flyover.t = (this.flyover.t + this.flyover.speed * dt) % 1;
        const angle = this.flyover.t * Math.PI * 2;
        const radius = this.flyover.radius * (0.82 + 0.18 * Math.sin(angle * 1.7));
        camera.position.set(
          Math.cos(angle) * radius,
          this.flyover.height + Math.sin(angle * 2.2) * 5,
          Math.sin(angle) * radius,
        );
        const look = this._flyLook || (this._flyLook = new THREE.Vector3());
        look.set(Math.sin(angle * 0.5) * 8, 12 + Math.sin(angle) * 4, Math.cos(angle * 0.5) * 6);
        camera.lookAt(look);
        this.controls.target.copy(look);
        this.controls.spherical.setFromVector3(
          this._tmpOffset2 || (this._tmpOffset2 = new THREE.Vector3()).copy(camera.position).sub(this.controls.target),
        );
        this.controls.sphericalTarget.copy(this.controls.spherical);
        break;
      }
      default:
        break;
    }

    if (this.shake.time > 0) {
      this.shake.time -= dt;
      const amount = this.shake.amount * clamp01(this.shake.time / 0.4);
      camera.position.x += (Math.random() - 0.5) * amount;
      camera.position.y += (Math.random() - 0.5) * amount;
      camera.position.z += (Math.random() - 0.5) * amount;
      if (this.shake.time <= 0) this.shake.amount = 0;
    }
  }

  getInfo() {
    return {
      mode: this.mode,
      autoOrbit: this.autoOrbit.enabled,
      preset: this.activePreset || null,
      follow: this.follow.entityId,
      distance: this.controls.spherical.radius,
      target: this.controls.target.toArray().map((v) => Number(v.toFixed(1))),
    };
  }

  dispose() {
    if (typeof window !== 'undefined' && this._onKey) window.removeEventListener('keydown', this._onKey);
    this.controls.dispose();
  }
}

export const CAMERA_MODES = ['diorama', 'autoOrbit', 'streetTour', 'follow', 'flyover'];
export const _lerp = lerp;
