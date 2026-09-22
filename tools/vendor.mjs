/**
 * vendor.mjs - copies the three.js ES module build out of node_modules into
 * public/vendor so the app runs fully offline with no CDN dependency.
 *
 *   npm run vendor
 *
 * Run this after `npm install` and after cloning the repository, since
 * public/vendor/ is git-ignored build output.
 */
import { copyFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'node_modules', 'three', 'build', 'three.module.js');
const targetDir = join(root, 'public', 'vendor');
const target = join(targetDir, 'three.module.js');

if (!existsSync(source)) {
  console.error('[vendor] 未找到 node_modules/three/build/three.module.js');
  console.error('         请先执行:  npm install');
  process.exit(1);
}

mkdirSync(targetDir, { recursive: true });
copyFileSync(source, target);

const size = (statSync(target).size / 1024 / 1024).toFixed(2);
console.log(`[vendor] three.module.js -> public/vendor/three.module.js (${size} MB)`);
