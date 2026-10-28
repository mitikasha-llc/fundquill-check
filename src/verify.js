// Verify a FundQuill signed document: a report, an audit trail or an assumption
// library, spec_version 1 or 2. Public algorithms only (SHA-256, ECDSA P-256); no
// FundQuill engine, no network.
//
// The format, in full:
//
//   section hash  h_i  = SHA-256( h_{i-1} + "|" + name_i + "|" + canonical(value_i) )   (h_0 = "")
//   root               = h_n
//   signature          = ECDSA P-256 / SHA-256 over the UTF-8 bytes of  context + root,
//                        raw r||s, base64url, by the key in signature.device_pubkey (SPKI)
//   device fingerprint = hex SHA-256 of the SPKI bytes of that key
//
//   context: report "fq-report:"  ·  audit trail "fq-trail:"  ·  library "fq-lib:"
//
//   sections, spec_version 1 (issued before 2026-10-28):
//     report   file, findings, warnings, assumptions, montecarlo
//     trail    file, fixes, findings, warnings
//     library  name, notes, entries
//   spec_version 2: the same, preceded by `build`
//     { tool, kind, spec_version, engine_version, engine_wasm_sha256, generated_at }
//
// In v2 everything the document asserts is inside the chain. The few top-level
// copies (tool, kind, spec_version) must equal the chained build section, and a
// report's or trail's `reproduce` line must be exactly the text derived from
// chained values. In v1, `engine_version`, `generated_at` and `reproduce` sit
// OUTSIDE the chain: they are shown but not attested. `watermark` is never
// chained in any version, so this verifier never reports its contents.

import { canonical, sha256Text, sha256Bytes, b64urlToBytes } from './canonical.js';

const CONTEXT = { report: 'fq-report:', 'audit-trail': 'fq-trail:', 'assumption-library': 'fq-lib:' };

const V1_SECTIONS = {
  report: ['file', 'findings', 'warnings', 'assumptions', 'montecarlo'],
  'audit-trail': ['file', 'fixes', 'findings', 'warnings'],
  'assumption-library': ['name', 'notes', 'entries'],
};

const LABEL = { report: 'report', 'audit-trail': 'audit trail', 'assumption-library': 'assumption library' };

/** Which document a parsed object is. v1 reports carry no `kind`. Throws if not FundQuill. */
export function kindOf(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc) || doc.tool !== 'FundQuill')
    throw new Error('not a FundQuill document');
  if (doc.kind === undefined || doc.kind === 'report') return 'report';
  if (doc.kind === 'audit-trail' || doc.kind === 'assumption-library') return doc.kind;
  throw new Error(`unknown FundQuill document kind "${doc.kind}"`);
}

function sectionNames(kind, specVersion) {
  if (specVersion === 1) return V1_SECTIONS[kind];
  if (specVersion === 2) return ['build', ...V1_SECTIONS[kind]];
  throw new Error(`unsupported spec_version ${specVersion}`);
}

/** Recompute the hash chain over the named sections of `doc`. */
export async function hashChain(doc, names) {
  const sections = [];
  let prev = '';
  for (const name of names) {
    prev = await sha256Text(prev + '|' + name + '|' + canonical(doc[name]));
    sections.push({ name, hash: prev });
  }
  return { sections, root: prev };
}

/** The `reproduce` line FundQuill derives (v2), from chained values only. */
function expectedReproduce(kind, doc, root) {
  const b = doc.build ?? {};
  const engine = `Re-run FundQuill engine v${b.engine_version} (wasm SHA-256 ${b.engine_wasm_sha256})`;
  if (kind === 'report') {
    const mc = doc.montecarlo;
    return (
      engine +
      ` on the file with SHA-256 ${doc.file?.sha256}` +
      (mc ? `, Monte Carlo seed ${mc.seed} × ${mc.trials} trials,` : ',') +
      ` to reproduce these results. Root hash: ${root}.`
    );
  }
  if (kind === 'audit-trail')
    return (
      engine +
      ` on the file with SHA-256 ${doc.file?.sha256 ?? '(no file)'} and apply the listed fixes in order` +
      ` to reproduce this trail. Root hash: ${root}.`
    );
  return null;
}

async function verifySignature(sig, root, context) {
  try {
    const key = await globalThis.crypto.subtle.importKey(
      'spki',
      b64urlToBytes(sig.device_pubkey),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    return await globalThis.crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      b64urlToBytes(sig.signature),
      new TextEncoder().encode(context + root),
    );
  } catch {
    return false;
  }
}

async function fingerprintOf(pubkey) {
  try {
    return await sha256Bytes(b64urlToBytes(pubkey));
  } catch {
    return null;
  }
}

/**
 * Verify a parsed FundQuill document.
 *
 * @param {object} doc               the parsed JSON document
 * @param {object} [opts]
 * @param {Uint8Array} [opts.model]  your copy of the model: its SHA-256 must match the document's
 * @param {string} [opts.expectFingerprint]  the signing-device fingerprint you were given
 * @param {boolean} [opts.allowUnsigned]     don't fail an intact, unsigned document
 * @returns {Promise<{ok, kind, specVersion, hashOk, signed, signatureOk, signerFp, root, checks}>}
 *   `checks`: [{ status: 'pass'|'fail'|'warn'|'skip'|'info', title, detail }]
 */
export async function verify(doc, opts = {}) {
  const kind = kindOf(doc);
  const specVersion = doc.spec_version;
  const names = sectionNames(kind, specVersion);
  const checks = [];
  const add = (status, title, detail = '') => checks.push({ status, title, detail });

  add('info', `FundQuill ${LABEL[kind]}, spec version ${specVersion}`);

  // 1. Integrity: the chain recomputes to the recorded one, section by section.
  const recorded = doc.hash_chain ?? {};
  const got = await hashChain(doc, names);
  const recordedNames = (recorded.sections ?? []).map((s) => s.name);
  const changed = got.sections.filter((s, i) => recorded.sections?.[i]?.hash !== s.hash).map((s) => s.name);
  const chainOk =
    got.root === recorded.root &&
    recordedNames.length === names.length &&
    names.every((n, i) => recordedNames[i] === n) &&
    changed.length === 0;
  add(
    chainOk ? 'pass' : 'fail',
    'Contents match the hash chain',
    chainOk
      ? `root ${got.root}`
      : changed.length
        ? `changed since it was produced: ${changed.join(', ')}`
        : `section list or root does not match (expected ${names.join(', ')})`,
  );

  // 2. v2: the unchained copies agree with the chained build section.
  let consistent = true;
  if (specVersion === 2) {
    const b = doc.build ?? {};
    const problems = [];
    if (b.tool !== doc.tool) problems.push('tool');
    if (b.spec_version !== doc.spec_version) problems.push('spec_version');
    if ((doc.kind ?? 'report') !== b.kind) problems.push('kind');
    const repro = expectedReproduce(kind, doc, recorded.root);
    if (repro !== null && doc.reproduce !== repro) problems.push('reproduce');
    consistent = problems.length === 0;
    add(
      consistent ? 'pass' : 'fail',
      'Header agrees with the signed build section',
      consistent ? '' : `differs: ${problems.join(', ')}`,
    );
  } else if (kind === 'audit-trail' && doc.kind !== 'audit-trail') {
    consistent = false;
  }
  const hashOk = chainOk && consistent;

  // 3. Signature, by the embedded key, and the key's own fingerprint.
  const sig = doc.signature;
  const signed = !!sig;
  let signatureOk = false;
  let signerFp = null;
  if (!signed) {
    add(
      opts.allowUnsigned ? 'warn' : 'fail',
      'Not signed',
      'Nothing attests who produced it (FundQuill Free reports are unsigned samples).',
    );
    // Pinning a signer can never be satisfied by a document with no signature,
    // whatever allowUnsigned says.
    if (opts.expectFingerprint)
      add('fail', 'Signer is the device you expected', 'the document is not signed');
  } else {
    signerFp = await fingerprintOf(sig.device_pubkey);
    const fpMatches = signerFp !== null && signerFp === sig.device_fp;
    const valid = hashOk && fpMatches && (await verifySignature(sig, recorded.root, CONTEXT[kind]));
    signatureOk = valid;
    if (!fpMatches)
      add('fail', 'Signing-device fingerprint', `the document claims ${sig.device_fp}, but its key is ${signerFp ?? 'unreadable'}`);
    else if (!hashOk) add('fail', 'Signature', 'not checked: the contents do not match the hash chain');
    else add(valid ? 'pass' : 'fail', 'Signature', valid ? `signed by device ${signerFp}` : 'does not verify against the embedded key');
    if (opts.expectFingerprint) {
      const want = opts.expectFingerprint.toLowerCase();
      add(signerFp === want ? 'pass' : 'fail', 'Signer is the device you expected', signerFp === want ? '' : `expected ${want}, got ${signerFp}`);
    }
  }

  // 4. Your copy of the model.
  let modelOk = true;
  if (opts.model) {
    // A model check you asked for must never pass vacuously: no valid recorded
    // hash (a library, a trail without a file, a malformed field) is a failure.
    if (!/^[0-9a-f]{64}$/.test(String(doc.file?.sha256 ?? ''))) {
      modelOk = false;
      add('fail', 'Model file', `this ${LABEL[kind]} records no valid model SHA-256 to compare with`);
    } else {
      const sha = await sha256Bytes(opts.model);
      modelOk = sha === doc.file.sha256;
      add(modelOk ? 'pass' : 'fail', 'Your model is the file this document describes', modelOk ? `SHA-256 ${sha}` : `yours is ${sha}, the document records ${doc.file.sha256}`);
    }
  }

  // 5. What the document says, and whether that is attested.
  if (specVersion === 2) {
    const b = doc.build ?? {};
    add('info', 'Build (covered by the signature)', `engine v${b.engine_version}, engine SHA-256 ${b.engine_wasm_sha256}, generated ${b.generated_at}`);
  } else {
    add('warn', 'Engine version and date are NOT covered by the signature', `spec version 1 leaves them outside the chain (document says engine v${doc.engine_version}, generated ${doc.generated_at})`);
  }
  if (kind === 'report' && specVersion === 2 && doc.montecarlo) {
    for (const o of doc.montecarlo.outputs ?? []) {
      if (o.errors > 0)
        add('warn', `Monte Carlo ${o.cell}: ${o.errors} of ${o.n + o.errors} trials errored`, 'its statistics cover only the trials that produced a number');
    }
  }

  const ok = hashOk && (signed ? signatureOk : !!opts.allowUnsigned) && modelOk && !checks.some((c) => c.status === 'fail');
  return { ok, kind, specVersion, hashOk, signed, signatureOk, signerFp, root: recorded.root ?? null, checks };
}
