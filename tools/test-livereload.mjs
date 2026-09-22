/**
 * Proves live-server's auto-reload actually works: watches for the reload
 * websocket frame while a file in the project is touched.
 *
 *   node tools/test-livereload.mjs [--url http://127.0.0.1:5500/]
 */
import { spawn } from 'node:child_process';
import { existsSync, appendFileSync, readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const index = args.indexOf('--url');
const target = index >= 0 && args[index + 1] ? args[index + 1] : 'http://127.0.0.1:5500/';
const port = 9441;
const watchFile = 'src/lib/noise.js';

const browserPath = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((candidate) => existsSync(candidate));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(browserPath, [
  '--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader', '--no-first-run',
  '--disable-extensions', '--hide-scrollbars', '--window-size=900,600',
  `--remote-debugging-port=${port}`, `--user-data-dir=${process.env.TEMP}\\cdp-lr-${Date.now()}`,
  'about:blank',
], { stdio: 'ignore' });

let ws;
let id = 0;
const pending = new Map();
let reloadSeen = false;
let reloadFrame = null;
const sockets = [];

const send = (method, params = {}, sessionId) =>
  new Promise((res, rej) => {
    const messageId = ++id;
    pending.set(messageId, { res, rej });
    ws.send(JSON.stringify({ id: messageId, method, params, ...(sessionId ? { sessionId } : {}) }));
    setTimeout(() => pending.has(messageId) && (pending.delete(messageId), rej(new Error(`timeout ${method}`))), 20000);
  });

const original = readFileSync(watchFile, 'utf8');
let restored = false;

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
    if (message.method === 'Network.webSocketCreated') sockets.push(message.params.url);
    if (message.method === 'Network.webSocketFrameReceived') {
      const payload = message.params.response.payloadData || '';
      if (/reload|refresh/i.test(payload)) {
        reloadSeen = true;
        reloadFrame = payload.slice(0, 200);
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
  console.log('app booted, waiting for the reload websocket ...');
  await sleep(2500);
  console.log('websockets observed:', sockets.length ? sockets.join(', ') : '(none)');

  // Touch a source file the way an editor save would.
  console.log(`touching ${watchFile} ...`);
  appendFileSync(watchFile, `\n// live-reload probe ${Date.now()}\n`);
  restored = true;

  for (let i = 0; i < 20 && !reloadSeen; i++) await sleep(400);

  console.log('');
  console.log(reloadSeen ? `AUTO-RELOAD WORKS -> ${reloadFrame}` : 'AUTO-RELOAD NOT OBSERVED');
} catch (error) {
  console.error('test failed:', error.message);
  process.exitCode = 1;
} finally {
  if (restored) {
    writeFileSync(watchFile, original);
    console.log(`restored ${watchFile}`);
  }
  try { ws?.close(); } catch { /* ignore */ }
  child.kill();
}
