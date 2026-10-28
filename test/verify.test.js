// fundquill-check against the shared fixture set. The fixtures and expected.json are
// produced by FundQuill's own code (apps/web/src/lib/fixtures in the FundQuill repo),
// and FundQuill's in-app verifier is tested against the SAME files and verdicts, so
// the two verifiers must agree.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verify, canonical } from '../src/index.js';

const fx = (n) => fileURLToPath(new URL(`./fixtures/${n}`, import.meta.url));
const read = (n) => JSON.parse(readFileSync(fx(n), 'utf8'));
const expected = read('expected.json');
const CLI = fileURLToPath(new URL('../bin/fundquill-check.js', import.meta.url));

test('the fixture set covers every kind, both spec versions and every failure mode', () => {
  assert.equal(new Set(expected.map((e) => e.kind)).size, 3);
  assert.equal(new Set(expected.map((e) => e.spec_version)).size, 2);
  assert.ok(expected.some((e) => !e.hashOk));
  assert.ok(expected.some((e) => e.hashOk && e.signed && !e.signatureOk));
  assert.ok(expected.some((e) => !e.signed));
});

for (const e of expected) {
  test(`${e.file}: same verdict as FundQuill (${e.note})`, async () => {
    const r = await verify(read(e.file), {
      model: e.model ? new Uint8Array(readFileSync(fx(e.model.file))) : undefined,
    });
    assert.equal(r.kind, e.kind);
    assert.equal(r.specVersion, e.spec_version);
    assert.deepEqual(
      { hashOk: r.hashOk, signed: r.signed, signatureOk: r.signatureOk },
      { hashOk: e.hashOk, signed: e.signed, signatureOk: e.signatureOk },
    );
    assert.equal(r.ok, e.hashOk && e.signed && e.signatureOk && (!e.model || e.model.matches));
  });
}

test('the signer fingerprint is derived from the key; --fingerprint enforces it', async () => {
  const doc = read('report-v2-signed.json');
  const r = await verify(doc, { expectFingerprint: doc.signature.device_fp });
  assert.equal(r.signerFp, doc.signature.device_fp);
  assert.equal(r.ok, true);
  const wrong = await verify(doc, { expectFingerprint: '0'.repeat(64) });
  assert.equal(wrong.ok, false);
});

test('a different model file fails', async () => {
  const r = await verify(read('report-v2-signed.json'), { model: new TextEncoder().encode('other') });
  assert.equal(r.ok, false);
  assert.ok(r.checks.some((c) => c.status === 'fail' && /model/i.test(c.title)));
});

test('unsigned fails by default and passes with allowUnsigned', async () => {
  const doc = read('report-v2-free.json');
  assert.equal((await verify(doc)).ok, false);
  assert.equal((await verify(doc, { allowUnsigned: true })).ok, true);
});

test('errored Monte Carlo trials are surfaced', async () => {
  const r = await verify(read('report-v2-signed.json'));
  assert.ok(r.checks.some((c) => c.status === 'warn' && /160 of 2000 trials errored/.test(c.title)));
});

test('v1 documents say their engine version and date are not covered', async () => {
  const r = await verify(read('report-v1.json'));
  assert.equal(r.ok, true);
  assert.ok(r.checks.some((c) => c.status === 'warn' && /NOT covered/.test(c.title)));
});

test('unchained watermark text is never reported', async () => {
  const r = await verify(read('report-v2-watermark-injected.json'));
  assert.equal(r.ok, true);
  assert.ok(!JSON.stringify(r).includes('Approved by the external auditor'));
});

test('an in-place edit fails and names the changed section', async () => {
  const r = await verify(read('report-v2-edited.json'));
  assert.equal(r.ok, false);
  assert.ok(r.checks.some((c) => c.status === 'fail' && /build/.test(c.detail)));
});

test('canonical() sorts keys recursively and keeps array order', () => {
  assert.equal(canonical({ b: [2, { d: 1, c: 0 }], a: null }), '{"a":null,"b":[2,{"c":0,"d":1}]}');
});

test('not a FundQuill document is an error, not a verdict', async () => {
  await assert.rejects(verify({ tool: 'PrivHaven' }), /not a FundQuill document/);
  await assert.rejects(verify({ tool: 'FundQuill', kind: 'invoice' }), /unknown FundQuill document kind/);
});

test('CLI exit codes: 0 verified, 1 not verified, 2 usage', () => {
  const run = (...args) => {
    try {
      execFileSync('node', [CLI, ...args], { stdio: 'pipe' });
      return 0;
    } catch (e) {
      return e.status;
    }
  };
  assert.equal(run(fx('report-v2-signed.json'), fx('model.xlsx')), 0);
  assert.equal(run(fx('report-v2-forged.json')), 1);
  assert.equal(run(fx('report-v2-free.json')), 1);
  assert.equal(run(fx('report-v2-free.json'), '--allow-unsigned'), 0);
  assert.equal(run(), 2);
  assert.equal(run(fx('report-v2-signed.json'), '--bogus'), 2);
});
