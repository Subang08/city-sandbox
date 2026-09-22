/**
 * Reads window.__SANITY_PROBE__ from a page that samples its own framebuffer
 * inside the animation frame (the only reliable way to inspect WebGL output).
 *
 *   node tools/probe-page.mjs --gpu --url http://127.0.0.1:5173/tools/sanity.html
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const target = argValue('--url', 'http://127.0.0.1:5173/tools/sanity.html');
const useGpu = args.includes('--gpu');
const port = Number(argValue('--port', 9377));

const candidates = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];
const browserPath = candidates.find((candidate) => existsSync(candidate));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(browserPath, [
  '--headless=new',
  ...(useGpu ? [] : ['--disable-gpu', '--enable-unsafe-swiftshader']),
  '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars',
  '--window-size=1000,600', `--remote-debugging-port=${port}`,
  `--user-data-dir=${process.env.TEMP}\\cdp-probe-${Date.now()}`, 'about:blank',
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
  await send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 600, deviceScaleFactor: 1, mobile: false }, session);
  await send('Page.navigate', { url: target }, session);
  await sleep(6000);
  const result = await send('Runtime.evaluate', {
    expression: 'JSON.stringify(window.__SANITY_PROBE__ || { pending: true })',
    returnByValue: true,
  }, session);
  console.log(`mode: ${useGpu ? 'real GPU' : 'software (SwiftShader)'}`);
  console.log(JSON.stringify(JSON.parse(result.result.value), null, 2));
} catch (error) {
  console.error('probe failed:', error.message);
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch { /* ignore */ }
  child.kill();
}
