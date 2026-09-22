import { readFileSync } from 'node:fs';
import { World } from '../src/World.js';

const load = (p) => JSON.parse(readFileSync(p, 'utf8'));
const world = new World({
  config: load('config/scene.json'),
  weatherPresets: load('config/weather.json'),
  lightingPalettes: load('config/lighting.json'),
});
world.time.setPaused(true);
for (const minute of [0, 240, 360, 450, 720, 1020, 1230, 1320, 1439]) {
  world.time.setMinuteOfDay(minute);
  world.lighting.apply(true);
  console.log(
    String(minute).padStart(4),
    'night=', world.lighting.nightFactor.toFixed(2),
    'sunY=', world.lighting.sunElevation().toFixed(2),
    'sunInt=', world.lighting.sun.intensity.toFixed(2),
    'street=', world.lighting.streetLightsOn,
  );
}
