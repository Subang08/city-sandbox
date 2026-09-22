/**
 * validate.mjs - one command that proves the project is in a shippable state:
 *   1. every JS module parses (catches the class of bug that once blanked the app)
 *   2. no UTF-8 corruption / stray replacement characters in source or config
 *   3. every JSON config parses and has its required top-level keys
 *   4. the headless simulation assertions all pass
 *
 *   node tools/validate.mjs [--fast]     (--fast skips the simulation)
 */
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative, resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fast = process.argv.includes('--fast');
const failures = [];

function walk(dir, extensions, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'vendor' || entry === '.verify' || entry === '.git') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, extensions, out);
    else if (extensions.includes(extname(entry))) out.push(full);
  }
  return out;
}

const label = (file) => relative(root, file).split('\\').join('/');
console.log('=== 1. module syntax ===');
const modules = [...walk(join(root, 'src'), ['.js']), ...walk(join(root, 'tools'), ['.js', '.mjs'])];
let syntaxOk = 0;
for (const file of modules) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    syntaxOk++;
  } catch (error) {
    failures.push(`syntax: ${label(file)}`);
    console.log(`  FAIL ${label(file)}`);
    console.log(String(error.stderr).split('\n').slice(0, 4).join('\n'));
  }
}
console.log(`  ${syntaxOk}/${modules.length} modules parse`);

console.log('=== 2. encoding integrity ===');
const textFiles = [...modules, ...walk(join(root, 'config'), ['.json']), ...walk(join(root, 'styles'), ['.css'])];
let encodingOk = 0;
for (const file of textFiles) {
  const text = readFileSync(file, 'utf8');
  // U+FFFD means a decode went wrong; the CJK mojibake range means a bad re-encode.
  if (text.includes('\uFFFD') || /[\u9518\u9352\u93cb\u954c\u9564\u93b8]/.test(text)) {
    failures.push(`encoding: ${label(file)}`);
    console.log(`  FAIL ${label(file)} (corrupted text)`);
  } else {
    encodingOk++;
  }
}
console.log(`  ${encodingOk}/${textFiles.length} files clean`);

console.log('=== 3. configuration ===');
const requiredKeys = {
  'config/scene.json': ['seed', 'world', 'roads', 'buildings', 'cranes', 'vehicles', 'characters', 'navigation'],
  'config/weather.json': ['clear', 'overcast', 'rain', 'snow', 'fog'],
  'config/lighting.json': ['keys'],
};
for (const [relativePath, keys] of Object.entries(requiredKeys)) {
  const full = join(root, relativePath);
  try {
    const parsed = JSON.parse(readFileSync(full, 'utf8'));
    const missing = keys.filter((key) => !(key in parsed));
    if (missing.length) {
      failures.push(`config: ${relativePath} missing ${missing.join(', ')}`);
      console.log(`  FAIL ${relativePath} missing: ${missing.join(', ')}`);
    } else {
      console.log(`  ok   ${relativePath}`);
    }
  } catch (error) {
    failures.push(`config: ${relativePath} unparsable`);
    console.log(`  FAIL ${relativePath}: ${error.message}`);
  }
}

console.log('=== 4. entry points ===');
for (const required of ['index.html', 'src/app.js', 'src/World.js', 'config/scene.json', 'public/vendor/three.module.js']) {
  const exists = (() => {
    try {
      return statSync(join(root, required)).isFile();
    } catch {
      return false;
    }
  })();
  console.log(`  ${exists ? 'ok  ' : 'FAIL'} ${required}`);
  if (!exists) failures.push(`missing: ${required}`);
}

if (!fast) {
  console.log('=== 5. headless simulation ===');
  try {
    const output = execFileSync(process.execPath, [join(root, 'tools/simtest.mjs'), '--seconds', '180', '--assert'], {
      cwd: root,
      stdio: 'pipe',
      encoding: 'utf8',
    });
    const summary = output.trim().split('\n').filter((line) => /CHECKS PASSED|FAILED/.test(line)).pop();
    console.log(`  ${summary || 'no summary line'}`);
    if (!/ALL \d+ CHECKS PASSED/.test(output)) failures.push('simulation assertions failed');
  } catch (error) {
    failures.push('simulation run crashed');
    console.log(`  FAIL ${String(error.stdout || error.message).split('\n').slice(-6).join('\n')}`);
  }
}

console.log('');
if (failures.length) {
  console.log(`VALIDATION FAILED (${failures.length}):`);
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}
console.log('VALIDATION PASSED - project is shippable');
