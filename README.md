# @onchain-ai/agent-sdk

The off-chain **verify / recompute** layer of the [onchain-ai](https://github.com/onchain-ai) boundary
chain. One install to **commit-before-outcome**, anchor to public sources, and **verify any layer's
claims trusting no one**.

```bash
npm install @onchain-ai/agent-sdk
```

> **Status: v0.1 — API surface for review.** The pure core (verify, commit-hash, the full-flow gate,
> recompute) is implemented and tested. The network legs (relay publish, OTS stamp/verify) are
> **injected by design** — see "Why I/O is injected" below — so the SDK core stays zero-I/O and
> auditable. First consumer: [`hack-ens-recovery`](https://github.com/TMerlini/hack-ens-recovery).

## Recompute / verify — run it yourself

```bash
npm test     # build a commit, sign it, verify it, exercise the gate — no network
```

## The trust anchor, and the convenience layer over it (both shown, never a black box)

Per the org [CONTRIBUTING](https://github.com/onchain-ai/.github/blob/main/CONTRIBUTING.md), the
zero-I/O verify core is first-class and you can always step underneath the one-liner:

```js
const { verifyFullFlow, verifyProof } = require('@onchain-ai/agent-sdk');

// convenience: the whole gate in one call
const gate = verifyFullFlow({
  proofEvent, expectArtifactHash, expectPubkey,
  schemaPrefix: 'onchain-ai.', relaySeen, otsVerified,
});
// gate.ok === verify.valid && artifact_hash_matches && anchored

// underneath: the exact same trust anchor, by hand — recompute the NIP-01 id + BIP-340 sig yourself
const v = verifyProof(proofEvent, { expectPubkey });   // { valid, checks, proof_payload }
```

`verifyProof` is byte-compatible with the [`invinoveritas-verify`](https://www.npmjs.com/package/invinoveritas-verify)
reference verifier and with `https://api.babyblueviper.com/verify-proof`. `CORE.verifies_like` pins the
exact core logic version your one-liner runs.

## The gate (never `valid` alone)

```
ok = valid  AND  artifact_hash_matches  AND  anchored(relaySeen && otsVerified)
```

`valid` only proves the receipt is a genuine signed proof — **not** that it is *this* job's, and proofs
carry no nonce/expiry so a valid receipt is **replayable**. So a consumer (e.g. an escrow) must gate on
all three **plus** an on-chain delivery check (assets actually landed at `output_address`) **plus** a
nullifier (mark the `artifact_hash` spent on release). The SDK does the off-chain three; the on-chain
two are the contract's job.

## Commit-before-outcome

```js
const { buildCommitEvent, artifactHash } = require('@onchain-ai/agent-sdk');

// artifact_hash = canonical hash of the job spec. Put a job_id/salt in so two identical jobs stay
// distinct; keep result_ref / settled-tx OUT (that's the outcome leg).
const { event, artifact_hash } = buildCommitEvent({
  spec: { job_id, target_wallet, output_address, asset_set },
  pubkey, judgmentType: 'recovery_receipt',
});
event.sig = yourSigner(event.id);   // signing/keys stay yours — the SDK never touches a private key
```

`committed_at` is set to the event's `created_at`, so the commit provably predates its outcome once
anchored (relay copy + Bitcoin PoW via OpenTimestamps, `ots verify -d <event_id>`). The matching
read shape is `GET /ledger/{entry}/commitment`; the outcome leg is `GET /ledger/{entry}/outcome`.

## Why I/O is injected

Relay fetch and OTS calendar access are network, environment, and policy dependent. Keeping them out of
the core means the trust anchor is pure, deterministic, and testable, and you bring your own relay/OTS
client. `publishCommit()` / live relay+OTS helpers land in a follow-up once the surface is confirmed.

## License

Apache-2.0.
