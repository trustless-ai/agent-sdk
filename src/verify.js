// @onchain-ai/agent-sdk — verify.js
//
// The zero-dependency-ish trust anchor: recompute a Nostr proof event's NIP-01 id and BIP-340
// signature, trusting no service. Generalized from the invinoveritas reference verifier so it works
// for ANY issuer in the org (you pass the pubkey you expect), not just one. Audited crypto only
// (@noble). This is the part you can always step underneath — `verifyFullFlow` is a thin wrapper over it.

'use strict';
const { schnorr } = require('@noble/curves/secp256k1');
const { sha256 } = require('@noble/hashes/sha256');

const PROOF_KIND = 30078;

function toHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Canonical NIP-01 serialization → event id (compact, no-space JSON, exactly as relays compute it).
function nostrEventId(ev) {
  const serial = JSON.stringify([
    0, String(ev.pubkey).toLowerCase(), Number(ev.created_at), Number(ev.kind),
    ev.tags || [], String(ev.content),
  ]);
  return toHex(sha256(new TextEncoder().encode(serial)));
}

/**
 * Trustlessly verify a proof event. Never throws; returns { valid, checks, proof_payload, ... }.
 * @param {object} event  the signed Nostr event {id,pubkey,created_at,kind,tags,content,sig}
 * @param {object} [opts]
 * @param {string} [opts.expectPubkey]   x-only hex of the issuer you require (authorship gate). Omit to skip.
 * @param {string} [opts.schemaPrefix]   require content.schema to start with this (e.g. "onchain-ai." or "invinoveritas.").
 * `valid` is true only if every present check holds — id integrity, signature, (authorship), (proof shape).
 */
function verifyProof(event, opts = {}) {
  const pin = (opts.expectPubkey || '').trim().toLowerCase();
  const schemaPrefix = opts.schemaPrefix || '';
  const checks = { id_integrity: false, signature_valid: false };
  if (pin) checks.issued_by_expected = false;
  if (schemaPrefix) checks.is_proof_event = false;
  const out = {
    valid: false, checks,
    how_to_verify: 'Recompute id = sha256(JSON [0,pubkey,created_at,kind,tags,content]); schnorr-verify ' +
      'sig over it vs pubkey; (optionally) confirm pubkey == expectPubkey and content.schema prefix. NIP-01.',
  };
  if (!event || typeof event !== 'object') { out.error = 'event must be an object'; return out; }
  const content = event.content ?? '';
  const tags = event.tags ?? [];
  if (typeof content !== 'string' || content.length > 65536) { out.error = 'content too large/not a string'; return out; }
  if (!Array.isArray(tags) || tags.length > 256 || JSON.stringify(tags).length > 65536) { out.error = 'tags too large'; return out; }
  for (const k of ['id', 'pubkey', 'created_at', 'kind', 'content', 'sig']) {
    if (event[k] === undefined || event[k] === null || event[k] === '') { out.error = 'missing required fields'; return out; }
  }
  try {
    checks.id_integrity = nostrEventId(event).toLowerCase() === String(event.id).toLowerCase();
    try {
      checks.signature_valid = schnorr.verify(String(event.sig), String(event.id), String(event.pubkey));
    } catch (_) { checks.signature_valid = false; }
    if (pin) checks.issued_by_expected = String(event.pubkey).trim().toLowerCase() === pin;
    if (schemaPrefix) {
      let schema = '';
      try { schema = (JSON.parse(String(event.content)).schema) || ''; } catch (_) { schema = ''; }
      checks.is_proof_event = Number(event.kind) === PROOF_KIND
        && typeof schema === 'string' && schema.startsWith(schemaPrefix);
    }
  } catch (e) {
    out.error = `malformed event: ${e}`;
    return out;
  }
  out.valid = Object.values(checks).every(Boolean);
  try { out.proof_payload = JSON.parse(event.content); } catch (_) { out.proof_payload = null; }
  return out;
}

module.exports = { verifyProof, nostrEventId, PROOF_KIND };
