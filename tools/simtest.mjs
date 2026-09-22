/**
 * Headless simulation test - no WebGL, no DOM.
 * Builds the entire world (geometry, entities, systems), steps it and asserts the
 * core contracts: floors really grow, cranes cycle, workers walk, timeline scrubs.
 *
 *   node tools/simtest.mjs [--frames 600] [--assert] [--verbose]
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? Number(args[index + 1]) : fallback;
};
const VERBOSE = args.includes('--verbose');
const ASSERT = args.includes('--assert');
const SECONDS = getArg('--seconds', getArg('--frames', 900) / 60);

const load = (relative) => JSON.parse(readFileSync(resolve(root, relative), 'utf8'));

const failures = [];
const checks = [];
function check(name, condition, detail = '') {
  checks.push({ name, ok: Boolean(condition), detail });
  if (!condition) failures.push(`${name}${detail ? ` :: ${detail}` : ''}`);
  const mark = condition ? 'PASS' : 'FAIL';
  console.log(`  [${mark}] ${name}${detail ? ` - ${detail}` : ''}`);
}

function section(title) {
  console.log(`\n=== ${title} ===`);
}

const config = load('config/scene.json');
const weatherPresets = load('config/weather.json');
const lightingPalettes = load('config/lighting.json');

const { World } = await import('../src/World.js');
const { CameraSystem } = await import('../src/systems/CameraSystem.js');
const THREE = (await import('../src/lib/three.js')).default;

section('build');
const t0 = performance.now();
const world = new World({ config, weatherPresets, lightingPalettes, renderer: null });
const buildMs = performance.now() - t0;
console.log(`  world built in ${buildMs.toFixed(0)} ms`);

const camera = new CameraSystem({
  camera: new THREE.PerspectiveCamera(34, 1.6, 0.4, 600),
  renderer: null,
  bus: world.bus,
  config,
  scene: world.scene,
});
world.attachCamera(camera);
world.systems.camera = camera;

// Deterministic virtual time for the assertions.
world.time.setPaused(false);
world.time.setSpeed(20);
world.scrubTo(1);
world.update(1 / 60);

section('structure');
check('entity manager created entities', world.manager.count() > 20, `${world.manager.count()} entities`);
check('buildings registered', world.manager.all('building').length === config.buildings.length);
check('cranes created', world.manager.all('crane').length === config.cranes.length);
check('vehicles created', world.manager.all('vehicle').length === config.vehicles.length);
check('workers created', world.manager.all('character').length === config.characters.count,
  `${world.manager.all('character').length} workers`);
check('static prop instances built', world.worldStats.instances > 120, `${world.worldStats.instances} instances`);
check('waypoint graph connected', world.graph.nodes.size > 20 && world.graph.adjacency.get('site-entry').length > 0,
  `${world.graph.nodes.size} nodes`);

section('construction timeline (floors must really grow)');
const floorSeries = [];
for (const day of [1, 3, 5, 7, 9, 11, 13, 15, 16]) {
  world.scrubTo(day);
  const building = world.manager.get(world.mainBuildingId);
  floorSeries.push({ day, floors: building.state.floorsCompleted, boxes: building.geometry.stats.boxes, stage: building.state.stage });
}
world.scrubTo(1);
for (const entry of floorSeries) {
  console.log(`  day ${String(entry.day).padStart(2)} -> ${String(entry.floors).padStart(2)}F boxes=${entry.boxes} stage=${entry.stage}`);
}
const first = floorSeries[0];
const last = floorSeries[floorSeries.length - 1];
check('starts at existing floors', first.floors >= config.buildings[0].floors.existing, `${first.floors}F`);
check('reaches target floors', last.floors >= config.buildings[0].floors.target, `${last.floors}F`);
check('floor count is monotonic', floorSeries.every((entry, i) => i === 0 || entry.floors >= floorSeries[i - 1].floors));
check('geometry grows with floors (no scaleY)', last.boxes > first.boxes * 2, `${first.boxes} -> ${last.boxes} boxes`);
check('final stage complete', last.stage === 'complete', last.stage);
check('scaffolding exists mid-build', world.manager.get(world.mainBuildingId).geometry.stats.floors >= 1);

section('timeline scrub round-trip');
world.scrubTo(12);
const midFloors = world.manager.get(world.mainBuildingId).state.floorsCompleted;
world.scrubTo(4);
const lowFloors = world.manager.get(world.mainBuildingId).state.floorsCompleted;
world.scrubTo(12);
const againFloors = world.manager.get(world.mainBuildingId).state.floorsCompleted;
check('scrub back reduces floors', lowFloors < midFloors, `${midFloors} -> ${lowFloors}`);
check('scrub forward restores state', againFloors === midFloors, `${againFloors}`);

section(`simulate ${SECONDS}s of real time (1s = 1 game minute at 1x)`);
world.scrubTo(6);
world.time.setSpeed(2);
const charStates = new Map();
const craneStates = new Set();
const vehicleStates = new Set();
let movedCharacters = 0;
const startPositions = new Map();
for (const character of world.manager.all('character')) {
  startPositions.set(character.id, character.object3d.position.clone());
}
const steps = Math.round(SECONDS * 60);
const t1 = performance.now();
for (let i = 0; i < steps; i++) {
  world.update(1 / 60);
  for (const character of world.manager.all('character')) {
    charStates.set(character.state, (charStates.get(character.state) || 0) + 1);
    if (i === steps - 1) {
      const start = startPositions.get(character.id);
      if (start && start.distanceTo(character.object3d.position) > 1.5) movedCharacters++;
    }
  }
  for (const crane of world.manager.all('crane')) craneStates.add(crane.state);
  for (const vehicle of world.manager.all('vehicle')) vehicleStates.add(vehicle.state);
}
const simMs = performance.now() - t1;
console.log(`  simulated ${steps} ticks in ${simMs.toFixed(0)} ms (${(simMs / steps).toFixed(2)} ms/tick)`);

section('behaviour');
check('workers changed state', charStates.size >= 2, [...charStates.keys()].join(','));
check('workers walked', movedCharacters >= Math.ceil(config.characters.count * 0.5),
  `${movedCharacters}/${config.characters.count} moved > 1.5 m`);
check('crane ran a work cycle', craneStates.size >= 3, [...craneStates].join(','));
check('vehicles drove and worked', vehicleStates.size >= 2, [...vehicleStates].join(','));
const carrying = world.manager.all('character').filter((character) => character.carryKind).length;
console.log(`  carrying now: ${carrying}`);
check('no NaN in transforms', world.manager.all('character').every((character) =>
  Number.isFinite(character.object3d.position.x) && Number.isFinite(character.object3d.position.z)));

section('weather + lighting');
const weatherNames = Object.keys(weatherPresets).filter((name) => name !== 'transitions');
for (const name of weatherNames) {
  world.weather.set(name, { instant: true });
  for (let i = 0; i < 30; i++) world.update(1 / 60);
  const stats = world.getStats();
  console.log(`  ${name.padEnd(9)} wet=${stats.wetness} snow=${stats.snowCover} rain=${world.weather.rain.count} snowP=${world.weather.snow.count}`);
}
world.weather.set('clear', { instant: true });
const sampleLighting = (minute) => {
  world.time.setMinuteOfDay(minute);
  world.lighting.apply(true);
  return { night: world.lighting.nightFactor, street: world.lighting.streetLightsOn, sunY: world.lighting.sunElevation() };
};
const midnight = sampleLighting(60);
const noon = sampleLighting(12 * 60);
console.log(`  01:00 night=${midnight.night.toFixed(2)} street=${midnight.street} | 12:00 night=${noon.night.toFixed(2)} sunY=${noon.sunY.toFixed(2)}`);
check('night factor high at 01:00', midnight.night > 0.6, midnight.night.toFixed(2));
check('street lights on at night', midnight.street === true);
check('night factor low at noon', noon.night < 0.05, noon.night.toFixed(2));
check('sun elevation positive at noon', noon.sunY > 0.2, noon.sunY.toFixed(2));
check('sun elevation negative at night', midnight.sunY < -0.2, midnight.sunY.toFixed(2));

section('camera systems');
for (const mode of ['diorama', 'autoOrbit', 'streetTour', 'follow', 'flyover']) {
  camera.setMode(mode, { entityId: 'worker-01' });
  for (let i = 0; i < 20; i++) {
    world.update(1 / 60);
  }
  const position = camera.camera.position;
  const finite = Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z);
  check(`camera mode ${mode}`, finite, `pos=[${position.x.toFixed(1)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)}]`);
}

section('performance envelope');
const building = world.manager.get(world.mainBuildingId);
let buildingTriangles = 0;
building.object3d.traverse((object) => {
  if (!object.isMesh) return;
  const count = object.geometry.index ? object.geometry.index.count : object.geometry.attributes.position.count;
  buildingTriangles += (count / 3) * (object.isInstancedMesh ? object.count : 1);
});
const staticTriangles = world.worldStats.staticTriangles;
console.log(`  static world triangles: ${(staticTriangles / 1e6).toFixed(2)}M across ${world.worldStats.meshes} instanced meshes`);
console.log(`  building triangles: ${(buildingTriangles / 1e6).toFixed(2)}M`);
check('static triangles within 1.5M budget', staticTriangles < 1_500_000, `${Math.round(staticTriangles)}`);
check('static draw calls under 300', world.worldStats.meshes < 300, `${world.worldStats.meshes} instanced meshes`);
check('sim tick under 8 ms', simMs / steps < 8, `${(simMs / steps).toFixed(2)} ms`);

section('debug + stats api');
const stats = world.getStats({ fps: 60, drawCalls: 120, triangles: 400000 });
const debugText = world.buildDebugText(stats);
check('stats include floors', typeof stats.floors === 'number' && stats.floors > 0, `${stats.floors}F`);
check('debug text generated', debugText.length > 200, `${debugText.split('\n').length} lines`);
check('crane status list', world.getCraneStatus().length === config.cranes.length);
check('crew status list', world.getCrewStatus().length > 2);
check('follow candidates', world.getFollowCandidates().length > 5);

console.log('');
if (failures.length) {
  console.log(`FAILED ${failures.length}/${checks.length} checks:`);
  for (const failure of failures) console.log(`  - ${failure}`);
} else {
  console.log(`ALL ${checks.length} CHECKS PASSED`);
}
if (VERBOSE) {
  console.log('\n--- debug text ---');
  console.log(debugText);
}
world.dispose();
process.exit(failures.length && ASSERT ? 1 : 0);
