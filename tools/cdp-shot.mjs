/**
 * CDP verification: drives real Edge/Chrome headless over the DevTools protocol.
 * Captures a screenshot AND the live in-page state (entity counts, render stats,
 * UI presence, console errors) - far stronger evidence than a bare screenshot.
 *
 *   node tools/cdp-shot.mjs [--url ...] [--out .verify/shot.png]
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const URL_TARGET = argValue('--url', 'http://127.0.0.1:5188/?day=6&minute=560&paused=1');
const OUT = resolve(argValue('--out', '.verify/shot-day.png'));
const PORT = Number(argValue('--port', 9333));
const WIDTH = Number(argValue('--width', 1600));
const HEIGHT = Number(argValue('--height', 900));

const CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];
const browserPath = CANDIDATES.find((candidate) => existsSync(candidate));
if (!browserPath) {
  console.error('no chromium browser found');
  process.exit(1);
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const profile = resolve(process.env.TEMP || '.', `cdp-diorama-${Date.now()}`);

const child = spawn(browserPath, [
  // --headful reproduces exactly what a user sees: a real window, real GPU
  // compositor, real swap chain. Headless GPU/canvas compositing differs and is
  // not representative of the browser the user actually runs.
  ...(args.includes('--headful') ? ['--window-position=0,0'] : ['--headless=new']),
  // --gpu switches to the real D3D11 device instead of SwiftShader.
  ...(args.includes('--gpu') || args.includes('--headful') ? [] : ['--disable-gpu', '--enable-unsafe-swiftshader']),
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--disable-sync',
  '--hide-scrollbars',
  '--mute-audio',
  `--window-size=${WIDTH},${HEIGHT}`,
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  'about:blank',
], { stdio: 'ignore', detached: false });

let ws = null;
let messageId = 0;
const pending = new Map();
const consoleErrors = [];
const pageErrors = [];

function send(method, params = {}, sessionId = null) {
  const id = ++messageId;
  return new Promise((res, rej) => {
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        rej(new Error(`timeout: ${method}`));
      }
    }, 45000);
  });
}

async function connect() {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (response.ok) {
        const version = await response.json();
        return version.webSocketDebuggerUrl;
      }
    } catch {
      /* keep waiting */
    }
    await sleep(400);
  }
  throw new Error('devtools endpoint never came up');
}

const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (result.exceptionDetails) return { error: result.exceptionDetails.text };
  return result.result ? result.result.value : null;
};

let sessionId = null;

try {
  const wsUrl = await connect();
  ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });

  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const entry = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) entry.rej(new Error(message.error.message));
      else entry.res(message.result);
      return;
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      consoleErrors.push(message.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '));
    }
    if (message.method === 'Runtime.exceptionThrown') {
      const details = message.params.exceptionDetails;
      pageErrors.push(details.exception?.description || details.text);
    }
  });

  // The browser-level endpoint needs a target session for Page/Runtime commands.
  const target = await send('Target.createTarget', { url: 'about:blank' });
  const attached = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  sessionId = attached.sessionId;
  console.log(`attached session ${sessionId.slice(0, 8)}`);

  await send('Page.enable', {}, sessionId);
  await send('Runtime.enable', {}, sessionId);
  await send('Log.enable', {}, sessionId);
  await send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH,
    height: HEIGHT,
    deviceScaleFactor: 1,
    mobile: false,
  }, sessionId);

  console.log(`navigating -> ${URL_TARGET}`);
  await send('Page.navigate', { url: URL_TARGET }, sessionId);

  // Headless has no compositor vsync: requestAnimationFrame stays parked unless the
  // virtual time policy is advanced explicitly. Drive two budgets so the world really
  // simulates (otherwise we would only screenshot the constructor's initial state).
  const advanceFrames = async (budgetMs, label) => {
    try {
      await send('Emulation.setVirtualTimePolicy', {
        policy: 'pauseIfNetworkFetchesPending',
        budget: budgetMs,
        maxVirtualTimeTaskStarvationCount: 10000,
      }, sessionId);
      const expired = await new Promise((res) => {
        const timer = setTimeout(() => res(false), budgetMs + 20000);
        const listener = (event) => {
          const message = JSON.parse(event.data);
          if (message.method === 'Emulation.virtualTimeBudgetExpired') {
            clearTimeout(timer);
            ws.removeEventListener('message', listener);
            res(true);
          }
        };
        ws.addEventListener('message', listener);
      });
      console.log(`  virtual time budget ${budgetMs}ms (${label}) expired=${expired}`);
    } catch (error) {
      console.log(`  virtual time unavailable (${error.message}); falling back to sleep`);
      await sleep(budgetMs);
    }
  };

  // Wait for the app to report readiness (window.__CITY__) or time out.
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    await sleep(400);
    const state = await evaluate('Boolean(window.__CITY__ && window.__CITY__.world && window.__CITY__.ui)');
    if (state === true) {
      ready = true;
      break;
    }
  }
  console.log(`app ready: ${ready}`);
  await advanceFrames(1200, 'boot');
  await advanceFrames(9000, 'simulate');

  const probe = await evaluate(`(() => {
    const app = window.__CITY__;
    if (!app) return { ready: false, boot: document.getElementById('boot') ? document.getElementById('boot').innerText.slice(0, 400) : null };
    const world = app.world;
    const stats = app.renderStats || {};
    const canvas = document.getElementById('viewport');
    const ui = {
      topbar: Boolean(document.querySelector('.topbar')),
      panels: document.querySelectorAll('.panel').length,
      panelTitles: [...document.querySelectorAll('.panel-title')].map((n) => n.textContent),
      timeline: Boolean(document.querySelector('.timeline')),
      cameraButtons: document.querySelectorAll('.quick-btn').length,
      toasts: document.querySelectorAll('.toast').length,
      chips: [...document.querySelectorAll('.topbar-right .chip')].map((n) => n.textContent.trim()),
    };
    return {
      ready: true,
      entityCount: world.manager.count(),
      workers: world.manager.all('character').length,
      vehicles: world.manager.all('vehicle').length,
      cranes: world.manager.all('crane').length,
      lights: world.manager.all('light').length,
      floors: world.manager.get(world.mainBuildingId).state.floorsCompleted,
      stage: world.manager.get(world.mainBuildingId).state.stage,
      day: world.time.day,
      clock: world.time.clock,
      weather: world.weather.current,
      nightFactor: world.lighting.nightFactor,
      streetLights: world.lighting.streetLightsOn,
      cameraMode: app.camera.mode,
      render: { calls: stats.drawCalls, triangles: stats.triangles, fps: stats.fps ? Math.round(stats.fps) : null },
      canvas: { width: canvas.width, height: canvas.height, cssW: canvas.clientWidth, cssH: canvas.clientHeight },
      gl: (() => { try { return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl')); } catch { return 'ctx-taken'; } })(),
      canvasPixel: (() => {
        try {
          const gl = app.engine.renderer.getContext();
          const width = gl.drawingBufferWidth;
          const height = gl.drawingBufferHeight;
          const read = (fx, fy) => {
            const pixel = new Uint8Array(4);
            gl.readPixels(Math.floor(width * fx), Math.floor(height * fy), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
            return [pixel[0], pixel[1], pixel[2]];
          };
          return {
            drawingBuffer: [width, height],
            centre: read(0.4, 0.5),
            upperLeft: read(0.15, 0.8),
            lowerRight: read(0.65, 0.25),
            renderInfo: { calls: app.engine.renderer.info.render.calls, triangles: app.engine.renderer.info.render.triangles },
            contextLost: gl.isContextLost ? gl.isContextLost() : null,
          };
        } catch (error) {
          return { error: String(error && error.message) };
        }
      })(),
      ui,
      craneState: world.manager.all('crane').map((c) => c.getDebugInfo()),
      workerStates: world.manager.all('character').map((c) => c.state).reduce((acc, s) => { acc[s] = (acc[s] || 0) + 1; return acc; }, {}),
      geometryProbe: (() => {
        const report = [];
        for (const building of world.manager.all('building')) {
          building.object3d.traverse((mesh) => {
            if (!mesh.isMesh) return;
            const geometry = mesh.geometry;
            const position = geometry.attributes.position;
            const normal = geometry.attributes.normal;
            const color = geometry.attributes.color;
            let normalSum = 0;
            if (normal) {
              for (let i = 0; i < Math.min(normal.count, 600); i++) normalSum += normal.getY(i);
            }
            const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
            report.push({
              mesh: mesh.name,
              instances: mesh.count,
              verts: position ? position.count : 0,
              normalCount: normal ? normal.count : 0,
              avgNormalY: normal ? Number((normalSum / Math.min(normal.count, 600)).toFixed(3)) : null,
              hasVertexColor: Boolean(color),
              vertexColor0: color ? [color.getX(0), color.getY(0), color.getZ(0)].map((v) => Number(v.toFixed(2))) : null,
              hasInstanceColor: Boolean(mesh.instanceColor),
              instanceColor0: mesh.instanceColor
                ? [mesh.instanceColor.getX(0), mesh.instanceColor.getY(0), mesh.instanceColor.getZ(0)].map((v) => Number(v.toFixed(2)))
                : null,
              material: {
                type: material.type,
                vertexColors: material.vertexColors,
                roughness: material.roughness,
                metalness: material.metalness,
                side: material.side,
                transparent: material.transparent,
                opacity: material.opacity,
                color: material.color ? material.color.getHexString() : null,
              },
            });
          });
        }
        return report.slice(0, 10);
      })(),
      lightProbe: {
        sunIntensity: Number(world.lighting.sun.intensity.toFixed(2)),
        sunPosition: world.lighting.sun.position.toArray().map((v) => Number(v.toFixed(1))),
        sunTarget: world.lighting.sun.target.position.toArray().map((v) => Number(v.toFixed(1))),
        sunDirY: Number(world.lighting.sunElevation().toFixed(3)),
        hemiIntensity: Number(world.lighting.hemi.intensity.toFixed(2)),
        ambientIntensity: Number(world.lighting.ambient.intensity.toFixed(2)),
        exposure: Number(world.lighting.exposure?.toFixed?.(2) ?? 0),
        toneMapping: app.engine.renderer.toneMapping,
        shadowEnabled: app.engine.renderer.shadowMap.enabled,
        outputColorSpace: app.engine.renderer.outputColorSpace,
      },
    };
  })()`);

  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
  console.log(`screenshot -> ${OUT} (${(Buffer.from(shot.data, 'base64').length / 1024).toFixed(0)} KB)`);

  // Independent check of the delivered image itself (not just readPixels, which
  // returns zeros for an already-composited WebGL buffer).
  const imageStats = await evaluate(`(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = ${WIDTH};
    canvas.height = ${HEIGHT};
    const ctx = canvas.getContext('2d');
    const image = new Image();
    await new Promise((done, fail) => {
      image.onload = done;
      image.onerror = fail;
      image.src = 'data:image/png;base64,${shot.data}';
    });
    ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let min = 255, max = 0, sum = 0, nonBlack = 0, coloured = 0;
    for (let i = 0; i < data.length; i += 4) {
      const luma = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
      min = Math.min(min, luma);
      max = Math.max(max, luma);
      sum += luma;
      if (luma > 12) nonBlack++;
      if (Math.abs(data[i] - data[i + 1]) + Math.abs(data[i + 1] - data[i + 2]) > 18) coloured++;
    }
    const total = data.length / 4;
    // Sample the left 70% only: the right side holds the UI panels.
    const sample3x3 = [];
    for (const [fx, fy] of [[0.2, 0.5], [0.35, 0.35], [0.5, 0.6]]) {
      const x = Math.floor(canvas.width * fx);
      const y = Math.floor(canvas.height * fy);
      const o = (y * canvas.width + x) * 4;
      sample3x3.push([data[o], data[o + 1], data[o + 2]]);
    }
    return {
      minLuma: Math.round(min), maxLuma: Math.round(max), meanLuma: Math.round(sum / total),
      nonBlackPct: Number(((nonBlack / total) * 100).toFixed(1)),
      colouredPct: Number(((coloured / total) * 100).toFixed(1)),
      samples: sample3x3,
    };
  })()`);
  console.log('image stats:', JSON.stringify(imageStats));

  console.log('\n=== in-page probe ===');
  console.log(JSON.stringify(probe, null, 2));
  if (consoleErrors.length) {
    console.log('\n=== console errors ===');
    for (const error of consoleErrors.slice(0, 10)) console.log(`  ${error}`);
  }
  if (pageErrors.length) {
    console.log('\n=== page exceptions ===');
    for (const error of pageErrors.slice(0, 10)) console.log(`  ${error}`);
  }
  if (!consoleErrors.length && !pageErrors.length) console.log('\nno console errors, no exceptions');
} catch (error) {
  console.error('CDP verification failed:', error.message);
  process.exitCode = 1;
} finally {
  try {
    ws?.close();
  } catch {
    /* ignore */
  }
  child.kill();
}
