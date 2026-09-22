#!/usr/bin/env node
/**
 * Zero-dependency static server for the sandbox.
 *   node tools/server.mjs [--port 5173] [--host 127.0.0.1]
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const port = Number(argValue('--port', process.env.PORT || 5173));
const host = argValue('--host', '127.0.0.1');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.hdr': 'application/octet-stream',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';
    const safePath = normalize(pathname).replace(/^([/\\])+/, '');
    let filePath = join(root, safePath);
    if (!filePath.startsWith(root)) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    let info = await stat(filePath).catch(() => null);
    if (info && info.isDirectory()) {
      filePath = join(filePath, 'index.html');
      info = await stat(filePath).catch(() => null);
    }
    if (!info) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end(`404 ${pathname}`);
      return;
    }
    const body = await readFile(filePath);
    response.writeHead(200, {
      'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'no-cache',
    });
    response.end(body);
  } catch (error) {
    response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end(`500 ${error.message}`);
  }
});

server.listen(port, host, () => {
  console.log(`city-sandbox serving ${root}`);
  console.log(`  -> http://${host}:${port}/`);
});
