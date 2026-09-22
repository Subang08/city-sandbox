/**
 * Captures a native window (e.g. the VS Code window) so UI locations can be
 * pointed out without guessing at screen coordinates.
 *
 *   node tools/capture-window.mjs --title "Visual Studio Code" --out .verify/vscode-window.png
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const script = argValue('--script', '.verify/capture-window.ps1');
if (!existsSync(script)) {
  console.error(`missing script: ${script}`);
  process.exit(1);
}
try {
  const out = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  console.log(out.trim());
} catch (error) {
  console.error('capture failed:');
  console.error(String(error.stdout || ''));
  console.error(String(error.stderr || error.message));
  process.exit(1);
}
