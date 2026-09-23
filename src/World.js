import THREE from './lib/three.js';
import { SceneManager } from './core/SceneManager.js';
import { EventBus } from './core/EventBus.js';
import { AssetManager } from './core/AssetManager.js';
import { EntityManager } from './core/EntityManager.js';
import { MaterialKit } from './lib/materials.js';
import { TextureKit } from './lib/textures.js';
import { Rng } from './lib/rng.js';
import { DebugDraw } from './lib/helpers.js';
import { WorldBuilder } from './world/WorldBuilder.js';
import { WaypointGraph, NavGrid } from './world/WaypointGraph.js';
import { TimeSystem } from './systems/TimeSystem.js';
import { ConstructionSystem } from './systems/ConstructionSystem.js';
import { LightingSystem } from './systems/LightingSystem.js';
import { WeatherSystem } from './systems/WeatherSystem.js';
import { CameraSystem } from './systems/CameraSystem.js';
import { AudioSystem } from './systems/AudioSystem.js';
import { LightRig } from './systems/LightRig.js';
import { registerEntityFactories, registerAssets } from './entities/EntityFactories.js';
import { ROLES } from './entities/chars/CharacterModel.js';
import { clamp, clamp01, distance2, lerp, remap } from './lib/mathx.js';

/**
 * World - the simulation core. Builds every system and entity from data, and
 * advances them in a fixed order. It has no dependency on WebGL, so it can be
 * stepped headlessly (tools/simtest.mjs) for deterministic camera-free testing.
 */
export class World {
  constructor({ config, weatherPresets, lightingPalettes, renderer = null, host = undefined }) {
    this.config = config;
    this.renderer = renderer;
    this.bus = new EventBus();
    this.textures = new TextureKit({ seed: `${config.seed || 'world'}-tex` });
    this.kits = new MaterialKit({ textures: this.textures });
    this.scene = new SceneManager({ renderer });
    this.rng = new Rng(config.seed || 'world');
    this.assets = new AssetManager({ onWarn: (message) => this.bus.emit('asset:warn', { message }) });
    registerAssets(this.assets, this.kits);
    this.debug = new DebugDraw(this.scene);
    this.elapsed = 0;
    this.frame = 0;
    this.quality = { pixelRatio: 1.5, shadows: true, shadowMap: 2048, aa: true };
    this.systems = {};

    this._buildSystems(weatherPresets, lightingPalettes);
    this._buildWorldGeometry();
    this._buildNavigation();
    this._buildEntities();
    this._buildRuntime();
    this._wireEvents();
    this.construction.evaluate(true);
    this.lighting.apply(true);
  }

  _buildSystems(weatherPresets, lightingPalettes) {
    const time = new TimeSystem({ bus: this.bus, config: this.config });
    const construction = new ConstructionSystem({ bus: this.bus, config: this.config, time });
    const lighting = new LightingSystem({
      scene: this.scene,
      config: this.config,
      bus: this.bus,
      time,
      kits: this.kits,
      palettes: lightingPalettes,
      renderer: this.renderer,
    });
    const weather = new WeatherSystem({
      scene: this.scene,
      bus: this.bus,
      kits: this.kits,
      config: this.config,
      presets: weatherPresets,
      rng: this.rng.fork('weather'),
    });
    const audio = new AudioSystem({ bus: this.bus });
    this.systems = { time, construction, lighting, weather, audio };
    this.time = time;
    this.construction = construction;
    this.lighting = lighting;
    this.weather = weather;
    this.audio = audio;
    this.lightRig = new LightRig({ scene: this.scene, kits: this.kits, capacity: 300 });
  }

  _buildWorldGeometry() {
    const builder = new WorldBuilder({
      scene: this.scene,
      kits: this.kits,
      config: this.config,
      bus: this.bus,
      rng: this.rng.fork('world'),
    });
    builder.build();
    this.worldBuilder = builder;
    this.worldStats = builder.stats;
    this.roadCurves = builder.roadCurves || {};
    this.routes = this._buildRoutes();
  }

  /** Route network for vehicles: ring road lanes + internal yard loop. */
  _buildRoutes() {
    const routes = {};
    const roadSpecs = this.config.roads || [];
    const isClosed = (spec) => Boolean(spec.closed);
    for (const spec of roadSpecs) {
      const entry = this.roadCurves[spec.id];
      if (!entry) continue;
      const curve = entry.curve;
      const half = spec.width * 0.25;
      const laneCurves = this._offsetCurves(curve, half, isClosed(spec));
      routes[spec.id] = { curve, offset: 0, closed: isClosed(spec), id: spec.id };
      routes[`${spec.id}:inner`] = { curve: laneCurves.inner, offset: 0, closed: isClosed(spec), lane: 'inner' };
      routes[`${spec.id}:outer`] = { curve: laneCurves.outer, offset: 0, closed: isClosed(spec), lane: 'outer' };
    }
    for (const [id, spec] of Object.entries(this.config.routes || {})) {
      const curve = new THREE.CatmullRomCurve3(
        spec.points.map((p) => new THREE.Vector3(p[0], 0, p[1])),
        spec.closed !== false,
        'catmullrom',
        0.4,
      );
      curve.arcLengthDivisions = 400;
      routes[id] = { curve, offset: 0, closed: spec.closed !== false, id };
      const offset = this._offsetCurves(curve, 1.7, spec.closed !== false);
      routes[`${id}:inner`] = { curve: offset.inner, offset: 0, closed: true, lane: 'inner' };
      routes[`${id}:outer`] = { curve: offset.outer, offset: 0, closed: true, lane: 'outer' };
    }
    return routes;
  }

  /** Build numerically offset lane curves (no extra config needed). */
  _offsetCurves(curve, distance, closed) {
    const divisions = closed ? 180 : 90;
    const points = curve.getSpacedPoints(divisions);
    const build = (sign) => {
      const offsetPoints = [];
      for (let i = 0; i < points.length; i++) {
        const current = points[i];
        const next = points[Math.min(points.length - 1, i + 1)];
        const prev = points[Math.max(0, i - 1)];
        const tangent = new THREE.Vector3().subVectors(next, prev);
        tangent.y = 0;
        if (tangent.lengthSq() < 1e-6) continue;
        tangent.normalize();
        const right = new THREE.Vector3(tangent.z, 0, -tangent.x).multiplyScalar(sign * distance);
        offsetPoints.push(new THREE.Vector3(current.x + right.x, 0, current.z + right.z));
      }
      const offsetCurve = new THREE.CatmullRomCurve3(offsetPoints, closed, 'catmullrom', 0.4);
      offsetCurve.arcLengthDivisions = 400;
      return offsetCurve;
    };
    return { inner: build(1), outer: build(-1) };
  }

  _buildNavigation() {
    const nav = this.config.navigation || {};
    this.graph = new WaypointGraph({ nodes: nav.nodes || [], edges: nav.extraEdges || [] });
    this.graph.autoConnect({ maxDist: 18, k: 3, sameBias: 1.25 });
    this.navGrid = new NavGrid({ width: 100, depth: 80, cell: nav.cell || 2 });

    const block = (center, size, extra = 0.6) =>
      this.navGrid.blockRect({ center, size, margin: extra });
    for (const building of this.config.buildings) {
      block([building.position[0], building.position[2] !== undefined ? building.position[2] : building.position[1]], [
        building.size[0] + 1.6,
        building.size[1] + 1.6,
      ], 0.2);
    }
    for (const crane of this.config.cranes) {
      block([crane.position[0], crane.position[2] !== undefined ? crane.position[2] : crane.position[1]], [5, 5], 0.2);
    }
    for (const pile of this.config.site.stockpiles) {
      block(pile.position, [pile.size[0], pile.size[2]], 0.6);
    }
    for (const container of [[30, -18], [30, -20.6], [24, -20.6], [-33, 2], [34, 6]]) {
      block(container, [6.4, 2.8], 0.4);
    }
    for (const cabin of [[-27, 18], [-20.5, 18], [-27, 22.6]]) {
      block(cabin, [6.4, 3.2], 0.4);
    }
    for (const yard of [this.config.laydown.rebarYard.center, this.config.laydown.materialYard.center]) {
      block(yard, [10, 12], 0.0);
    }
    // Re-open the work spot cells so characters can still stand at their stations.
    for (const node of this.graph.nodes.values()) {
      if (!node.workSpot) continue;
      const index = Math.floor((node.position.x - this.navGrid.originX) / this.navGrid.cell);
      const row = Math.floor((node.position.z - this.navGrid.originZ) / this.navGrid.cell);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          const c = index + dx;
          const r = row + dz;
          if (c < 0 || r < 0 || c >= this.navGrid.cols || r >= this.navGrid.rows) continue;
          this.navGrid.grid[r * this.navGrid.cols + c] = 0;
        }
      }
    }
  }

  _buildEntities() {
    const spawnRng = this.rng.fork('spawn');
    this.manager = new EntityManager({
      bus: this.bus,
      scene: this.scene,
      assets: this.assets,
      kits: this.kits,
      config: this.config,
    });

    // Work-spot registry: one claimant per spot so workers never stack.
    this.spotClaims = new Map();

    const buildings = this.config.buildings.map((spec) => spec.id);
    this.mainBuildingId = buildings[0];
    this.craneDeliveries = [];

    const runtime = {
      pickTask: (character) => this.pickTask(character),
      pickIdleTask: (character) => {
        const task = this.pickTask(character);
        if (!task) return null;
        return task;
      },
      completeTask: (task, character) => this.completeTask(task, character),
      claimSpot: (character, spot) => {
        const claims = this.spotClaims.get(spot.node.id) || [];
        if (claims.length >= (spot.capacity || 2)) return null;
        claims.push(character.id);
        this.spotClaims.set(spot.node.id, claims);
        return spot.node.id;
      },
      releaseSpot: (character, nodeId) => {
        const claims = this.spotClaims.get(nodeId);
        if (!claims) return;
        const index = claims.indexOf(character.id);
        if (index >= 0) claims.splice(index, 1);
      },
      getBreakSpot: () => this.graph.get(this.config.characters.breakSpot || 'break-area'),
    };
    this.runtime = runtime;

    registerEntityFactories(this.manager, {
      kits: this.kits,
      scene: this.scene,
      bus: this.bus,
      lightRig: this.lightRig,
      lighting: this.lighting,
      construction: this.construction,
      graph: this.graph,
      navGrid: this.navGrid,
      runtime,
      rng: this.rng,
      routes: this.routes,
      config: this.config,
      sites: {},
      yards: {
        rebar: [this.config.laydown.rebarYard.center[0], this.config.laydown.rebarYard.center[1], 'rebar'],
        material: [this.config.laydown.materialYard.center[0], this.config.laydown.materialYard.center[1], 'pallet'],
      },
    });

    for (const spec of this.config.buildings) {
      const entity = this.manager.create('building', spec, { construction: this.construction });
      this.systems[`building:${spec.id}`] = entity;
    }
    // Give cranes their working building reference (main tower).
    const mainBuilding = this.manager.get(this.mainBuildingId);
    // Cranes read the live construction state through this reference.
    this.sites = { main: mainBuilding };

    for (const spec of this.config.cranes) {
      const entity = this.manager.create('crane', spec, {
        mainBuilding: this.manager.get(spec.building || this.mainBuildingId),
        yards: {
          rebar: [this.config.laydown.rebarYard.center[0], this.config.laydown.rebarYard.center[1], 'rebar'],
          material: [this.config.laydown.materialYard.center[0], this.config.laydown.materialYard.center[1], 'pallet'],
          wash: [this.config.laydown.concreteWash[0], this.config.laydown.concreteWash[1], 'concrete'],
          laydown: [22, -18, 'pipes'],
        },
      });
      this.systems[`crane:${spec.id}`] = entity;
    }
    void mainBuilding;

    for (const spec of this.config.vehicles) {
      this.manager.create('vehicle', this._withRouteLane(spec));
    }

    // Workers: roles are distributed by weight so the crew reads as a real gang.
    const characters = this.config.characters;
    const spawnTags = characters.spawnTags || ['site-entry'];
    const roles = this._expandRoles(characters.roles || [{ role: 'mason', weight: 1 }], characters.count || 8);
    for (let i = 0; i < (characters.count || 8); i++) {
      const tag = spawnTags[i % spawnTags.length];
      const candidates = this.graph.nodesWithTag(tag);
      const nodeId = candidates.length ? candidates[i % candidates.length] : 'site-entry';
      this.manager.create('character', {
        id: `worker-${String(i + 1).padStart(2, '0')}`,
        role: roles[i],
        homeNode: nodeId,
        speed: spawnRng.range(1.05, 1.45),
        drift: spawnRng.range(-0.6, 0.6),
        workHours: [7, 19],
      });
    }

    for (const spec of this.config.lights) {
      const isWork = spec.type === 'work';
      this.manager.create('light', {
        ...spec,
        pointLight: isWork ? spec.pointLight !== false : Boolean(spec.pointLight),
        intensity: isWork ? spec.intensity || 46 : spec.intensity || 22,
        distance: isWork ? spec.distance || 28 : spec.distance || 32,
      });
    }
    this.manager.create('prop', { id: 'blinker-1', kind: 'blinker', position: [0, 0, 24.5] });
    this.manager.create('prop', { id: 'blinker-2', kind: 'blinker', position: [0, 0, 27.5] });
  }

  _withRouteLane(spec) {
    const routeId = spec.lane ? `${spec.route}:${spec.lane}` : spec.route;
    return { ...spec, route: routeId };
  }

  _expandRoles(roleWeights, count) {
    const pool = [];
    for (const entry of roleWeights) {
      for (let i = 0; i < (entry.weight || 1); i++) pool.push(entry.role);
    }
    const result = [];
    for (let i = 0; i < count; i++) result.push(pool[i % pool.length]);
    return result;
  }

  _buildRuntime() {
    const self = this;
    this.runtimeCtx = {
      get characters() {
        return self.manager.all('character');
      },
      get vehicles() {
        return self.manager.all('vehicle');
      },
      get building() {
        return self.manager.get(self.mainBuildingId);
      },
      graph: this.graph,
      navGrid: this.navGrid,
      lighting: this.lighting,
      elapsed: 0,
      time: this.time,
      getFloorHeight: (x, z, currentY) => self.getFloorHeight(x, z, currentY),
      separationFromCharacters: (character, dt) => self.separateCharacter(character, dt),
    };
  }

  /** Vertical placement: inside a tower footprint a worker stands on the deck. */
  getFloorHeight(x, z, currentY = 1.06) {
    let best = 1.06;
    for (const building of this.manager.all('building')) {
      const geometry = building.geometry;
      const dx = x - geometry.position.x;
      const dz = z - geometry.position.z;
      const cos = Math.cos(-geometry.rotation);
      const sin = Math.sin(-geometry.rotation);
      const localX = dx * cos - dz * sin;
      const localZ = dx * sin + dz * cos;
      const [hx, hz] = geometry.half;
      if (Math.abs(localX) > hx - 0.3 || Math.abs(localZ) > hz - 0.3) continue;
      const state = building.state;
      const floorH = geometry.floorHeight;
      const maxFloor = state ? Math.max(state.floorsCompleted, building.spec.floors.existing) : building.spec.floors.existing;
      const currentFloor = Math.floor((currentY - geometry.position.y) / floorH);
      const wanted = state && state.activeFloor ? state.activeFloor : maxFloor;
      const floor = clamp(Math.max(currentFloor, 0), 0, Math.max(0, Math.min(wanted, maxFloor)));
      const y = geometry.position.y + floor * floorH + 0.1;
      if (y > best) best = y;
    }
    return best;
  }

  separateCharacter(character, dt) {
    const others = this.manager.all('character');
    const position = character.object3d.position;
    for (const other of others) {
      if (other === character) continue;
      const dx = position.x - other.object3d.position.x;
      const dz = position.z - other.object3d.position.z;
      const d2 = dx * dx + dz * dz;
      const radius = 0.62;
      if (d2 > radius * radius || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      const push = ((radius - d) / radius) * dt * 3.2;
      position.x += (dx / d) * push;
      position.z += (dz / d) * push;
    }
  }

  _wireEvents() {
    this.bus.on('construction:progress', ({ buildingId, state }) => {
      const building = this.manager.get(buildingId);
      if (building) building.plan.state = state;
      for (const crane of this.manager.all('crane')) {
        crane.refreshStations();
        crane.setActive(!state.complete && state.core > 0.02);
      }
    });
    this.bus.on('crane:delivered', ({ position, floor, load }) => {
      this.craneDeliveries.push({ position: position.clone(), floor, load, t: this.elapsed });
      if (this.craneDeliveries.length > 8) this.craneDeliveries.shift();
      this.bus.emit('construction:materialDelivered', { load, floor });
    });
    this.bus.on('weather:changed', ({ name }) => {
      this.bus.emit('world:weatherChanged', { name });
    });
    this.bus.on('character:delivered', ({ cargo }) => {
      this.lastDeliveredCargo = cargo;
    });
  }

  /** Advance the whole simulation by dt seconds of real time. */
  update(dt) {
    this.elapsed += dt;
    this.frame++;
    this.runtimeCtx.elapsed = this.elapsed;

    this.time.update(dt);
    this.construction.evaluate(false);

    // Camera first: the sky dome, shadow focus and light rig all read the camera
    // position, so updating it last would leave them one frame behind.
    if (this.camera) {
      this.camera.update(dt, this.runtimeCtx);
      this.lighting.setCameraPosition(this.camera.camera.position);
    }

    const weatherResponse = this.weather.update(dt, this.camera ? this.camera.camera : null);
    this.lighting.setWeatherResponse(weatherResponse);
    this.lighting.update(dt);

    this.manager.update(dt, this.runtimeCtx);
    this.lightRig.update(this.camera ? this.camera.camera : null, this.elapsed);
    this.audio.update(dt, {
      weather: {
        rainAmount: this.weather.rain ? this.weather.rain.count / Math.max(1, this.weather.rainCount) : 0,
        snowAmount: this.weather.snow ? this.weather.snow.count / Math.max(1, this.weather.snowCount) : 0,
        windSpeed: this.weather.windSpeed || 0,
      },
      time: this.time,
    });

    this.updateDebug();
  }

  attachCamera(cameraSystem) {
    this.camera = cameraSystem;
    cameraSystem.setEntityResolver((id, entities) => {
      if (this.manager) return this.manager.get(id);
      return entities ? entities.find((entity) => entity.id === id) : null;
    });
  }

  // ---------------------------------------------------------------- debug api
  getDebugState() {
    return this.debugFlags || this.config.debug || {};
  }

  setDebugEnabled(visible) {
    this.debug.setVisible(visible);
    this.debugEnabled = visible;
    if (!visible) this.debug.clearBoxes();
  }

  setDebugFlag(key, value) {
    this.debugFlags = this.debugFlags || { ...(this.config.debug || {}) };
    this.debugFlags[key] = value;
    return this.debugFlags;
  }

  updateDebug() {
    if (!this.debugEnabled) return;
    const flags = this.getDebugState();
    this.debug.beginFrame();
    if (flags.showRoadGraph) {
      for (const [id, route] of Object.entries(this.routes)) {
        if (id.includes(':')) continue;
        this.debug.setCurve(`road:${id}`, route.curve, { color: 0x63e6ff, offsetY: 1.2 });
        this.debug.setCurve(`road:${id}:inner`, this.routes[`${id}:inner`].curve, { color: 0x2f9fd0, offsetY: 1.2 });
        this.debug.setCurve(`road:${id}:outer`, this.routes[`${id}:outer`].curve, { color: 0x2f9fd0, offsetY: 1.2 });
      }
    }
    if (flags.showWaypoints) {
      const positions = [];
      for (const [id, edges] of this.graph.adjacency) {
        for (const edge of edges) {
          const a = this.graph.get(id).position;
          const b = this.graph.get(edge.to).position;
          positions.push(a.x, 1.3, a.z, b.x, 1.3, b.z);
        }
      }
      this.debug.setLine('nav-graph', positions, { color: 0x7ee08a, opacity: 0.5 });
    }
    if (flags.showPaths) {
      for (const character of this.manager.all('character')) {
        if (!character.path.length) continue;
        const positions = [];
        const start = character.object3d.position;
        positions.push(start.x, start.y + 0.1, start.z, character.path[Math.min(character.pathIndex, character.path.length - 1)].position.x, 1.3, character.path[Math.min(character.pathIndex, character.path.length - 1)].position.z);
        this.debug.setLine(`path:${character.id}`, positions, { color: 0xffd166 });
        this.debug.setMarker(`target:${character.id}`, new THREE.Vector3(character.targetPosition.x, 1.25, character.targetPosition.z), { color: 0xff8a3c, radius: 0.7 });
      }
    }
    if (flags.showBounds) {
      for (const entity of this.manager.all('crane')) this.debug.setBox(entity.id, entity.object3d, { color: 0xffd166 });
      for (const entity of this.manager.all('vehicle')) this.debug.setBox(entity.id, entity.object3d, { color: 0x7ee08a });
    }
  }

  setShadows(enabled) {
    this.quality.shadows = enabled;
    this.lighting.sun.castShadow = enabled;
    this.scene.scene.traverse((object) => {
      if (object.isMesh) object.castShadow = object.userData.wantsShadow !== false && enabled;
    });
  }

  setQuality(preset) {
    this.quality = { ...this.quality, ...preset };
    if (this.renderer) {
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, preset.pixelRatio || 1.5));
      this.renderer.shadowMap.enabled = preset.shadows !== false;
      // Only resize the shadow map when the caller actually asked for a size. A
      // partial preset (e.g. { pixelRatio, shadows: true }) leaves
      // preset.shadowMap undefined, and writing that into mapSize zeroes the
      // shadow render target. The framebuffer is then incomplete, the depth
      // texture never renders, and on real GPUs every lit surface samples as
      // fully shadowed — the whole scene turns black while the unlit sky dome
      // survives. Software rasterisers tolerate it, so it only shows up on real
      // hardware.
      const shadowMapSize = Number(preset.shadowMap);
      if (Number.isFinite(shadowMapSize) && shadowMapSize > 0 && this.lighting.sun.shadow.mapSize.width !== shadowMapSize) {
        this.lighting.sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
        if (this.lighting.sun.shadow.map) {
          this.lighting.sun.shadow.map.dispose();
          this.lighting.sun.shadow.map = null;
        }
      }
    }
    this.setShadows(preset.shadows !== false);
    this.bus.emit('quality:changed', { preset });
  }

  // ------------------------------------------------------------- system APIs
  scrubTo(day) {
    const clamped = clamp(day, this.time.timeline.from, this.time.timeline.to);
    this.time.setDay(clamped);
    this.construction.evaluate(true);
    for (const building of this.manager.all('building')) {
      if (building.plan.state) building.applyState(building.plan.state, true);
    }
    for (const crane of this.manager.all('crane')) {
      crane.refreshStations();
      const state = this.construction.state(this.mainBuildingId);
      crane.setActive(Boolean(state && !state.complete && state.core > 0.02));
    }
    this.lighting.apply(true);
    this.bus.emit('world:scrubbed', { day: clamped });
  }

  /** Aggregate live stats for HUD / debug panel. */
  getStats(snapshot = null) {
    const time = this.time;
    const construction = this.construction.snapshot();
    const main = construction[0] || {};
    const characters = this.manager.all('character');
    const stateCounts = {};
    for (const character of characters) {
      stateCounts[character.state] = (stateCounts[character.state] || 0) + 1;
    }
    return {
      day: time.day,
      clock: time.clock,
      speed: time.speed,
      paused: time.paused,
      weather: this.weather.current,
      wetness: Number(this.weather.wetness.toFixed(2)),
      snowCover: Number(this.weather.snowCover.toFixed(2)),
      stage: main.stage || '-',
      floors: main.floors || 0,
      targetFloors: main.target || 0,
      characters: characters.length,
      characterStates: stateCounts,
      vehicles: this.manager.all('vehicle').length,
      cranes: this.manager.all('crane').length,
      lights: this.manager.all('light').length,
      entities: this.manager.count(),
      staticInstances: this.worldStats ? this.worldStats.instances : 0,
      staticTriangles: this.worldStats ? this.worldStats.staticTriangles : 0,
      render: snapshot || null,
    };
  }

  getCraneStatus() {
    return this.manager.all('crane').map((crane) => ({
      id: crane.id,
      status: crane.status,
      load: crane.currentLoad ? crane.loadMass : 0,
    }));
  }

  getCrewStatus() {
    const crews = new Map();
    for (const character of this.manager.all('character')) {
      const key = character.role;
      if (!crews.has(key)) crews.set(key, { role: ROLES[key] ? ROLES[key].label : key, task: character.task ? character.task.id : '-', count: 0 });
      const entry = crews.get(key);
      entry.count++;
      if (character.task) entry.task = character.task.id;
    }
    return [...crews.values()];
  }

  getFollowCandidates() {
    return [
      ...this.manager.all('character').slice(0, 6).map((entity) => ({ id: entity.id, label: `${entity.id} ${entity.roleInfo.label}` })),
      ...this.manager.all('vehicle').map((entity) => ({ id: entity.id, label: `${entity.id} ${entity.profile.label}` })),
      ...this.manager.all('crane').map((entity) => ({ id: entity.id, label: `${entity.id} 塔吊` })),
    ];
  }

  /** Detailed text for the F2 overlay. */
  buildDebugText(stats) {
    const lines = [];
    const render = stats.render || {};
    lines.push(`DAY ${String(Math.floor(this.time.day)).padStart(2, '0')}  ${this.time.clock}  x${this.time.speed}${this.time.paused ? ' (paused)' : ''}`);
    lines.push(`weather=${this.weather.current} wet=${stats.wetness} snow=${stats.snowCover} wind=${(this.weather.windSpeed || 0).toFixed(1)}`);
    if (render.fps !== undefined) {
      lines.push(`fps=${Math.round(render.fps)} calls=${render.drawCalls} tris=${(render.triangles / 1e6).toFixed(2)}M progs=${render.programs ?? '-'}`);
    }
    lines.push(`entities=${stats.entities} staticInstances=${stats.staticInstances} staticTris=${Math.round(stats.staticTriangles / 1000)}k`);
    lines.push(`build=${stats.stage} ${stats.floors}/${stats.targetFloors}F`);
    lines.push('');
    lines.push('--- cranes ---');
    for (const crane of this.manager.all('crane')) {
      const info = crane.getDebugInfo();
      lines.push(`${info.id} ${info.state} slew=${info.slew} trolley=${info.trolley} hook=${info.hookY} load=${info.load} cycles=${info.cycles} -> ${info.target}`);
    }
    lines.push('');
    lines.push('--- vehicles ---');
    for (const vehicle of this.manager.all('vehicle')) {
      const info = vehicle.getDebugInfo();
      lines.push(`${info.id} ${info.kind} ${info.state} v=${info.speed} route=${info.route} t=${info.t} stop=${info.stop}`);
    }
    lines.push('');
    lines.push('--- crew ---');
    lines.push(`states: ${Object.entries(stats.characterStates).map(([k, v]) => `${k}:${v}`).join(' ')}`);
    for (const character of this.manager.all('character')) {
      const info = character.getDebugInfo();
      lines.push(`${info.id} ${info.role} ${info.state} task=${info.task} carry=${info.carrying} path=${info.path.length ? info.path.join('>') : '-'}`);
    }
    lines.push('');
    lines.push('--- lights ---');
    lines.push(`streetLights=${this.lighting.streetLightsOn ? 'ON' : 'OFF'} night=${this.lighting.nightFactor.toFixed(2)} lamps=${this.lighting.workLamps.length}`);
    if (this.camera) {
      const info = this.camera.getInfo();
      lines.push(`camera=${info.mode} preset=${info.preset || '-'} dist=${info.distance.toFixed(1)} target=[${info.target.join(', ')}]`);
    }
    return lines.join('\n');
  }

  /** Workers pick tasks from here; ConstructionSystem drives what is available. */
  pickTask(character) {
    const construction = this.construction;
    const state = construction.state(this.mainBuildingId);
    const day = this.time.day;
    const role = character.role;
    const graph = this.graph;
    const nodeById = (id) => graph.get(id);
    const workSpot = (id, capacity = 2) => {
      const node = nodeById(id);
      if (!node) return null;
      const claims = this.spotClaims.get(id) || [];
      void claims;
      return { node, capacity };
    };
    const building = this.manager.get(this.mainBuildingId);
    const floorSpot = (side) => {
      if (!building || !state) return null;
      const node = nodeById(side === 'south' ? 'tower-floor' : side === 'east' ? 'tower-facade' : 'tower-base');
      if (!node) return null;
      const world = building.geometry.floorWorkPoint(state.activeFloor, side === 'south' ? 'south' : side, new THREE.Vector3());
      return { node, capacity: 3, position: world };
    };

    const baseTasks = this.config.characters.tasks || [];
    const taskById = (id) => baseTasks.find((task) => task.id === id);
    const makeTask = (id, overrides = {}) => {
      const def = taskById(id);
      if (!def) return null;
      const spot = overrides.spot || null;
      return {
        id,
        label: def.label,
        kind: overrides.kind || 'work',
        duration: overrides.duration || def.duration || 12,
        spot,
        position: overrides.position || (spot ? spot.node.position.clone().setY(1.06) : new THREE.Vector3()),
        cargo: overrides.cargo || null,
        arriveRadius: overrides.arriveRadius || 1.5,
        phase: overrides.phase || 'work',
      };
    };

    const pick = (list) => (list.length ? list[Math.floor(Math.random() * list.length)] : null);
    const night = !this.time.isWorkHours;

    if (night) {
      const breakNode = nodeById(this.config.characters.breakSpot || 'break-area');
      if (breakNode) {
        return { id: 'rest', label: '休息', kind: 'work', duration: 16, spot: { node: breakNode, capacity: 6 }, position: breakNode.position.clone(), cargo: null, arriveRadius: 2.2, phase: 'work' };
      }
    }

    const coreActive = state && !state.complete && state.core > 0.02;
    const candidates = [];

    if (coreActive) {
      const rebarYard = nodeById('rebar-yard');
      const materialYard = nodeById('material-yard');
      if (rebarYard && (role === 'rebar' || role === 'mason' || role === 'foreman')) {
        candidates.push(makeTask('rebar-carry', {
          kind: 'carry',
          spot: { node: rebarYard, capacity: 3 },
          cargo: 'rebar',
          phase: 'fetch',
          duration: 6,
        }));
      }
      if (materialYard && (role === 'mason' || role === 'electrician')) {
        candidates.push(makeTask('material', {
          kind: 'carry',
          spot: { node: materialYard, capacity: 3 },
          cargo: 'pallet',
          phase: 'fetch',
          duration: 5,
        }));
      }
      const pourSpot = floorSpot('south');
      if (pourSpot && (role === 'mason' || role === 'foreman')) {
        candidates.push(makeTask('slab-pour', { spot: pourSpot, position: pourSpot.position, duration: 18 }));
      }
      if (pourSpot && role === 'mason') {
        candidates.push(makeTask('masonry', { spot: floorSpot('east') || pourSpot, position: (floorSpot('east') || pourSpot).position, duration: 22 }));
      }
      if (role === 'craneSignal') {
        const signal = nodeById('crane-a-signal');
        if (signal) candidates.push(makeTask('signal', { spot: { node: signal, capacity: 1 }, duration: 24 }));
      }
      if (role === 'surveyor') {
        const base = nodeById('tower-base');
        if (base) candidates.push(makeTask('survey', { spot: { node: base, capacity: 1 }, duration: 16 }));
      }
      if (role === 'electrician') {
        const power = nodeById('power-box');
        if (power) candidates.push(makeTask('wiring', { spot: { node: power, capacity: 1 }, duration: 15 }));
      }
    }

    if (role === 'driver') {
      const wash = nodeById('wash-point');
      if (wash) candidates.push(makeTask('material', { kind: 'work', spot: { node: wash, capacity: 1 }, duration: 12, cargo: null }));
    }
    if (role === 'foreman' || role === 'surveyor') {
      const patrol = nodeById('inspector-1');
      if (patrol) candidates.push(makeTask('patrol', { id: 'patrol', kind: 'work', spot: { node: patrol, capacity: 2 }, duration: 18 }));
    }
    if (!candidates.length) {
      const fallback = nodeById('break-area') || nodeById('site-entry');
      if (fallback) {
        return {
          id: 'patrol',
          label: '巡检',
          kind: 'work',
          duration: 12,
          spot: { node: fallback, capacity: 4 },
          position: fallback.position.clone(),
          cargo: null,
          arriveRadius: 2.0,
          phase: 'work',
        };
      }
      return null;
    }
    // Prefer tasks that still have capacity.
    const open = candidates.filter((task) => {
      if (!task.spot) return true;
      const claims = this.spotClaims.get(task.spot.node.id) || [];
      return claims.length < (task.spot.capacity || 2);
    });
    const chosen = pick(open.length ? open : candidates);
    void day;
    void lerp;
    void distance2;
    void remap;
    void clamp01;
    return chosen;
  }

  completeTask(task, character) {
    void character;
    if (!task) return;
    this.bus.emit('task:completed', { id: task.id, character: character ? character.id : null });
  }

  dispose() {
    this.manager.disposeAll();
    this.lightRig.dispose();
    this.kits.dispose();
  }
}
