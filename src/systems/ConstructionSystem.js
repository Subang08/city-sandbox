import { clamp01, invLerp, smoothstep } from '../lib/mathx.js';

/**
 * ConstructionSystem - turns the virtual clock into a build state.
 *
 * The building is NEVER scaled: this system decides how many real floors exist,
 * which trades have reached which floor, where scaffolding still stands and
 * which floor is currently being worked on. Entities read this state and rebuild
 * actual geometry (slab + columns + beams + walls + windows).
 */
export class ConstructionSystem {
  constructor({ bus, config, time }) {
    this.bus = bus;
    this.config = config;
    this.time = time;
    this.trades = config.construction?.trades || [];
    this.timeline = config.construction?.timeline || { from: 1, to: 16 };
    this.buildings = new Map();
    this.progress = new Map();
    this.lastNotifiedFloor = new Map();
    this.lastStage = new Map();
    this._bind();
  }

  _bind() {
    this.bus.on('time:tick', () => this.evaluate());
    this.bus.on('time:day', () => this.evaluate(true));
  }

  register(buildingId, plan) {
    this.buildings.set(buildingId, plan);
    this.progress.set(buildingId, {});
    return this;
  }

  get locked() {
    return false;
  }

  /**
   * Trade progress at a given day, 0..1, with a smooth rather than linear ramp
   * so crews visibly accelerate and taper off.
   */
  tradeProgress(trade, day) {
    const raw = invLerp(trade.start, trade.end, day);
    return smoothstep(raw);
  }

  evaluate(force = false) {
    const day = this.time.day;
    for (const [id, plan] of this.buildings) {
      const progress = this.progress.get(id) || {};
      let changed = false;
      for (const trade of this.trades) {
        const value = this.tradeProgress(trade, day);
        const previous = progress[trade.id];
        if (previous === undefined || Math.abs(previous - value) > 0.002) {
          progress[trade.id] = value;
          changed = true;
        }
      }
      this.progress.set(id, progress);
      const state = this.deriveState(id, plan, progress, day);
      plan.state = state;
      if (changed || force) {
        this.bus.emit('construction:progress', { buildingId: id, day, state });
      }
      const stageKey = `${state.stage}:${state.floorsCompleted}`;
      if (this.lastStage.get(id) !== stageKey) {
        const previousStage = this.lastStage.get(id);
        this.lastStage.set(id, stageKey);
        if (previousStage !== undefined) {
          this.bus.emit('construction:stage', {
            buildingId: id,
            stage: state.stage,
            floors: state.floorsCompleted,
            day,
          });
        }
      }
      const notified = this.lastNotifiedFloor.get(id) || 0;
      if (state.floorsCompleted > notified) {
        this.lastNotifiedFloor.set(id, state.floorsCompleted);
        if (notified > 0) {
          this.bus.emit('construction:floorComplete', {
            buildingId: id,
            floor: state.floorsCompleted,
            total: plan.targetFloors,
          });
        }
      }
    }
    return this.buildings;
  }

  deriveState(id, plan, progress, day) {
    const { existingFloors, targetFloors } = plan;
    const core = progress.core ?? 0;
    const facade = progress.facade ?? 0;
    const glazing = progress.glazing ?? 0;
    const foundation = progress.foundation ?? 0;
    const excavation = progress.excavation ?? 0;
    const roofing = progress.roofing ?? 0;
    const fitout = progress.fitout ?? 0;
    const cleanup = progress.cleanup ?? 0;

    let stage = 'excavation';
    if (foundation > 0.02) stage = 'foundation';
    if (core > 0.01) stage = 'structure';
    if (facade > 0.05 && core > 0.35) stage = 'facade';
    if (glazing > 0.05) stage = 'glazing';
    if (glazing > 0.97 && roofing > 0.9) stage = 'complete';

    // Structural climb: from existing floors up to the target, never down.
    const climbable = targetFloors - existingFloors;
    const structureFloors = existingFloors + climbable * core;
    const floorsCompleted = Math.max(existingFloors, Math.floor(structureFloors + 1e-6));
    const coreFloorProgress = clamp01(structureFloors - floorsCompleted);
    const topFloor = floorsCompleted;

    // Facade follows the structure a couple of floors behind.
    const facadeFloors = existingFloors + (targetFloors - existingFloors) * facade * 0.94;
    const glazingFloors = existingFloors + (targetFloors - existingFloors) * glazing * 0.94;

    const scaffoldFrom = Math.max(existingFloors - 1, Math.floor(facadeFloors) - 1);
    const scaffoldTo = topFloor + 1;
    const scaffolding = core > 0.02 && core < 0.995 ? { from: scaffoldFrom, to: scaffoldTo } : null;

    const activeFloor = Math.max(existingFloors, Math.min(targetFloors + 1, topFloor + 1));
    const slabProgress = clamp01(coreFloorProgress * 1.6);
    const columnProgress = clamp01(coreFloorProgress * 3.2);
    const beamProgress = clamp01(Math.max(0, coreFloorProgress - 0.18) * 2.6);

    return {
      day,
      stage,
      excavation,
      foundation,
      core,
      facade,
      glazing,
      roofing,
      fitout,
      cleanup,
      floorsCompleted,
      structureFloors,
      facadeFloors,
      glazingFloors,
      topFloor,
      activeFloor,
      scaffoldFrom,
      scaffoldTo,
      scaffolding,
      slabProgress,
      columnProgress,
      beamProgress,
      craneActive: core > 0.02 && core < 0.995,
      crewDensity: clamp01(0.35 + core * 1.2 - cleanup * 0.6),
      complete: stage === 'complete',
    };
  }

  state(buildingId) {
    const plan = this.buildings.get(buildingId);
    return plan ? plan.state : null;
  }

  /** Snapshot for UI panels. */
  snapshot() {
    const out = [];
    for (const [id, plan] of this.buildings) {
      const state = plan.state;
      if (!state) continue;
      out.push({
        id,
        name: plan.name || id,
        stage: state.stage,
        floors: state.floorsCompleted,
        target: plan.targetFloors,
        trades: this.trades.map((trade) => ({
          id: trade.id,
          label: trade.label,
          progress: this.progress.get(id)?.[trade.id] ?? 0,
        })),
      });
    }
    return out;
  }
}
