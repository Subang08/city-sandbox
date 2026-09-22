/**
 * Probes the real diorama's framebuffer from inside a GPU-accelerated frame.
 * Read-allowed: the default framebuffer is only valid before compositing clears it.
 *
 *   node tools/probe-scene.mjs [--url ...] [--gpu]
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const target = argValue('--url', 'http://127.0.0.1:5173/?day=9&minute=660&theta=0.9&phi=1.28&radius=32');
const useGpu = args.includes('--gpu');
const port = Number(argValue('--port', 9388));
const out = argValue('--out', '.verify/scene-probe.png');

const browserPath = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((candidate) => existsSync(candidate));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(browserPath, [
  '--headless=new',
  ...(useGpu ? [] : ['--disable-gpu', '--enable-unsafe-swiftshader']),
  '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars',
  '--window-size=1400,800', `--remote-debugging-port=${port}`,
  `--user-data-dir=${process.env.TEMP}\\cdp-scene-${Date.now()}`, 'about:blank',
], { stdio: 'ignore' });

let ws;
let id = 0;
const pending = new Map();
const send = (method, params = {}, sessionId) =>
  new Promise((res, rej) => {
    const messageId = ++id;
    pending.set(messageId, { res, rej });
    ws.send(JSON.stringify({ id: messageId, method, params, ...(sessionId ? { sessionId } : {}) }));
    setTimeout(() => pending.has(messageId) && (pending.delete(messageId), rej(new Error(`timeout ${method}`))), 30000);
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
    }
  });
  const session = (await send('Target.attachToTarget', {
    targetId: (await send('Target.createTarget', { url: 'about:blank' })).targetId,
    flatten: true,
  })).sessionId;
  await send('Runtime.enable', {}, session);
  await send('Page.enable', {}, session);
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 800, deviceScaleFactor: 1, mobile: false }, session);
  await send('Page.navigate', { url: target }, session);

  for (let i = 0; i < 50; i++) {
    await sleep(400);
    const ready = await send('Runtime.evaluate', { expression: 'Boolean(window.__CITY__)', returnByValue: true }, session);
    if (ready.result?.value) break;
  }

  // If the app never booted, report exactly why: the boot card shows the error.
  const bootState = await send('Runtime.evaluate', {
    expression: `JSON.stringify({
      city: Boolean(window.__CITY__),
      bootError: (document.querySelector('.boot-error') || {}).textContent || null,
      bootSteps: [...document.querySelectorAll('.boot-step')].map((n) => n.textContent),
      shaderFailure: window.__SHADER_FAILURE__ || null,
    })`,
    returnByValue: true,
  }, session);
  console.log('boot state:', bootState.result?.value);

  // Hook the render loop for exactly one frame and sample the real framebuffer.
  const script = `(() => {
    const app = window.__CITY__;
    const renderer = app.engine.renderer;
    const gl = renderer.getContext();
    const probe = {
      renderer: gl.getParameter(gl.RENDERER),
      vendor: gl.getParameter(gl.VENDOR),
      glVersion: renderer.capabilities.isWebGL2 ? 2 : 1,
      drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
    };
    return new Promise((resolve) => {
      let done = false;
      const originalRender = renderer.render.bind(renderer);
      renderer.render = (scene, camera) => {
        originalRender(scene, camera);
        if (done) return;
        done = true;
        const read = (fx, fy) => {
          const pixel = new Uint8Array(4);
          gl.readPixels(Math.floor(gl.drawingBufferWidth * fx), Math.floor(gl.drawingBufferHeight * fy), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
          return [pixel[0], pixel[1], pixel[2]];
        };
        const stats = app.renderStats || {};
        resolve({
          ...probe,
          glError: gl.getError(),
          calls: renderer.info.render.calls,
          triangles: renderer.info.render.triangles,
          floors: app.world.manager.get(app.world.mainBuildingId).state.floorsCompleted,
          clockChip: (document.querySelector('.chip-stats') || {}).textContent,
          samples: {
            buildingFacade: read(0.42, 0.52),
            buildingUpper: read(0.44, 0.72),
            ground: read(0.30, 0.30),
            road: read(0.20, 0.22),
            sky: read(0.30, 0.95),
            hazard: read(0.55, 0.35),
          },
          stats,
        });
      };
      setTimeout(() => { if (!done) resolve({ ...probe, timeout: true }); }, 15000);
    });
  })()`;

  const result = await send('Runtime.evaluate', { expression: script, returnByValue: true, awaitPromise: true }, session);
  console.log(`mode: ${useGpu ? 'real GPU' : 'software (SwiftShader)'}`);
  console.log(JSON.stringify(result.result?.value ?? result.exceptionDetails, null, 2));

  await sleep(300);
  const shot = await send('Page.captureScreenshot', { format: 'png' }, session);
  mkdirSync(out.replace(/[\\/][^\\/]+$/, '') || '.verify', { recursive: true });
  writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log(`screenshot -> ${out}`);
} catch (error) {
  console.error('scene probe failed:', error.message);
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch { /* ignore */ }
  child.kill();
}
