/**
 * Opens a URL in a real browser and reports the page's boot state plus every
 * console message / exception. Used to compare file:// against http://.
 *
 *   node tools/probe-url.mjs --url "file:///C:/path/index.html"
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const target = argValue('--url', 'http://127.0.0.1:5173/');
const port = Number(argValue('--port', 9411));

const browserPath = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((candidate) => existsSync(candidate));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(browserPath, [
  '--headless=new',
  '--disable-gpu',
  '--enable-unsafe-swiftshader',
  '--no-first-run',
  '--disable-extensions',
  '--hide-scrollbars',
  '--window-size=1280,800',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${process.env.TEMP}\\cdp-url-${Date.now()}`,
  'about:blank',
], { stdio: 'ignore' });

let ws;
let id = 0;
const pending = new Map();
const consoleMessages = [];
const exceptions = [];
const failedRequests = [];

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
    if (message.method === 'Runtime.consoleAPICalled') {
      const text = message.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ');
      consoleMessages.push(`[${message.params.type}] ${text}`);
    }
    if (message.method === 'Runtime.exceptionThrown') {
      const details = message.params.exceptionDetails;
      exceptions.push(details.exception?.description || details.text);
    }
    if (message.method === 'Network.loadingFailed') {
      failedRequests.push(`${message.params.type} ${message.params.errorText}`);
    }
    if (message.method === 'Log.entryAdded') {
      const entry = message.params.entry;
      if (entry.level === 'error') consoleMessages.push(`[log:${entry.source}] ${entry.text}`);
    }
  });

  const session = (await send('Target.attachToTarget', {
    targetId: (await send('Target.createTarget', { url: 'about:blank' })).targetId,
    flatten: true,
  })).sessionId;
  await send('Runtime.enable', {}, session);
  await send('Page.enable', {}, session);
  await send('Log.enable', {}, session);
  await send('Network.enable', {}, session);
  await send('Page.navigate', { url: target }, session);
  await sleep(7000);

  const state = await send('Runtime.evaluate', {
    expression: `JSON.stringify({
      protocol: location.protocol,
      appBooted: Boolean(window.__CITY__),
      bootError: (document.querySelector('.boot-error') || {}).textContent || null,
      bootSteps: [...document.querySelectorAll('.boot-step')].map((n) => n.textContent),
      panels: document.querySelectorAll('.panel').length,
      canvas: (() => { const c = document.getElementById('viewport'); return c ? [c.width, c.height] : null; })(),
    })`,
    returnByValue: true,
  }, session);

  console.log(`URL       : ${target}`);
  console.log(`page state: ${state.result?.value}`);
  console.log('');
  console.log(`=== console (${consoleMessages.length}) ===`);
  for (const message of consoleMessages.slice(0, 12)) console.log(`  ${message.slice(0, 300)}`);
  console.log(`=== exceptions (${exceptions.length}) ===`);
  for (const exception of exceptions.slice(0, 6)) console.log(`  ${String(exception).split('\n')[0].slice(0, 300)}`);
  console.log(`=== failed requests (${failedRequests.length}) ===`);
  for (const failed of failedRequests.slice(0, 8)) console.log(`  ${failed}`);
} catch (error) {
  console.error('probe failed:', error.message);
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch { /* ignore */ }
  child.kill();
}
