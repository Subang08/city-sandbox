/**
 * Renders the live diorama into an offscreen WebGLRenderTarget and reads it back.
 * This bypasses the default framebuffer entirely, which is what breaks on some
 * drivers (FRAMEBUFFER_INCOMPLETE_ATTACHMENT / unreadable default FBO).
 *
 *   node tools/render-target-capture.mjs [--gpu] [--url ...] [--out ...]
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const useGpu = args.includes('--gpu');
const port = Number(argValue('--port', 9399));
const out = argValue('--out', '.verify/rt-capture.png');
const day = argValue('--day', '9');
const minute = argValue('--minute', '660');
const weather = argValue('--weather', 'clear');
const extra = argValue('--extra', '');
const target = argValue(
  '--url',
  `http://127.0.0.1:5173/?day=${day}&minute=${minute}&weather=${weather}${extra}`,
);

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
  `--user-data-dir=${process.env.TEMP}\\cdp-rt-${Date.now()}`, 'about:blank',
], { stdio: 'ignore' });

let ws;
let id = 0;
const pending = new Map();
const send = (method, params = {}, sessionId) =>
  new Promise((res, rej) => {
    const messageId = ++id;
    pending.set(messageId, { res, rej });
    ws.send(JSON.stringify({ id: messageId, method, params, ...(sessionId ? { sessionId } : {}) }));
    setTimeout(() => pending.has(messageId) && (pending.delete(messageId), rej(new Error(`timeout ${method}`))), 45000);
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
  await send('Page.enable', {}, session);
  await send('Runtime.enable', {}, session);
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 800, deviceScaleFactor: 1, mobile: false }, session);
  await send('Page.navigate', { url: target }, session);

  for (let i = 0; i < 50; i++) {
    await sleep(400);
    const ready = await send('Runtime.evaluate', { expression: 'Boolean(window.__CITY__)', returnByValue: true }, session);
    if (ready.result?.value) break;
  }
  // Give the simulation a couple of seconds of real frames.
  await sleep(2500);

  const script = `(async () => {
    try {
      const app = window.__CITY__;
    const THREE = await import('./public/vendor/three.module.js');
    const renderer = app.engine.renderer;
    const gl = renderer.getContext();
    const width = 1120;
    const height = 630;
    const target = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      type: THREE.UnsignedByteType,
    });
    target.texture.colorSpace = THREE.SRGBColorSpace;
    renderer.setRenderTarget(target);
    renderer.render(app.world.scene.scene, app.engine.camera);
    const pixels = new Uint8Array(width * height * 4);
    renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
    renderer.setRenderTarget(null);

    let min = 255, max = 0, sum = 0, nonBlack = 0, coloured = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const luma = pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114;
      min = Math.min(min, luma); max = Math.max(max, luma); sum += luma;
      if (luma > 12) nonBlack++;
      if (Math.abs(pixels[i] - pixels[i + 1]) + Math.abs(pixels[i + 1] - pixels[i + 2]) > 18) coloured++;
    }

    // PNG encode (flip Y: WebGL origin is bottom-left).
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(width, height);
    for (let y = 0; y < height; y++) {
      const source = (height - 1 - y) * width * 4;
      image.data.set(pixels.subarray(source, source + width * 4), y * width * 4);
    }
    ctx.putImageData(image, 0, 0);
    const dataUrl = canvas.toDataURL('image/png');

    const sample = (fx, fy) => {
      const x = Math.floor((width - 1) * fx);
      const y = Math.floor((height - 1) * fy);
      const o = (y * width + x) * 4;
      return [pixels[o], pixels[o + 1], pixels[o + 2]];
    };
    const total = width * height;
    return {
      dataUrl,
      renderer: gl.getParameter(gl.RENDERER),
      glError: gl.getError(),
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      floors: app.world.manager.get(app.world.mainBuildingId).state.floorsCompleted,
      clock: app.world.time.clock,
      day: app.world.time.day,
      workerStates: app.world.manager.all('character').map((c) => c.state).reduce((a, s) => { a[s] = (a[s] || 0) + 1; return a; }, {}),
      craneStates: app.world.manager.all('crane').map((c) => c.state),
      stats: { min: Math.round(min), max: Math.round(max), mean: Math.round(sum / total), nonBlackPct: Number(((nonBlack / total) * 100).toFixed(1)), colouredPct: Number(((coloured / total) * 100).toFixed(1)) },
      samples: {
        building: sample(0.42, 0.55), buildingUp: sample(0.45, 0.75),
        ground: sample(0.32, 0.35), road: sample(0.22, 0.25),
        // Vertical sky strip: distinguishes "dome not drawn" from "wrong gradient".
        skyUp: sample(0.5, 0.995), skyUpper: sample(0.5, 0.94),
        skyMid: sample(0.5, 0.86), skyLow: sample(0.5, 0.76), skyHorizon: sample(0.5, 0.68),
      },
      light: {
        sunIntensity: Number(app.world.lighting.sun.intensity.toFixed(2)),
        sunColor: app.world.lighting.sun.color.getHexString(),
        sunElevationY: Number(app.world.lighting.sunElevation().toFixed(3)),
        hemiIntensity: Number(app.world.lighting.hemi.intensity.toFixed(2)),
        ambientIntensity: Number(app.world.lighting.ambient.intensity.toFixed(2)),
        exposure: Number(app.engine.renderer.toneMappingExposure.toFixed(2)),
        toneMapping: app.engine.renderer.toneMapping,
      },
      sky: {
        visible: app.world.scene.sky.visible,
        position: app.world.scene.sky.position.toArray().map((v) => Number(v.toFixed(1))),
        cameraPosition: app.engine.camera.position.toArray().map((v) => Number(v.toFixed(1))),
        layersMask: app.engine.camera.layers.mask,
        zenith: app.world.scene.skyUniforms.uZenith.value.getHexString(),
        horizon: app.world.scene.skyUniforms.uHorizon.value.getHexString(),
        ground: app.world.scene.skyUniforms.uGround.value.getHexString(),
        sunDirY: Number(app.world.scene.skyUniforms.uSunDir.value.y.toFixed(3)),
        fogColor: app.world.scene.scene.fog.color.getHexString(),
        fogNear: app.world.scene.scene.fog.near,
        fogFar: app.world.scene.scene.fog.far,
        background: app.world.scene.scene.background ? app.world.scene.scene.background.getHexString() : null,
        environmentSet: Boolean(app.world.scene.scene.environment),
        domeMaterial: app.world.scene.sky.material.type,
        domeFog: app.world.scene.sky.material.fog,
        domeDepthWrite: app.world.scene.sky.material.depthWrite,
        // Fog also affects the dome: a fully fogged dome renders as flat fog colour.
        domeFoggedPct: (() => {
          const distance = 420;
          const { near, far } = app.world.scene.scene.fog;
          return Number(Math.min(1, Math.max(0, (distance - near) / (far - near))).toFixed(2));
        })(),
      },
    };
    } catch (error) {
      return { failure: String(error && error.stack ? error.stack : error) };
    }
  })()`;

  const result = await send('Runtime.evaluate', { expression: script, returnByValue: true, awaitPromise: true }, session);
  const value = result.result?.value;
  if (!value) {
    console.error('no result:', JSON.stringify(result.exceptionDetails || result, null, 2));
    process.exitCode = 1;
  } else {
    const { dataUrl, ...rest } = value;
    console.log(`mode: ${useGpu ? 'real GPU' : 'software (SwiftShader)'}`);
    console.log(JSON.stringify(rest, null, 2));
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, Buffer.from(dataUrl.split(',')[1], 'base64'));
    console.log(`image -> ${out}`);
  }
} catch (error) {
  console.error('rt capture failed:', error.message);
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch { /* ignore */ }
  child.kill();
}
