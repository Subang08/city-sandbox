import THREE from '../lib/three.js';
import { StateMachine } from '../lib/fsm.js';
import { createCraneModel, createCraneLoad } from './cranes/CraneModel.js';
import { angleDamp, clamp, clamp01, damp, lerp, wrapAngle } from '../lib/mathx.js';

const _local = new THREE.Vector3();
const _world = new THREE.Vector3();
const _hookWorld = new THREE.Vector3();

/**
 * CraneEntity - a full tower crane work cycle:
 *   HOME -> LOWER hook to the material -> HOOK load -> LIFT -> SLEW to target
 *   -> TROLLEY out -> LOWER -> RELEASE -> RETURN -> HOME
 * The ropes are real scaled geometry, the hook has damped inertia and the
 * slewing unit accelerates/decelerates like a real machine.
 */
export class CraneEntity {
  constructor(spec, ctx) {
    this.id = spec.id;
    this.type = 'crane';
    this.spec = spec;
    this.manager = ctx.manager;
    this.bus = ctx.bus;
    this.kits = ctx.kits;
    this.lightRig = ctx.lightRig;
    this.construction = ctx.construction;
    this.sites = ctx.sites || {};
    this.loadKinds = ctx.loadKinds || ['rebar', 'concrete', 'pallet', 'pipes'];

    this.object3d = new THREE.Group();
    this.object3d.name = this.id;
    this.object3d.position.set(spec.position[0], 1.06, spec.position[2] !== undefined ? spec.position[2] : spec.position[1]);

    this.model = createCraneModel(spec, this.kits);
    this.object3d.add(this.model.root);

    this.mastTop = this.model.mastTop;
    this.jibLength = this.model.jibLength;
    this.baseHeight = this.model.baseHeight;

    this.slew = spec.restSlew !== undefined ? spec.restSlew : 0.8;
    this.slewTarget = this.slew;
    this.slewSpeed = 0.5;
    this.trolley = (spec.restTrolley !== undefined ? spec.restTrolley : 0.4) * this.jibLength;
    this.trolleyTarget = this.trolley;
    this.hookY = this.mastTop - 8;
    this.hookTarget = this.hookY;
    this.hookVelocity = 0;

    this.currentLoad = null;
    this.loadKind = null;
    this.loadMass = 0;
    this.stationIndex = 0;
    this.cycleCount = 0;
    this.beacon = null;
    this._buildLights();

    // Stations come from the world (pickup yards + building drop points).
    this.stations = this._buildStations(ctx);
    this.fsm = new StateMachine(this, this.states(), 'HOME', ctx);
    this.updateRopes();
    this.updateTransform(0.016);
  }

  _buildLights() {
    if (!this.lightRig) return;
    const anchor = new THREE.Object3D();
    anchor.position.set(0, this.mastTop + 0.6, 0);
    this.object3d.add(anchor);
    const slot = this.lightRig.allocate(anchor, { color: '#ff5a3c', size: 1.1 });
    if (slot) slot.pulses = true;
    this.beacon = slot;
  }

  _buildStations(ctx) {
    const stations = [];
    const yards = ctx.yards || {};
    const building = ctx.mainBuilding;
    // Pickup stations: material yards around the site.
    for (const [key, yard] of Object.entries(yards)) {
      if (!yard) continue;
      stations.push({
        id: `pickup-${key}`,
        kind: 'pickup',
        position: new THREE.Vector3(yard[0], 2.6, yard[1]),
        load: yard.load || 'pallet',
      });
    }
    // Drop stations: the tower's active floors.
    if (building) {
      this.building = building;
    }
    return stations;
  }

  /** Refresh deliverable floors from the current construction state. */
  refreshStations() {
    if (!this.building) return;
    const state = this.building.state;
    this.deliverFloors = [];
    if (!state) return;
    const top = Math.max(1, state.activeFloor);
    for (let floor = Math.max(0, top - 3); floor <= top; floor++) {
      if (floor > this.building.spec.floors.target) continue;
      this.deliverFloors.push(floor);
    }
  }

  get label() {
    return `${this.id} · 塔吊`;
  }

  get state() {
    return this.fsm.name;
  }

  /** World-space position of a crane-local point (respects slew + trolley). */
  localToWorld(local, target = _world) {
    _local.copy(local);
    this.model.slewGroup.localToWorld(_local);
    return target.copy(_local);
  }

  /** Aim the jib at a world XZ position and return the resulting trolley radius. */
  aimAt(worldPosition) {
    const dx = worldPosition.x - this.object3d.position.x;
    const dz = worldPosition.z - this.object3d.position.z;
    const desired = Math.atan2(dx, dz);
    this.slewTarget = desired;
    const distance = Math.hypot(dx, dz);
    this.trolleyTarget = clamp(distance, 3.5, this.jibLength);
    return distance;
  }

  hookWorldPosition(target = _hookWorld) {
    this.model.hookBlock.updateWorldMatrix(true, false);
    return target.setFromMatrixPosition(this.model.hookBlock.matrixWorld);
  }

  states() {
    return {
      HOME: {
        enter: (self) => {
          self.refreshStations();
        },
        update: (self, dt, ctx) => {
          self.slewTarget = self.spec.restSlew !== undefined ? self.spec.restSlew : self.slew;
          self.trolleyTarget = (self.spec.restTrolley !== undefined ? self.spec.restTrolley : 0.4) * self.jibLength;
          self.hookTarget = self.mastTop - 6;
          void ctx;
          if (self.readyToWork(dt)) self.fsm.change('PICK');
        },
      },

      PICK: {
        enter: (self) => {
          self.refreshStations();
          const station = self.stations[self.stationIndex % Math.max(1, self.stations.length)] || null;
          self.target = station;
          if (!self.target) {
            self.fsm.change('HOME');
            return;
          }
          self.loadKind = self.target.load || self.loadKinds[self.cycleCount % self.loadKinds.length];
          self.aimAt(self.target.position);
          self.hookTarget = self.target.position.y + 1.1;
          self.bus.emit('crane:cycle', { id: self.id, phase: 'pick', load: self.loadKind });
        },
        update: (self, dt, ctx) => {
          if (self.slewSettled() && self.hookSettled(0.35)) {
            if (!self.currentLoad) {
              self.currentLoad = createCraneLoad(self.loadKind, self.kits);
              self.model.payloadAnchor.add(self.currentLoad);
              self.currentLoad.position.set(0, -0.35, 0);
              self.loadMass = self.loadKind === 'rebar' ? 2.4 : self.loadKind === 'concrete' ? 3.6 : 1.4;
              self.bus.emit('crane:pickup', { id: self.id, load: self.loadKind, load_mass_t: self.loadMass });
            }
            self.fsm.change('LIFT');
          }
          void ctx;
        },
      },

      LIFT: {
        enter: (self) => {
          const target = self.nextDeliverTarget();
          self.deliverTarget = target;
          if (target) {
            self.aimAt(target.position);
            self.trolleyTarget = clamp(self.trolleyTarget, 4, self.jibLength);
          }
          self.hookTarget = self.mastTop - 3.2;
        },
        update: (self, dt, ctx) => {
          if (self.hookSettled(0.3)) self.fsm.change('SLEW');
          void ctx;
        },
      },

      SLEW: {
        enter: (self) => {
          self.reverseLift = self.hookY;
        },
        update: (self, dt, ctx) => {
          if (self.slewSettled(0.035)) self.fsm.change('TROLLEY');
          void ctx;
        },
      },

      TROLLEY: {
        update: (self, dt, ctx) => {
          if (Math.abs(self.trolley - self.trolleyTarget) < 0.25) {
            const target = self.deliverTarget;
            if (target) self.hookTarget = target.position.y + 0.6;
            self.fsm.change('LOWER');
          }
          void ctx;
        },
      },

      LOWER: {
        update: (self, dt, ctx) => {
          if (self.hookSettled(0.28)) self.fsm.change('RELEASE');
          void ctx;
        },
      },

      RELEASE: {
        enter: (self) => {
          if (self.currentLoad) {
            self.model.payloadAnchor.remove(self.currentLoad);
            const target = self.deliverTarget;
            if (target && self.building) {
              const dropPosition = new THREE.Vector3(target.position.x, target.position.y, target.position.z);
              self.bus.emit('crane:delivered', {
                id: self.id,
                load: self.loadKind,
                position: dropPosition,
                floor: target.floor,
              });
            }
            self.bus.emit('crane:drop', { id: self.id, load: self.loadKind });
            self.currentLoad = null;
          }
          self.cycleCount++;
          self.stationIndex++;
        },
        update: (self, dt, ctx) => {
          void dt;
          void ctx;
          self.fsm.change('RETURN');
        },
      },

      RETURN: {
        enter: (self) => {
          self.hookTarget = self.mastTop - 5;
        },
        update: (self, dt, ctx) => {
          if (self.hookSettled(0.4)) self.fsm.change('HOME');
          void ctx;
        },
      },
    };
  }

  /** Crane works only while the site is under construction (or forced). */
  readyToWork() {
    if (this.forcedActive === true) return true;
    if (this.forcedActive === false) return false;
    const source = this.building || this.sites.main;
    const mainState = source ? source.state : null;
    if (!mainState) return true;
    return !mainState.complete && mainState.core > 0.02;
  }

  nextDeliverTarget() {
    const geometry = this.building ? this.building.geometry : null;
    const state = this.building ? this.building.state : null;
    if (!geometry || !state) {
      const fallback = this.stations[0];
      if (!fallback) return null;
      return { position: fallback.position.clone().setY(4), floor: 0 };
    }
    const floor = clamp(state.activeFloor, 1, this.building.spec.floors.target);
    const side = ['south', 'east', 'west'][this.cycleCount % 3];
    const point = geometry.floorWorkPoint(floor, side, new THREE.Vector3());
    // Deliver just inside the slab edge so the load lands on the deck.
    return { position: point.setY(point.y + 0.4), floor };
  }

  slewSettled(tolerance = 0.02) {
    return Math.abs(wrapAngle(this.slewTarget - this.slew)) < tolerance;
  }

  hookSettled(tolerance = 0.4) {
    return Math.abs(this.hookTarget - this.hookY) < tolerance && Math.abs(this.hookVelocity) < 0.4;
  }

  /** Damped machine motion: slew, trolley and hoist all have inertia. */
  updateTransform(dt) {
    this.slew = angleDamp(this.slew, this.slewTarget, 2.2, dt);
    this.model.slewGroup.rotation.y = this.slew;

    const trolleyDelta = this.trolleyTarget - this.trolley;
    const trolleySpeed = clamp(trolleyDelta * 1.6, -3.2, 3.2);
    this.trolley += trolleySpeed * dt;
    if (Math.abs(trolleyDelta) < 0.02) this.trolley = this.trolleyTarget;
    this.model.trolley.position.z = this.trolley;
    this.model.hookBlock.position.z = this.trolley;

    // Hoist with gravity-ish damping so the block reads as heavy.
    const hookDelta = this.hookTarget - this.hookY;
    const desiredVelocity = clamp(hookDelta * 1.8, -3.4, 2.6);
    this.hookVelocity = damp(this.hookVelocity, desiredVelocity, 3.2, dt);
    this.hookY += this.hookVelocity * dt;
    if (Math.abs(hookDelta) < 0.03 && Math.abs(this.hookVelocity) < 0.05) {
      this.hookY = this.hookTarget;
      this.hookVelocity = 0;
    }
    this.model.hookBlock.position.y = this.hookY;
  }

  /** Ropes are cylinders scaled to the real trolley->hook distance. */
  updateRopes() {
    const trolleyY = this.model.trolley.position.y;
    const hookY = this.model.hookBlock.position.y;
    const distance = Math.max(0.04, trolleyY - hookY - 0.2);
    for (const [rope, offset] of [[this.model.ropeA, -0.45], [this.model.ropeB, 0.45]]) {
      rope.position.set(offset, (trolleyY + hookY) / 2, this.trolley);
      rope.scale.y = distance;
      rope.rotation.set(0, 0, 0);
    }
    // Hook rope from the block down to the load.
    const loadDrop = this.currentLoad ? 0.55 : 0.1;
    this.model.hookRope.position.set(0, -loadDrop / 2 - 0.1, 0);
    this.model.hookRope.scale.y = loadDrop;
  }

  update(dt, ctx) {
    this.fsm.update(dt);
    this.updateTransform(dt);
    this.updateRopes();
  }

  getWorldPosition(target = _world) {
    return target.copy(this.object3d.position);
  }

  /** Status string for the UI panel. */
  get status() {
    const labels = {
      HOME: '待机',
      PICK: '取料',
      LIFT: '起吊',
      SLEW: '回转',
      TROLLEY: '变幅',
      LOWER: '就位',
      RELEASE: '卸料',
      RETURN: '返程',
    };
    return labels[this.fsm.name] || this.fsm.name;
  }

  setActive(active) {
    this.forcedActive = Boolean(active);
  }

  getDebugInfo() {
    return {
      id: this.id,
      state: this.fsm.name,
      slew: Number(this.slew.toFixed(2)),
      trolley: Number(this.trolley.toFixed(2)),
      hookY: Number(this.hookY.toFixed(2)),
      load: this.loadKind || '-',
      cycles: this.cycleCount,
      target: this.deliverTarget && this.deliverTarget.floor !== undefined ? `F${this.deliverTarget.floor}` : '-',
    };
  }

  debugLabel() {
    return `${this.status} · ${this.loadKind || '空钩'}`;
  }

  dispose() {
    if (this.model.root.parent) this.model.root.parent.remove(this.model.root);
    this.object3d.traverse((child) => {
      if (child.isMesh) child.geometry.dispose();
    });
  }
}

void clamp01;
void lerp;
