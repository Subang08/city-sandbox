import THREE from '../lib/three.js';
import { StateMachine } from '../lib/fsm.js';
import { CharacterModel, ROLES, createCarryItem } from './chars/CharacterModel.js';
import { animateByState, animateIdle } from './chars/AnimationLibrary.js';
import { angleDamp, clamp, damp, distance2, lerp, wrapAngle } from '../lib/mathx.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _side = new THREE.Vector3();

/**
 * CharacterEntity - one construction worker.
 *
 * States: IDLE / WALK / WORK / CARRY / TALK / REST driven by a StateMachine.
 * Navigation: A* over the WaypointGraph, with per-character lateral drift so two
 * workers never travel the identical line, plus separation steering that keeps
 * them from overlapping.
 */
export class CharacterEntity {
  constructor(spec, ctx) {
    this.id = spec.id;
    this.type = 'character';
    this.spec = spec;
    this.manager = ctx.manager;
    this.bus = ctx.bus;
    this.runtime = ctx.runtime;
    this.graph = ctx.graph;
    this.navGrid = ctx.navGrid;
    this.rng = ctx.rng ? ctx.rng.fork(spec.id) : null;
    this.role = spec.role || 'mason';
    this.roleInfo = ROLES[this.role] || ROLES.mason;
    this.homeNode = spec.homeNode || 'site-entry';
    this.workHours = spec.workHours || [7, 19];
    this.speed = spec.speed || 1.25;
    this.energy = 1;
    this.lookSpeed = spec.lookSpeed || 2.4;
    this.driftSeed = (this.rng ? this.rng.range(0, 10) : 0);
    this.driftAmount = spec.drift !== undefined ? spec.drift : (this.rng ? this.rng.range(-0.55, 0.55) : 0);
    this.separationRadius = 0.85;

    const model = new CharacterModel({ role: this.role, seed: this.id, assetId: spec.asset || 'character.worker' });
    this.object3d = model.root;
    this.model = model;
    this.object3d.name = this.id;
    this.talkCooldown = 0;

    this.heading = spec.heading || 0;
    this.velocity = new THREE.Vector3();
    this.speedCurrent = 0;
    const startNode = this.graph.get(this.homeNode) || this.graph.get('site-entry');
    this.object3d.position.set(
      startNode.position.x + this.driftAmount,
      1.06,
      startNode.position.z + this.driftAmount * 0.5,
    );
    this.object3d.rotation.y = this.heading;

    this.task = null;
    this.path = [];
    this.pathIndex = 0;
    this.targetPosition = new THREE.Vector3();
    this.targetNode = null;
    this.carryKind = null;
    this.animationTime = 0;
    this.workTimer = 0;
    this.idleTimer = 0;
    this.registeredSpot = null;
    this.floorY = null;

    this.fsm = new StateMachine(this, this.states(), 'IDLE', { ctx });
    this.bus.emit('character:spawned', { id: this.id, role: this.role });
  }

  get label() {
    return `${this.id} · ${this.roleInfo.label}`;
  }

  get state() {
    return this.fsm.name;
  }

  states() {
    return {
      IDLE: {
        enter: (self) => {
          self.clearCargo();
          self.idleTimer = 0;
          self.animationTime = 0;
        },
        update: (self, dt, ctx) => {
          self.idleTimer += dt;
          self.velocity.multiplyScalar(1 - Math.min(1, dt * 6));
          const idle = self.runtime.pickIdleTask(self, ctx);
          if (idle) {
            self.beginTask(idle);
            return;
          }
          if (self.idleTimer > 1.5) self.fsm.change('REST');
        },
      },

      WALK: {
        enter: (self) => {
          self.animationTime = 0;
        },
        update: (self, dt, ctx) => {
          const arrived = self.followPath(dt, ctx);
          if (arrived) {
            const task = self.task;
            self.clearPath();
            if (!task) {
              self.fsm.change('IDLE');
              return;
            }
            self.registerSpot(ctx);
            if (task.kind === 'carry' && task.phase === 'fetch') {
              task.phase = 'deliver';
              self.pickUpCargo(task.cargo);
              self.fsm.change('CARRY');
              return;
            }
            self.fsm.change('WORK');
          }
        },
      },

      CARRY: {
        enter: (self, ctx, payload) => {
          void ctx;
          void payload;
          self.animationTime = 0;
        },
        update: (self, dt, ctx) => {
          const arrived = self.followPath(dt, ctx);
          if (arrived) {
            self.clearPath();
            if (self.task) {
              self.runtime.completeTask(self.task, self, ctx);
              self.releaseSpot(ctx);
              if (self.task.cargo) {
                self.bus.emit('character:delivered', { id: self.id, cargo: self.task.cargo });
              }
            }
            self.task = null;
            self.clearCargo();
            self.fsm.change('IDLE');
          }
        },
      },

      WORK: {
        enter: (self, ctx) => {
          self.animationTime = 0;
          self.workTimer = self.task ? self.task.duration : 6;
          self.bus.emit('character:workStarted', { id: self.id, task: self.task ? self.task.id : 'masonry' });
        },
        update: (self, dt, ctx) => {
          self.workTimer -= dt;
          if (self.task && self.task.id === 'masonry' && Math.random() < dt * 3.4) {
            self.bus.emit('character:hammer', { id: self.id });
          }
          if (self.workTimer <= 0) {
            const task = self.task;
            self.task = null;
            self.releaseSpot(ctx);
            if (task) self.runtime.completeTask(task, self, ctx);
            self.fsm.change('IDLE');
          }
        },
      },

      TALK: {
        enter: (self, ctx, payload) => {
          self.animationTime = 0;
          self.partner = payload && payload.partner ? payload.partner : null;
          self.talkTimer = payload && payload.duration ? payload.duration : 6;
        },
        update: (self, dt) => {
          self.talkTimer -= dt;
          self.velocity.multiplyScalar(1 - Math.min(1, dt * 5));
          if (self.partner && self.partner.object3d) {
            const dx = self.partner.object3d.position.x - self.object3d.position.x;
            const dz = self.partner.object3d.position.z - self.object3d.position.z;
            self.heading = angleDamp(self.heading, Math.atan2(dx, dz), 3, dt);
          }
          if (self.talkTimer <= 0) self.fsm.change('IDLE');
        },
        exit: (self) => {
          if (self.partner) self.partner.talkCooldown = 8;
          self.talkCooldown = 8;
          self.partner = null;
        },
      },

      REST: {
        enter: (self, ctx) => {
          self.animationTime = 0;
          self.restTimer = 5 + Math.random() * 7;
          const breakSpot = self.runtime.getBreakSpot ? self.runtime.getBreakSpot(ctx) : null;
          if (breakSpot && Math.random() < 0.65) {
            self.navigateTo(breakSpot, ctx);
          }
        },
        update: (self, dt, ctx) => {
          self.restTimer -= dt;
          if (self.path.length) self.followPath(dt, ctx);
          if (self.restTimer <= 0) self.fsm.change('IDLE');
        },
      },
    };
  }

  beginTask(task) {
    this.task = task;
    this.targetPosition.copy(task.position);
    if (task.spot) this.targetNode = task.spot.node.id;
    const path = this.buildPath(task.spot ? task.spot.node.id : null);
    if (!path || path.length < 2) {
      // Already there (or unreachable): work in place.
      this.path = [];
      this.fsm.change(task.kind === 'carry' ? 'CARRY' : 'WORK');
      return;
    }
    this.path = path;
    this.pathIndex = 1;
    this.fsm.change('WALK');
  }

  navigateTo(nodeId, ctx) {
    const path = this.buildPath(nodeId);
    if (path && path.length > 1) {
      this.path = path;
      this.pathIndex = 1;
      this.task = null;
      this.fsm.change('WALK');
    }
    void ctx;
  }

  buildPath(goalNodeId) {
    const from = this.graph.nearestNode(this.object3d.position, (node) => !node.workSpot || node.id === goalNodeId);
    const goal = goalNodeId ? this.graph.get(goalNodeId) : null;
    if (!from || !goal) return null;
    const ids = this.graph.findPath(from.id, goal.id);
    if (!ids) return null;
    return ids.map((id) => this.graph.get(id));
  }

  registerSpot(ctx) {
    if (this.task && this.task.spot && this.runtime.claimSpot) {
      this.registeredSpot = this.runtime.claimSpot(this, this.task.spot);
    }
    void ctx;
  }

  releaseSpot(ctx) {
    if (this.registeredSpot && this.runtime.releaseSpot) {
      this.runtime.releaseSpot(this, this.registeredSpot);
    }
    this.registeredSpot = null;
    void ctx;
  }

  clearPath() {
    this.path = [];
    this.pathIndex = 0;
  }

  pickUpCargo(kind) {
    this.carryKind = kind || 'box';
    const item = createCarryItem(this.carryKind, this.model.material ? this.ctxKits() : null);
    this.model.setCarry(item);
  }

  ctxKits() {
    return this.kits || this.manager.kits;
  }

  clearCargo() {
    this.carryKind = null;
    this.model.setCarry(null);
  }

  /** Waypoint following with lateral drift + climb handling. */
  followPath(dt, ctx) {
    if (!this.path.length || this.pathIndex >= this.path.length) return true;
    const node = this.path[this.pathIndex];
    const nodePos = node.position;
    const dx = nodePos.x - this.object3d.position.x;
    const dz = nodePos.z - this.object3d.position.z;
    const dist = Math.hypot(dx, dz);
    const speed = this.state === 'WALK' ? this.speed : this.speed * 0.72;
    const arriveRadius = this.pathIndex === this.path.length - 1 ? (this.task && this.task.arriveRadius) || 1.1 : 0.7;

    if (dist < arriveRadius) {
      this.pathIndex++;
      if (this.pathIndex >= this.path.length) {
        this.speedCurrent = 0;
        return true;
      }
      return false;
    }

    // Target with per-character lateral drift perpendicular to the travel dir.
    const dirX = dx / (dist || 1);
    const dirZ = dz / (dist || 1);
    const drift = Math.sin(this.driftSeed + this.animationTime * 0.6) * this.driftAmount * 0.35 + this.driftAmount;
    const desiredX = nodePos.x + -dirZ * drift;
    const desiredZ = nodePos.z + dirX * drift;

    const toX = desiredX - this.object3d.position.x;
    const toZ = desiredZ - this.object3d.position.z;
    const toDist = Math.hypot(toX, toZ) || 1;
    const desiredSpeed = Math.min(speed, toDist * 2.4 + 0.35);

    // Separation from other workers.
    let sepX = 0;
    let sepZ = 0;
    if (ctx && ctx.characters) {
      for (const other of ctx.characters) {
        if (other === this) continue;
        const ox = this.object3d.position.x - other.object3d.position.x;
        const oz = this.object3d.position.z - other.object3d.position.z;
        const d2 = ox * ox + oz * oz;
        if (d2 > this.separationRadius * this.separationRadius || d2 < 1e-5) continue;
        const d = Math.sqrt(d2);
        const push = (1 - d / this.separationRadius) * 1.5;
        sepX += (ox / d) * push;
        sepZ += (oz / d) * push;
      }
    }

    this.speedCurrent = damp(this.speedCurrent, desiredSpeed, 5, dt);
    const vx = dirX * this.speedCurrent + sepX;
    const vz = dirZ * this.speedCurrent + sepZ;
    this.object3d.position.x += vx * dt;
    this.object3d.position.z += vz * dt;

    // Terrain height: floor of the building if the worker is inside the volume.
    if (ctx && ctx.getFloorHeight) {
      const rawY = ctx.getFloorHeight(this.object3d.position.x, this.object3d.position.z, this.object3d.position.y);
      this.object3d.position.y = damp(this.object3d.position.y, rawY, 3.4, dt);
    }

    const targetHeading = Math.atan2(vx, vz);
    this.heading = angleDamp(this.heading, targetHeading, 6, dt);
    this.object3d.rotation.y = this.heading;
    this.velocity.set(vx, 0, vz);
    return false;
  }

  update(dt, ctx) {
    this.animationTime += dt;
    this.talkCooldown = Math.max(0, this.talkCooldown - dt);
    this.fsm.update(dt);

    // Talking is opportunistic: two idle workers close together start a chat.
    if (this.fsm.name === 'IDLE' && this.talkCooldown <= 0 && ctx && ctx.characters && Math.random() < dt * 0.25) {
      for (const other of ctx.characters) {
        if (other === this || other.state !== 'IDLE' || other.talkCooldown > 0) continue;
        if (distance2(
          this.object3d.position.x, this.object3d.position.z,
          other.object3d.position.x, other.object3d.position.z,
        ) < 9) {
          this.fsm.change('TALK', { partner: other, duration: 5 + Math.random() * 5 });
          if (other.fsm.name === 'IDLE') other.fsm.change('TALK', { partner: this, duration: 5 + Math.random() * 5 });
          break;
        }
      }
    }

    if (ctx && ctx.separationFromCharacters) {
      ctx.separationFromCharacters(this, dt);
    }

    const params = {
      speed: Math.max(0.7, this.speedCurrent),
      task: this.task ? this.task.id : null,
      heavy: this.carryKind === 'rebar' || this.carryKind === 'bag',
      energy: this.energy,
    };
    if (this.fsm.name === 'REST' && !this.path.length) {
      animateByState(this.model, 'REST', this.animationTime, params);
    } else if (this.fsm.name === 'IDLE' && this.idleTimer > 6) {
      animateIdle(this.model, this.animationTime, 0.6);
    } else {
      animateByState(this.model, this.fsm.name, this.animationTime, params);
    }
  }

  getWorldPosition(target = _v) {
    return target.copy(this.object3d.position);
  }

  getDebugInfo() {
    return {
      id: this.id,
      role: this.roleInfo.label,
      state: this.fsm.name,
      task: this.task ? this.task.id : '-',
      target: this.targetPosition.toArray().map((v) => Number(v.toFixed(1))),
      path: this.path.length ? this.path.map((n) => n.id) : [],
      carrying: this.carryKind || '-',
      speed: Number(this.speedCurrent.toFixed(2)),
    };
  }

  debugLabel() {
    return `${this.roleInfo.label}·${this.fsm.name}`;
  }

  dispose() {
    this.model.dispose();
  }
}

export { wrapAngle, clamp, lerp, _side, _v2 };
