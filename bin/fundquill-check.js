#!/usr/bin/env node
// fundquill-check: verify a FundQuill report, audit trail or assumption library,
// entirely offline, using only public algorithms. Nothing is uploaded; no FundQuill
// engine runs.
//
//   fundquill-check <document.json> [model.xlsx] [--fingerprint <hex>] [--allow-unsigned] [--json]
//
// Exit codes (CI-friendly): 0 = verified · 1 = not verified · 2 = usage / I/O error.

import { readFile } from 'node:fs/promises';
import { verify } from '../src/index.js';

const USAGE = `fundquill-check <document.json> [model.xlsx] [options]

Verify a FundQuill report, audit trail or assumption library: that its contents are
unaltered, which device key signed it, and (optionally) that it describes your copy of
the model. Runs entirely on your machine; nothing is uploaded and no FundQuill engine runs.

Options:
  --fingerprint <hex>  Require this signing-device fingerprint (get it from the sender).
  --allow-unsigned     Pass an intact but unsigned document (e.g. a Free-tier report).
  --json               Emit machine-readable JSON.
  -h, --help           Show this help.

Exit: 0 verified · 1 not verified · 2 usage/I-O error.`;

function parseArgs(argv) {
  const pos = [];
  const opts = { json: false, allowUnsigned: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a === '--allow-unsigned') opts.allowUnsigned = true;
    else if (a === '--fingerprint') opts.expectFingerprint = argv[++i];
    else if (a === '-h' || a === '--help') opts.help = true;
    else if (a.startsWith('-')) opts.unknown = a;
    else pos.push(a);
  }
  return { pos, opts };
}

const C = { reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', dim: '\x1b[2m', bold: '\x1b[1m' };
const color = process.stdout.isTTY;
const paint = (s, c) => (color ? c + s + C.reset : s);
const MARK = { pass: ['✓', C.green], fail: ['✗', C.red], warn: ['!', C.yellow], skip: ['-', C.dim], info: ['·', C.dim] };

async function main() {
  const { pos, opts } = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(USAGE);
    return 0;
  }
  if (opts.unknown || pos.length < 1 || pos.length > 2) {
    if (opts.unknown) console.error(`error: unknown option ${opts.unknown}\n`);
    console.error(USAGE);
    return 2;
  }
  const [docPath, modelPath] = pos;

  let doc;
  try {
    doc = JSON.parse(await readFile(docPath, 'utf8'));
  } catch (e) {
    console.error(`error: could not read "${docPath}" as JSON: ${e.message}`);
    return 2;
  }
  if (modelPath) {
    try {
      opts.model = new Uint8Array(await readFile(modelPath));
    } catch (e) {
      console.error(`error: could not read model "${modelPath}": ${e.message}`);
      return 2;
    }
  }

  let result;
  try {
    result = await verify(doc, opts);
  } catch (e) {
    console.error(`error: ${e.message}`);
    return 2;
  }

  if (opts.json) {
    const { ok, kind, specVersion, hashOk, signed, signatureOk, signerFp, root, checks } = result;
    console.log(JSON.stringify({ ok, kind, specVersion, hashOk, signed, signatureOk, signerFp, root, checks }, null, 2));
  } else {
    console.log(paint('\nFundQuill document verification', C.bold));
    console.log(paint(`document: ${docPath}${modelPath ? `   model: ${modelPath}` : ''}\n`, C.dim));
    for (const c of result.checks) {
      const [m, col] = MARK[c.status] ?? ['?', ''];
      console.log(`  ${paint(m, col)} ${paint(c.title, C.bold)}`);
      if (c.detail) for (const line of String(c.detail).match(/.{1,96}(\s|$)/g) ?? [c.detail]) console.log(`      ${paint(line.trim(), C.dim)}`);
    }
    console.log('');
    console.log(result.ok ? paint('VERIFIED.', C.green) : paint('NOT VERIFIED. See the ✗ lines above.', C.red));
    console.log(
      paint(
        'A signature names a device key, not a person: compare the fingerprint with the one the sender gives you.\n',
        C.dim,
      ),
    );
  }
  return result.ok ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(e);
    process.exit(2);
  });
