#!/usr/bin/env node
/**
 * live-server.mjs - runs the same live-server engine that the VS Code
 * "Live Server" extension uses, as a standalone process.
 *
 * Why: the extension can only be started from inside the VS Code UI, and this
 * gives the identical behaviour (static serving + automatic browser reload on
 * file change) from a plain command line.
 *
 *   node tools/live-server.mjs [--port 5500] [--no-open]
 */
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const port = Number(argValue('--port', 5500));
const open = !args.includes('--no-open');

// The extension bundles live-server; fall back to a normal install if present.
const candidates = [
  join(homedir(), '.vscode', 'extensions'),
  join(root, 'node_modules'),
];
let liveServerPath = null;
for (const base of candidates) {
  if (base.endsWith('extensions')) {
    const { readdirSync } = await import('node:fs');
    const dirs = readdirSync(base).filter((name) => name.startsWith('ritwickdey.liveserver-'));
    for (const dir of dirs) {
      const candidate = join(base, dir, 'node_modules', 'live-server');
      if (existsSync(join(candidate, 'index.js'))) {
        liveServerPath = candidate;
        break;
      }
    }
  } else if (existsSync(join(base, 'live-server', 'index.js'))) {
    liveServerPath = join(base, 'live-server');
  }
  if (liveServerPath) break;
}

if (!liveServerPath) {
  console.error('[live-server] 未找到 live-server 模块。');
  console.error('  请先安装 VS Code 扩展 ritwickdey.LiveServer，或执行 npm i -D live-server');
  process.exit(1);
}

const require = createRequire(import.meta.url);
const liveServer = require(liveServerPath);

console.log(`[live-server] root: ${root}`);
console.log(`[live-server] engine: ${liveServerPath}`);

const server = liveServer.start({
  root,
  port,
  host: '127.0.0.1',
  open,
  file: 'index.html',
  wait: 200,
  logLevel: 2,
  // Keep the browser from caching modules, which is what makes edits show up.
  middleware: [
    function noCache(req, res, next) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      next();
    },
  ],
  ignore: ['.vscode', '.verify', 'node_modules', 'public/vendor'],
});

process.on('SIGINT', () => {
  console.log('\n[live-server] 正在停止 ...');
  server.shutdown(() => process.exit(0));
});
