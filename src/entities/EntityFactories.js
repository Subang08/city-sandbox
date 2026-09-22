import THREE from '../lib/three.js';
import { BuildingGeometry } from './BuildingEntity.js';
import { CharacterEntity } from './CharacterEntity.js';
import { VehicleEntity } from './VehicleEntity.js';
import { CraneEntity } from './CraneEntity.js';
import { LightEntity, PropEntity } from './LightEntity.js';
import { AssetManager } from '../core/AssetManager.js';
import { mergeGeometries } from '../lib/merge.js';
import { PropGeometries } from '../world/Props.js';
import { createCraneLoad } from './cranes/CraneModel.js';
import { buildPropGeometry } from '../world/Props.js';

AssetManager.useMerge(mergeGeometries);

/**
 * BuildingEntity - thin entity wrapper around BuildingGeometry.
 * The entity owns the "when do I rebuild" policy: geometry is regenerated from
 * the construction state whenever the discrete build state changes (floor count,
 * trade reached a new floor, scaffolding range). Never a scaleY trick.
 */
export function createBuildingEntity(spec, ctx) {
  const geometry = new BuildingGeometry(spec, ctx.kits, { seed: ctx.config.seed });
  const group = geometry.group;
  ctx.scene.add(group, { dynamic: true });

  const plan = {
    id: spec.id,
    name: spec.name || spec.id,
    role: spec.role,
    existingFloors: spec.floors.existing,
    targetFloors: spec.floors.target,
    state: null,
  };
  if (ctx.construction) ctx.construction.register(spec.id, plan);

  const entity = {
    id: spec.id,
    type: 'building',
    role: spec.role,
    spec,
    plan,
    geometry,
    object3d: group,
    revision: -1,
    rebuilds: 0,
    lastRebuildAt: 0,
    _lastSignature: '',
    get state() {
      return plan.state;
    },
    init() {
      // Initial build from whatever the clock already says.
      const state = plan.state || ctx.construction?.state(spec.id) || null;
      if (state) this.applyState(state, true);
    },
    applyState(state, force = false) {
      const signature = [
        state.floorsCompleted,
        Math.round(state.core * 60),
        Math.round(state.facadeFloors * 4),
        Math.round(state.glazingFloors * 4),
        Math.round(state.foundation * 20),
        Math.round(state.roofing * 10),
        state.scaffolding ? `${state.scaffolding.from}-${state.scaffolding.to}` : 'none',
      ].join('|');
      if (!force && signature === this._lastSignature) return false;
      this._lastSignature = signature;
      geometry.build(state);
      geometry.batches.commit(group);
      this.rebuilds++;
      ctx.bus.emit('building:rebuilt', { id: spec.id, floors: state.floorsCompleted, boxes: geometry.stats.boxes });
      return true;
    },
    update() {
      const state = plan.state;
      if (!state) return;
      this.applyState(state, false);
    },
    getWorldPosition(target = new THREE.Vector3()) {
      return target.copy(group.position);
    },
    getDebugInfo() {
      const state = plan.state;
      return {
        id: spec.id,
        floors: state ? state.floorsCompleted : 0,
        target: plan.targetFloors,
        stage: state ? state.stage : '-',
        boxes: geometry.stats.boxes,
        rebuilds: this.rebuilds,
      };
    },
    debugLabel() {
      const state = plan.state;
      return state ? `F${state.floorsCompleted}/${plan.targetFloors} ${state.stage}` : '—';
    },
    dispose() {
      geometry.dispose();
    },
  };
  return entity;
}

export function registerEntityFactories(manager, ctx) {
  manager.registerFactory('building', (spec, factoryCtx) => createBuildingEntity(spec, { ...factoryCtx, ...ctx }));
  manager.registerFactory('crane', (spec, factoryCtx) => new CraneEntity(spec, { ...factoryCtx, ...ctx }));
  manager.registerFactory('vehicle', (spec, factoryCtx) => new VehicleEntity(spec, { ...factoryCtx, ...ctx }));
  manager.registerFactory('character', (spec, factoryCtx) => new CharacterEntity(spec, { ...factoryCtx, ...ctx }));
  manager.registerFactory('light', (spec, factoryCtx) => new LightEntity(spec, { ...factoryCtx, ...ctx }));
  manager.registerFactory('prop', (spec, factoryCtx) => new PropEntity(spec, { ...factoryCtx, ...ctx }));
  return manager;
}

/**
 * AssetManager registration: every procedural prop/vehicle/crane/character is an
 * addressable asset id. Dropping a real GLB later means registering the same id
 * with a loader-backed factory - no entity code changes.
 */
export function registerAssets(assets, kits) {
  const propIds = Object.keys(PropGeometries);
  for (const id of propIds) {
    assets.registerProcedural(`prop.${id}`, () => {
      const mesh = new THREE.Mesh(buildPropGeometry(id), kits.get('paint'));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      return mesh;
    }, { kind: 'prop', source: 'procedural' });
  }
  assets.registerProcedural('crane.load.rebar', () => createCraneLoad('rebar', kits), { kind: 'payload' });
  assets.registerProcedural('crane.load.concrete', () => createCraneLoad('concrete', kits), { kind: 'payload' });
  assets.registerProcedural('crane.load.pallet', () => createCraneLoad('pallet', kits), { kind: 'payload' });
  assets.registerProcedural('crane.load.pipes', () => createCraneLoad('pipes', kits), { kind: 'payload' });
  return assets;
}
