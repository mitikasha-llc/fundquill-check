// Build dist/check.html: a single self-contained file that runs the verifier fully offline
// (air-gapped). It inlines the src modules into web/check.html's <script>, so the published
// artifact has no imports and no network needs. One source, so it can't drift from the CLI.
//
//   node scripts/build-html.mjs

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

// Concatenation order respects the dependency graph (index.js is skipped, it only re-exports).
const MODULES = ['src/canonical.js', 'src/verify.js'];

function inline(src) {
  return src
    .split('\n')
    .filter((l) => !/^\s*import\s.*from\s.*;?\s*$/.test(l)) // drop import lines
    .map((l) => l.replace(/^export\s+(async\s+function|function|const|let|class)\b/, '$1')) // drop `export`
    .join('\n');
}

async function main() {
  const bundle = (await Promise.all(MODULES.map((m) => readFile(resolve(root, m), 'utf8'))))
    .map(inline)
    .join('\n\n');

  const html = await readFile(resolve(root, 'web/check.html'), 'utf8');
  // Replace the module import with the inlined bundle; keep the page code that follows it.
  const replaced = html.replace(
    /import \{ verify \} from '\.\.\/src\/index\.js';/,
    `/* --- inlined fundquill-check (build-html.mjs) --- */\n${bundle}\n/* --- end inlined bundle --- */`
  );
  if (replaced === html) throw new Error('import marker not found in web/check.html');

  await mkdir(resolve(root, 'dist'), { recursive: true });
  await writeFile(resolve(root, 'dist/check.html'), replaced);
  console.log('wrote dist/check.html (self-contained, offline)');
}

main();
