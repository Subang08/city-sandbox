/**
 * Proves the frontend actually received and applied its config data.
 * Reads the live world state out of the running page - if the three JSON configs
 * had failed to load, the app would not have booted at all and these values
 * would be missing.
 *
 *   node tools/verify-data.mjs [--url http://127.0.0.1:5173/]
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const args = process.argv.slice(2);
const index = args.indexOf('--url');
const target = index >= 0 && args[index + 1] ? args[index + 1] : 'http://127.0.0.1:5173/';
const port = 9421;

const browserPath = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((candidate) => existsSync(candidate));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(browserPath, [
  '--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader', '--no-first-run',
  '--disable-extensions', '--hide-scrollbars', '--window-size=1000,600',
  `--remote-debugging-port=${port}`, `--user-data-dir=${process.env.TEMP}\\cdp-data-${Date.now()}`,
  'about:blank',
], { stdio: 'ignore' });

let ws;
let id = 0;
const pending = new Map();
const network = [];
const send = (method, params = {}, sessionId) =>
  new Promise((res, rej) => {
    const messageId = ++id;
    pending.set(messageId, { res, rej });
    ws.send(JSON.stringify({ id: messageId, method, params, ...(sessionId ? { sessionId } : {}) }));
    setTimeout(() => pending.has(messageId) && (pending.delete(messageId), rej(new Error(`timeout ${method}`))), 25000);
  });

try {
  let wsUrl = null;
  for (let i = 0; i < 40 && !wsUrl; i++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) wsUrl = (await response.json()).webSocketDebuggerUrl;
    } catch { /* retry */ }
    if (!wsUrl) await sleep(400);
  }
  ws = new WebSocket(wsUrl);
  await new Promise((res) => ws.addEventListener('open', res, { once: true }));
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const entry = pending.get(message.id);
      pending.delete(message.id);
      message.error ? entry.rej(new Error(message.error.message)) : entry.res(message.result);
      return;
    }
    if (message.method === 'Network.responseReceived') {
      const { url, status, mimeType } = message.params.response;
      if (/\.(json|js|css|html)$/.test(url) || url.endsWith('/')) {
        network.push({ url: url.replace(/^https?:\/\/[^/]+/, ''), status, mimeType });
      }
    }
  });

  const session = (await send('Target.attachToTarget', {
    targetId: (await send('Target.createTarget', { url: 'about:blank' })).targetId,
    flatten: true,
  })).sessionId;
  await send('Runtime.enable', {}, session);
  await send('Page.enable', {}, session);
  await send('Network.enable', {}, session);
  await send('Page.navigate', { url: target }, session);

  for (let i = 0; i < 40; i++) {
    await sleep(400);
    const ready = await send('Runtime.evaluate', { expression: 'Boolean(window.__CITY__)', returnByValue: true }, session);
    if (ready.result?.value) break;
  }

  const result = await send('Runtime.evaluate', {
    expression: `JSON.stringify((() => {
      const app = window.__CITY__;
      if (!app) return { booted: false };
      const world = app.world;
      return {
        booted: true,
        origin: location.origin,
        // Config data that could only exist if the three JSON fetches succeeded.
        configSeed: app.config.seed,
        configRoads: app.config.roads.map((r) => r.id),
        configBuildings: app.config.buildings.map((b) => ({ id: b.id, floors: b.floors.target })),
        configWeatherPresets: Object.keys(app.config.weather.presets),
        configTrades: app.world.construction.trades.length,
        // Live world built from that data.
        entities: world.manager.count(),
        workers: world.manager.all('character').length,
        vehicles: world.manager.all('vehicle').length,
        cranes: world.manager.all('crane').length,
        waypointNodes: world.graph.nodes.size,
        routeCount: Object.keys(world.routes).length,
        buildingFloors: world.manager.get(world.mainBuildingId).state.floorsCompleted,
        textures: app.world.textures ? app.world.textures.stats.created : 0,
      };
    })())`,
    returnByValue: true,
  }, session);

  console.log(`URL : ${target}`);
  console.log('');
  console.log('=== 网络请求 (静态资源) ===');
  for (const entry of network.slice(0, 20)) {
    console.log(`  ${String(entry.status).padEnd(4)} ${entry.mimeType.padEnd(24)} ${entry.url}`);
  }
  console.log('');
  console.log('=== 页面内实际拿到的数据 ===');
  console.log(JSON.stringify(JSON.parse(result.result.value), null, 2));
} catch (error) {
  console.error('verify failed:', error.message);
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch { /* ignore */ }
  child.kill();
}
