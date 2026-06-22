'use strict';
// Minimal runnable tests — no network. Proves the core round-trips: build a commit, sign it with a
// throwaway key, verify it, and confirm the artifact_hash binding + the full-flow gate behave.
const assert = require('assert');
const { schnorr } = require('@noble/curves/secp256k1');
const { sha256 } = require('@noble/hashes/sha256');
const {
  buildCommitEvent, artifactHash, verifyProof, verifyFullFlow, nostrEventId, recompute,
} = require('../src/index');

function hex(b) { return Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join(''); }

// throwaway keypair
const sk = sha256(new TextEncoder().encode('agent-sdk-test-key'));
const pk = hex(schnorr.getPublicKey(sk));

const spec = { job_id: 'job-1', target_wallet: '0xdead', output_address: '0xbeef', asset_set: ['ENS'] };

// 1. artifact_hash is deterministic + order-independent
assert.strictEqual(artifactHash(spec), artifactHash({ asset_set: ['ENS'], output_address: '0xbeef', target_wallet: '0xdead', job_id: 'job-1' }), 'artifactHash must be canonical');

// 2. build → sign → verify round-trips
const { event, artifact_hash } = buildCommitEvent({ spec, pubkey: pk, judgmentType: 'recovery_receipt' });
event.sig = hex(schnorr.sign(event.id, sk));
const r = verifyProof(event, { expectPubkey: pk, schemaPrefix: 'onchain-ai.' });
assert.strictEqual(r.valid, true, 'signed commit must verify');
assert.strictEqual(r.checks.id_integrity, true);
assert.strictEqual(r.checks.signature_valid, true);
assert.strictEqual(r.proof_payload.artifact_hash, artifact_hash);

// 3. tamper → invalid (mutate a real content field; id no longer matches → id_integrity fails)
const bad = { ...event, content: event.content.replace('recovery_receipt', 'evil_swap') };
assert.strictEqual(verifyProof(bad, { expectPubkey: pk }).valid, false, 'tampered content must fail');

// 4. full-flow gate: ok only when valid && hash matches && anchored
const okFlow = verifyFullFlow({ proofEvent: event, expectArtifactHash: artifact_hash, expectPubkey: pk, schemaPrefix: 'onchain-ai.', relaySeen: true, otsVerified: true });
assert.strictEqual(okFlow.ok, true, 'all three legs true → ok');
const wrongHash = verifyFullFlow({ proofEvent: event, expectArtifactHash: 'deadbeef', expectPubkey: pk, relaySeen: true, otsVerified: true });
assert.strictEqual(wrongHash.ok, false, 'wrong artifact hash → not ok (replay/wrong-job blocked)');
const notAnchored = verifyFullFlow({ proofEvent: event, expectArtifactHash: artifact_hash, expectPubkey: pk, relaySeen: true, otsVerified: false });
assert.strictEqual(notAnchored.ok, false, 'no OTS anchor → not ok even though valid');

// 5. recompute over public events
const rec = recompute([event], { expectPubkey: pk });
assert.strictEqual(rec.total, 1);
assert.strictEqual(rec.valid, 1);

console.log('ok — all agent-sdk v0.1 tests passed');
