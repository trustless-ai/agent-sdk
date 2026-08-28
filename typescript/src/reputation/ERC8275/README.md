# ERC-8275 — Agent Reputation (TypeScript)

**Recompute-to-verify: SPLIT (one claim YES, one claim YES-as-contract-call, one claim NO).**

| Claim | Verdict | Rationale |
|-------|---------|-----------|
| Win rate (`winRate = wins/(wins+losses)`) | **YES — pure recompute** | Deterministic arithmetic from public inputs (wins/losses). Anyone with the event log can independently recompute this without trusting a third party. |
| Composite score (`f(attestationCount, counterpartyDiversity, winRate, volumeCap)`) | **NOT verifiable** | The spec defines only a "recommended scoring shape" — the exact function is implementation-defined, so a generic SDK cannot reproduce it. |
| `verifyOutcome` (on-chain proof check) | **YES — contract-level verify** | A `view` function anyone can call via a simulated contract call (no gas, no key). Gives the contract's authoritative answer without broadcasting a transaction. |

## Layer 1 — Contract wrappers

**`AgentReputationClient`** reads reputation state from a deployed ERC-8275 contract.

| Method | Description |
|--------|-------------|
| `getReputation(agentId)` | Read the current reputation snapshot (completedOrders, disputedOrders, totalVolume, lastActiveAt, score). |
| `getDecayWeight(agentId)` | Read the recency-decay weight in basis points. |
| `verifyOutcome(orderId, proof)` | Read-only simulated call — verify a settled order's outcome proof against the public record. |

All three calls are read-only; no gas or broadcast needed.

## Layer 2 — Pure recompute

One deterministic computation reproducible off-chain from public inputs:

- **`computeWinRate(wins, losses)`** — integer basis points under `erc8275-win-rate-bps.v0`: `round_half_up(gated_wins * 10000 / (gated_wins + gated_losses))`. Golden vector: `wins: 16, losses: 15` —> `5161`.

The recompute function is tested against the prospective `erc8275-win-rate-bps.v0` vectors vendored at `testkit/vectors/erc8275-reputation-bps-v0.vectors.json` (step `8275/reputation-bps`). Every vector pins the governing convention hash; the separate historical `erc8275-reputation.vectors.json` float artifact remains byte-identical and is not relabelled. The recompute tests are pure function calls with no RPC, no anvil, and no deployed contract.

See `client.ts` for the contract wrapper, `recompute.ts` for the pure function, and `test/reputation/ERC8275/` for tests.
