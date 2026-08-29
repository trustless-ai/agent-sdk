# ERC-8354 — Confidential Agent Policy Verdicts

A pre-execution allow/deny verdict, proven in zero knowledge against a policy
that is never disclosed on-chain.

## Recompute-to-verify: SPLIT

- **YES** for the verdict's integrity:
  - `computeActionCommitment` reproduces `keccak256(abi.encode(chainId, domainId, agentId, target, value, keccak256(callData), actionNonce))`, binding a verdict to one concrete action.
  - `verify(v, proof)` is a read-only call that anyone can run against the domain's deployed verifier with its `programKey`.
  - `computeVerdictDigest` reproduces the EIP-712 digest an executor signs to authorize a relayer.
- **NO** for the policy ruleset itself. The policy is never disclosed, and by design a `Verdict` is an integrity property only. It proves the committed interpreter evaluated the action and returned ALLOW, not that the policy is fair or correct.

A `verify` result of `true` from `MockVerifier` means the Guard delegated to
`IVerifier` correctly, not that a proof cryptographically checked out.
`testkit/test/verify/ERC8354/ConsumeReal.t.sol` covers the latter: it runs
`verify` and `consume` against the real UltraHonk verifier with a genuine
proof, and asserts a tampered proof fails.

## Layer 1 — contract clients

- `ConfidentialPolicyVerdictClient` wraps `IConfidentialPolicyVerdict`: `verify` (read), `verdict_digest` (read), `is_consumed` (read), `supports_interface` (read), and `consume` / `consume_relayed` (write).
- `PolicyDomainRegistryClient` wraps `IPolicyDomainRegistry`: `domain`, `current_root`, `is_root_acceptable` (read-only).

`domain(domain_id)` returns a domain output with six fields: `registrar`, `identity_registry`, `verifier`, `program_key`, `max_root_age`, `active`. `identity_registry` is the ERC 8004 Identity Registry this domain's agent ids live in, or the zero address on a domain that declares none, in which case the Guard's agent existence check does not apply. This mirrors `assets/erc-8354` from the merged ERC PR rather than the `agent-ercs` submodule, which still carries the earlier five field shape.

## Layer 2 — pure recompute

- `compute_action_commitment(chain_id, domain_id, agent_id, target, value, call_data, action_nonce)`
- `compute_verdict_digest(verdict, chain_id, verifying_contract)` — `verdict` is either a dict or the exported `Verdict` dataclass.
- `MECHANISM_ZK_SECRET_POLICY` constant (`keccak256("zk-secret-policy")`)

The Poseidon-based `nullifier` derivation is not exposed: it is field and
backend specific, so it has no portable recompute function in this SDK.
