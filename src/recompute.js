// @onchain-ai/agent-sdk — recompute.js
//
// Re-derive a record from public, signed events — pure over events you fetched from relays. The point
// is that anyone re-runs this over the same public data and gets the same answer: no stored score, no
// trusted index. I/O (which relays, which range) is yours; the derivation is here and auditable.

'use strict';
const { verifyProof } = require('./verify');

/**
 * @param {object[]} events   signed proof events fetched from public relays
 * @param {object} [opts]     { expectPubkey, schemaPrefix } passed through to verifyProof
 * @returns {{ total: number, valid: number, entries: object[] }}
 *   entries are the verified events with their parsed payload — the recomputed record.
 */
function recompute(events, opts = {}) {
  const list = Array.isArray(events) ? events : [];
  const entries = [];
  let valid = 0;
  for (const ev of list) {
    const r = verifyProof(ev, opts);
    if (r.valid) valid += 1;
    entries.push({
      id: ev && ev.id,
      committed_at: r.proof_payload && r.proof_payload.committed_at,
      artifact_hash: r.proof_payload && r.proof_payload.artifact_hash,
      judgment_type: r.proof_payload && r.proof_payload.judgment_type,
      valid: r.valid,
    });
  }
  return { total: list.length, valid, entries };
}

module.exports = { recompute };
