import THREE from '../lib/three.js';
import { StateMachine } from '../lib/fsm.js';
import { VEHICLE_PROFILES, createVehicleModel } from './vehicles/VehicleModel.js';
import { angleDamp, clamp, damp, lerp, smoothstep, wrapAngle } from '../lib/mathx.js';

const _p = new THREE.Vector3();
const _t = new THREE.Vector3();

/** Stops are specified along the route as t in [0,1) plus an optional duration. */
function normalizeStops(stops) {
  return (stops || [])
    .map((stop) => ({ t: ((stop.t % 1) + 1) % 1, duration: stop.duration || 6, task: stop.task || 'wait' }))
    .sort((a, b) => a.t - b.t);
}

/**
 * RouteFollower - arc-length locomotion along a closed CatmullRom path with
 * stop scheduling. Vehicles never leave the road graph; wheels, body roll and
 * cabin pitch are all derived from the real path geometry.
 */
export class RouteFollower {
  constructor({ curve, stops = [], direction = 1, speed = 4, startT = 0, loop = true }) {
    this.curve = curve;
    this.length = curve.getLength();
    this.direction = direction >= 0 ? 1 : -1;
    this.stops = normalizeStops(stops);
    this.baseSpeed = speed;
    this.loop = loop;
    this.s = ((startT % 1) + 1) % 1 * this.length;
    this.speed = speed;
    this.acceleration = 3.2;
    this.brakeDistance = 7.5;
    this.nextStopIndex = this._findNextStopIndex();
    this.stopTimer = 0;
    this.holding = false;
    this.completedStops = 0;
    this.curveY = 1.06;
  }

  get t() {
    return ((this.s / this.length) % 1 + 1) % 1;
  }

  _findNextStopIndex() {
    if (!this.stops.length) return -1;
    const t = this.t;
    let best = -1;
    let bestDelta = Infinity;
    for (let i = 0; i < this.stops.length; i++) {
      let delta = (this.stops[i].t - t + 1) % 1;
      if (delta < 1e-4) delta += 1;
      if (delta < bestDelta) {
        bestDelta = delta;
        best = i;
      }
    }
    return best;
  }

  distanceToNextStop() {
    if (this.nextStopIndex < 0) return Infinity;
    const stop = this.stops[this.nextStopIndex];
    let delta = (stop.t - this.t + 1) % 1;
    if (delta < 1e-4) delta += 1;
    return delta * this.length;
  }

  atStop() {
    return this.holding;
  }

  update(dt) {
    if (this.holding) {
      this.stopTimer -= dt;
      this.speed = damp(this.speed, 0, 8, dt);
      if (this.stopTimer <= 0) {
        this.holding = false;
        this.nextStopIndex = this._findNextStopIndex();
      }
      return { state: 'working', speed: this.speed };
    }

    const next = this.stops[this.nextStopIndex];
    let targetSpeed = this.baseSpeed;
    if (next) {
      const distance = this.distanceToNextStop();
      if (distance < 0.6) {
        this.holding = true;
        this.stopTimer = next.duration;
        this.completedStops++;
        return { state: 'arrived', stop: next, speed: 0 };
      }
      if (distance < this.brakeDistance) {
        targetSpeed = lerp(0.8, this.baseSpeed, smoothstep(clamp(distance / this.brakeDistance, 0, 1)));
      }
    }
    this.speed = damp(this.speed, targetSpeed, this.acceleration, dt);
    this.s = (this.s + this.speed * dt * this.direction + this.length) % this.length;
    return { state: 'driving', speed: this.speed };
  }

  sample(target = _p) {
    const t = this.t;
    const point = this.curve.getPointAt(t, target);
    point.y = this.curveY;
    return point;
  }

  tangent(target = _t) {
    const t = this.t;
    this.curve.getTangentAt(t, target);
    target.multiplyScalar(this.direction);
    return target;
  }

  /** Yaw for a +Z-forward model. */
  yaw() {
    const tangent = this.tangent();
    return Math.atan2(tangent.x, tangent.z);
  }
}

/**
 * VehicleEntity - driving, working and idle states over a RouteFollower.
 * Each vehicle type animates its own mechanism (drum, bed, forks, boom, hook).
 */
export class VehicleEntity {
  constructor(spec, ctx) {
    this.id = spec.id;
    this.type = 'vehicle';
    this.spec = spec;
    this.manager = ctx.manager;
    this.bus = ctx.bus;
    this.kits = ctx.kits;
    this.lightRig = ctx.lightRig;
    this.kind = spec.kind || 'pickup';
    this.profile = VEHICLE_PROFILES[this.kind] || VEHICLE_PROFILES.pickup;
    this.role = spec.cargo || this.kind;

    this.object3d = new THREE.Group();
    this.object3d.name = this.id;
    this.body = new THREE.Group();
    this.object3d.add(this.body);

    this.model = createVehicleModel(this.kind, this.kits);
    const mesh = new THREE.Mesh(this.model.geometry, this.kits.get(this.kind === 'pickup' ? 'paint' : 'metal'));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.body.add(mesh);
    this.mesh = mesh;

    this.wheels = [];
    for (const wheel of this.model.wheels) {
      const group = new THREE.Group();
      group.position.copy(wheel.group.position);
      const wheelMesh = new THREE.Mesh(this.model.wheelGeometry, this.kits.get('rubber'));
      wheelMesh.castShadow = true;
      group.add(wheelMesh);
      this.object3d.add(group);
      this.wheels.push({ group, mesh: wheelMesh, radius: wheel.radius, spin: 0, index: this.wheels.length });
    }
    this.steerAxleCount = this.kind === 'forklift' ? 0 : 1;

    this.parts = {};
    for (const [name, object] of Object.entries(this.model.parts || {})) {
      this.body.add(object);
      this.parts[name] = object;
    }

    this.route = this._resolveRoute(spec, ctx);
    this.follower = new RouteFollower({
      curve: this.route.curve,
      stops: spec.stops || [],
      direction: spec.direction === undefined ? 1 : spec.direction,
      speed: spec.speed || this.profile.speed,
      startT: spec.startT || 0,
      loop: true,
    });
    if (this.route.offset) {
      // Lane offset: shift the whole vehicle sideways in world space each frame.
      this.laneOffset = this.route.offset;
    } else {
      this.laneOffset = 0;
    }

    this.pitch = 0;
    this.roll = 0;
    this.lastSpeed = 0;
    this.workTime = 0;
    this.drumSpin = 0;
    this.hookPhase = 0;
    this.beacon = null;
    this._buildLights();
    this.fsm = new StateMachine(this, this.states(), 'DRIVE', ctx);
    this._placed = false;
    this.updateTransform(0.016);
  }

  _resolveRoute(spec, ctx) {
    const routes = ctx.routes || {};
    const route = routes[spec.route];
    if (!route) throw new Error(`VehicleEntity ${this.id}: unknown route "${spec.route}"`);
    return route;
  }

  _buildLights() {
    if (!this.lightRig) return;
    const lights = this.model.lights || {};
    const make = (offset, color, size, pulses = false) => {
      const anchor = new THREE.Object3D();
      anchor.position.copy(offset);
      this.object3d.add(anchor);
      const slot = this.lightRig.allocate(anchor, { color, size });
      if (slot) slot.pulses = pulses;
      return slot;
    };
    if (lights.head) {
      this.headLight = make(new THREE.Vector3(lights.head[0], lights.head[1], lights.head[2]), '#fff0c4', 1.5);
      this.headLight2 = make(new THREE.Vector3(-lights.head[0], lights.head[1], lights.head[2]), '#fff0c4', 1.5);
    }
    if (lights.tail) {
      this.tailLight = make(new THREE.Vector3(lights.tail[0], lights.tail[1], lights.tail[2]), '#ff5a3c', 0.7);
      this.tailLight2 = make(new THREE.Vector3(-lights.tail[0], lights.tail[1], lights.tail[2]), '#ff5a3c', 0.7);
    }
    if (lights.beacon) {
      this.beacon = make(new THREE.Vector3(lights.beacon[0], lights.beacon[1], lights.beacon[2]), '#ffb347', 0.9, true);
    }
    if (this.kind === 'mixer') {
      this.reverseBeep = 0;
    }
  }

  get label() {
    return `${this.id} · ${this.profile.label}`;
  }

  get state() {
    return this.fsm.name;
  }

  states() {
    return {
      DRIVE: {
        enter: (self) => {
          self.bus.emit('vehicle:driving', { id: self.id });
        },
        update: (self, dt, ctx) => {
          const result = self.follower.update(dt);
          if (result.state === 'arrived') {
            self.currentStop = result.stop;
            self.fsm.change('WORK');
            return;
          }
          void ctx;
        },
      },
      WORK: {
        enter: (self) => {
          self.workTime = 0;
          self.bus.emit('vehicle:arrived', { id: self.id, task: self.currentStop ? self.currentStop.task : 'wait' });
          if (self.kind === 'mixer' && self.currentStop && self.currentStop.task === 'pour') {
            self.bus.emit('site:concretePour', { id: self.id });
          }
        },
        update: (self, dt, ctx) => {
          self.workTime += dt;
          const result = self.follower.update(dt);
          void ctx;
          if (result.state === 'driving') self.fsm.change('DRIVE');
        },
      },
      IDLE: {
        update: (self, dt, ctx) => {
          void ctx;
          self.follower.update(dt);
        },
      },
    };
  }

  /** Wheel spin, steering, body roll and per-type mechanism animation. */
  updateTransform(dt) {
    const follower = this.follower;
    const sample = follower.sample(_p);
    const tangent = follower.tangent(_t);
    const yaw = Math.atan2(tangent.x, tangent.z);

    // Lane offset (keep left/right hand traffic believable).
    let offsetX = 0;
    let offsetZ = 0;
    if (this.laneOffset) {
      const rightX = Math.cos(yaw);
      const rightZ = -Math.sin(yaw);
      offsetX = rightX * this.laneOffset;
      offsetZ = rightZ * this.laneOffset;
    }

    this.object3d.position.set(sample.x + offsetX, sample.y, sample.z + offsetZ);
    this.object3d.rotation.y = yaw;

    const accel = (follower.speed - this.lastSpeed) / Math.max(dt, 1e-3);
    this.lastSpeed = follower.speed;
    const pitchTarget = clamp(-accel * 0.012, -0.07, 0.07);
    this.pitch = damp(this.pitch, pitchTarget, 4, dt);
    const turnRate = wrapAngle(yaw - (this._lastYaw === undefined ? yaw : this._lastYaw)) / Math.max(dt, 1e-3);
    this._lastYaw = yaw;
    const rollTarget = clamp(-turnRate * follower.speed * 0.012, -0.09, 0.09);
    this.roll = damp(this.roll, rollTarget, 4, dt);
    this.body.rotation.set(this.pitch, 0, this.roll);
    this.body.position.y = Math.abs(this.roll) * 0.05;

    // Wheels: spin from travelled distance, steer the front axle.
    const spin = (follower.speed * dt) / 0.5;
    for (const wheel of this.wheels) {
      wheel.spin += spin * follower.direction;
      wheel.mesh.rotation.x = wheel.spin;
      if (this.steerAxleCount && wheel.index < 2) {
        wheel.group.rotation.y = damp(wheel.group.rotation.y, clamp(turnRate * 0.12, -0.5, 0.5), 5, dt);
      }
    }
  }

  updateMechanisms(dt, elapsed) {
    switch (this.kind) {
      case 'mixer': {
        const pouring = this.state === 'WORK';
        this.drumSpin += dt * (pouring ? 0.8 : 2.2);
        if (this.parts.drum) this.parts.drum.rotation.z = this.drumSpin;
        break;
      }
      case 'tipper': {
        if (this.parts.bed) {
          const target = this.state === 'WORK' && this.currentStop && this.currentStop.task === 'tip' ? -0.7 : 0;
          this.parts.bed.rotation.x = damp(this.parts.bed.rotation.x, target, 1.4, dt);
        }
        break;
      }
      case 'forklift': {
        if (this.parts.carriage) {
          const working = this.state === 'WORK';
          const lift = working ? 1.9 : 0.15;
          this.parts.carriage.position.y = damp(this.parts.carriage.position.y, lift + 1.2, 1.5, dt);
        }
        break;
      }
      case 'excavator': {
        const digging = this.state === 'WORK';
        const cycle = digging ? (this.workTime % 6) / 6 : 0;
        const phase = digging ? Math.sin(cycle * Math.PI * 2) : 0;
        const lift = digging ? Math.max(0, Math.sin(cycle * Math.PI * 2)) : 0;
        if (this.parts.house) {
          this.parts.house.rotation.y = damp(this.parts.house.rotation.y, digging ? Math.sin(elapsed * 0.3) * 0.8 : 0, 1.2, dt);
        }
        if (this.parts.boom) this.parts.boom.rotation.x = damp(this.parts.boom.rotation.x, -0.35 - lift * 0.3, 1.6, dt);
        if (this.parts.arm) this.parts.arm.rotation.x = damp(this.parts.arm.rotation.x, 0.5 + phase * 0.6, 2.0, dt);
        if (this.parts.bucket) this.parts.bucket.rotation.x = damp(this.parts.bucket.rotation.x, -0.4 + phase * 0.7, 2.4, dt);
        break;
      }
      case 'mobileCrane': {
        const hoisting = this.state === 'WORK';
        if (this.parts.boom) {
          this.parts.boom.rotation.x = damp(this.parts.boom.rotation.x, hoisting ? -0.5 : -0.18, 1.1, dt);
        }
        if (this.parts.hook) {
          this.hookPhase += dt * (hoisting ? 0.6 : 0.15);
          const travel = hoisting ? (Math.sin(this.hookPhase) + 1) * 1.4 : 0.4;
          this.parts.hook.position.y = -0.4 - travel;
        }
        break;
      }
      default:
        break;
    }
  }

  update(dt, ctx) {
    this.fsm.update(dt);
    this.updateTransform(dt);
    this.updateMechanisms(dt, ctx && ctx.elapsed ? ctx.elapsed : 0);
    if (this.reverseBeep !== undefined) {
      const reversing = this.follower.speed > 0.2 && this.follower.direction < 0;
      if (reversing) {
        this.reverseBeep -= dt;
        if (this.reverseBeep <= 0) {
          this.reverseBeep = 1.1;
          this.bus.emit('vehicle:beep', { id: this.id });
        }
      }
    }
    if (this.state === 'WORK' && this.currentStop && this.currentStop.task === 'pour' && Math.random() < dt * 0.6) {
      this.bus.emit('site:pourTick', { id: this.id });
    }
  }

  getWorldPosition(target = _p) {
    return target.copy(this.object3d.position);
  }

  getDebugInfo() {
    return {
      id: this.id,
      kind: this.profile.label,
      state: this.state,
      speed: Number(this.follower.speed.toFixed(2)),
      route: this.spec.route,
      t: Number(this.follower.t.toFixed(3)),
      stop: this.follower.nextStopIndex,
    };
  }

  debugLabel() {
    return `${this.profile.label}·${this.state}`;
  }

  dispose() {
    for (const wheel of this.wheels) wheel.mesh.geometry.dispose();
    this.mesh.geometry.dispose();
  }
}
