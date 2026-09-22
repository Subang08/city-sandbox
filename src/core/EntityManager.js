import THREE from '../lib/three.js';

const REQUIRED = ['id', 'type', 'object3d', 'update'];

/**
 * EntityManager - registry + factory for every simulated object.
 * Entities are plain classes: { id, type, object3d, init?, update(dt, ctx), dispose? }.
 * Systems talk to the manager, never to entity classes directly.
 */
export class EntityManager {
  constructor({ bus, scene, assets, kits, config }) {
    this.bus = bus;
    this.scene = scene;
    this.assets = assets;
    this.kits = kits;
    this.config = config;
    this.entities = [];
    this.byId = new Map();
    this.byType = new Map();
    this.factories = new Map();
    this.updateOrder = ['building', 'crane', 'vehicle', 'character', 'light', 'prop'];
    this.stats = { created: 0, disposed: 0 };
  }

  registerFactory(type, factory) {
    this.factories.set(type, factory);
    return this;
  }

  create(type, spec, context = {}) {
    const factory = this.factories.get(type);
    if (!factory) throw new Error(`EntityManager: no factory for type "${type}"`);
    const entity = factory(spec, {
      manager: this,
      bus: this.bus,
      scene: this.scene,
      assets: this.assets,
      kits: this.kits,
      config: this.config,
      ...context,
    });
    for (const key of REQUIRED) {
      if (entity[key] === undefined) throw new Error(`EntityManager: entity "${entity.id || '?'}" missing "${key}"`);
    }
    if (this.byId.has(entity.id)) throw new Error(`EntityManager: duplicate entity id "${entity.id}"`);
    this.entities.push(entity);
    this.byId.set(entity.id, entity);
    if (!this.byType.has(entity.type)) this.byType.set(entity.type, []);
    this.byType.get(entity.type).push(entity);
    this.stats.created++;
    this.bus.emit('entity:created', { id: entity.id, type: entity.type });
    if (entity.init) entity.init(context);
    return entity;
  }

  /** Build every entity declared in a data-driven scene config section. */
  createFromConfig(specs, context = {}) {
    const created = [];
    for (const spec of specs || []) {
      created.push(this.create(spec.type, spec, context));
    }
    return created;
  }

  get(id) {
    return this.byId.get(id) || null;
  }

  all(type = null) {
    return type ? this.byType.get(type) || [] : this.entities;
  }

  count(type = null) {
    return this.all(type).length;
  }

  find(predicate) {
    return this.entities.filter(predicate);
  }

  update(dt, ctx) {
    for (const type of this.updateOrder) {
      const list = this.byType.get(type);
      if (!list) continue;
      for (const entity of list) entity.update(dt, ctx);
    }
    // Any custom type registered outside the known order still gets updated.
    for (const [type, list] of this.byType) {
      if (this.updateOrder.includes(type)) continue;
      for (const entity of list) entity.update(dt, ctx);
    }
  }

  remove(id) {
    const entity = this.byId.get(id);
    if (!entity) return false;
    if (entity.dispose) entity.dispose();
    if (entity.object3d && entity.object3d.parent) entity.object3d.parent.remove(entity.object3d);
    this.entities.splice(this.entities.indexOf(entity), 1);
    this.byId.delete(id);
    const list = this.byType.get(entity.type);
    if (list) {
      const index = list.indexOf(entity);
      if (index >= 0) list.splice(index, 1);
    }
    this.stats.disposed++;
    this.bus.emit('entity:removed', { id });
    return true;
  }

  disposeAll() {
    for (const entity of [...this.entities]) this.remove(entity.id);
  }
}
