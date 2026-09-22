import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, resolve, relative, basename, join, sep } from 'node:path';

const root = resolve(process.argv[2] || 'src');
const files = [];
(function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(js|mjs)$/.test(entry.name)) files.push(full);
  }
})(root);

let changed = 0;
let checked = 0;
for (const file of files) {
  const dir = dirname(file);
  const text = readFileSync(file, 'utf8');
  let out = text;
  const replacements = [];
  const re = /(from\s+')([^']+)(')/g;
  let match;
  while ((match = re.exec(text))) {
    const spec = match[2];
    if (!spec.startsWith('.')) continue;
    checked++;
    const absolute = resolve(dir, spec);
    if (existsSync(absolute)) continue;
    const target = basename(spec);
    const candidates = [];
    (function scan(d) {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        if (entry.name === 'node_modules') continue;
        const full = join(d, entry.name);
        if (entry.isDirectory()) scan(full);
        else if (entry.name === target) candidates.push(full);
      }
    })(root);
    if (candidates.length === 1) {
      let rel = relative(dir, candidates[0]).split(sep).join('/');
      if (!rel.startsWith('.')) rel = `./${rel}`;
      replacements.push([spec, rel]);
    } else {
      console.log(`UNRESOLVED ${file} -> ${spec} (candidates: ${candidates.length})`);
    }
  }
  for (const [from, to] of replacements) {
    out = out.split(`'${from}'`).join(`'${to}'`);
    console.log(`fix ${file.replace(root, 'src')}: ${from} -> ${to}`);
  }
  if (out !== text) {
    writeFileSync(file, out);
    changed++;
  }
}
console.log(`checked ${checked} relative imports in ${files.length} files; rewrote ${changed} files`);
