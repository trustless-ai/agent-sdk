// @onchain-ai/agent-sdk — flow.js
//
// verifyFullFlow: the composition chain executed as one gate. It is intentionally PURE — you feed it
// the proof event plus the anchor evidence (relay-seen + OTS-verified, gathered by your I/O of choice),
// and it returns the explicit, never-fold-into-one gate the escrow releases on.
//
// THE GATE (never `valid` alone):
//   ok = verify.valid  AND  artifact_hash_matches  AND  anchored(relaySeen && otsVerified)
// The escrow ALSO checks on-chain delivery (assets landed at output_address) — that leg is on-chain and
// is the contract's job, not the SDK's. `valid` only proves the receipt is a genuine signed proof, not
// that it is THIS job's; and proofs carry no nonce/expiry, so a valid receipt is replayable — which is
// exactly why the match + anchor + on-chain-delivery legs are required, not optional.

'use strict';
const { verifyProof } = require('./verify');

/**
 * @param {object} p
 * @param {object} p.proofEvent          the signed kind-30078 receipt/commit event
 * @param {string} p.expectArtifactHash  the job's expected H(spec) the escrow holds
 * @param {string} [p.expectPubkey]      issuer authorship to require
 * @param {string} [p.schemaPrefix]      e.g. "onchain-ai."
 * @param {boolean} [p.relaySeen]        did a public relay hold this event id at/ before the outcome? (your I/O)
 * @param {boolean} [p.otsVerified]      did `ots verify -d <event_id>` confirm the Bitcoin-PoW anchor? (your I/O)
 * @returns {{ ok: boolean, valid: boolean, artifact_hash_matches: boolean, anchored: boolean, verify: object }}
 */
function verifyFullFlow({ proofEvent, expectArtifactHash, expectPubkey, schemaPrefix, relaySeen, otsVerified }) {
  const verify = verifyProof(proofEvent, { expectPubkey, schemaPrefix });
  const committed = (verify.proof_payload && verify.proof_payload.artifact_hash) || null;
  const artifact_hash_matches = !!committed && !!expectArtifactHash
    && String(committed).toLowerCase() === String(expectArtifactHash).trim().toLowerCase();
  const anchored = relaySeen === true && otsVerified === true;
  return {
    ok: verify.valid === true && artifact_hash_matches && anchored,
    valid: verify.valid === true,
    artifact_hash_matches,
    anchored,
    verify,
    note: 'escrow must ALSO check on-chain delivery (assets at output_address) + nullify the artifact_hash on release.',
  };
}

module.exports = { verifyFullFlow };
