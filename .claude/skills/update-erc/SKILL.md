---
name: update-erc
description: Refresh existing TypeScript, Python, and Rust SDK clients after an ERC's interface or semantics changed in agent-ercs, re-classifying recompute-to-verify capability only if the change affects it, and adding or updating pure recompute functions (Layer 2).
---

# Update ERC

Refresh SDK support for an ERC that `agent-sdk` already implements, after `agent-ercs` changed something about it. Like `add-erc`, the output has two layers:
- **Layer 1** — contract wrappers: `client.ts` / `client.py`
- **Layer 2** — pure recompute: `recompute.ts` / `recompute.py`

## Process

1. **Determine what changed.** If not specified, ask which ERC changed in `agent-ercs`, and what changed (or point to the commit/PR). Check out the relevant `agent-ercs` ref if it differs from what's currently checked out.

2. **Diff against what's implemented.** Compare the current `agent-ercs` interface against the existing clients for all four languages. Check whether the recompute layer files exist:
   - `typescript/src/<category>/<ERCXXXX>/recompute.ts` + test
   - `python/src/agent_sdk/<category>/<ercxxxx>/recompute.py` + test
   - `rust/core/src/<erc_lowercase>/recompute.rs` (inline `#[cfg(test)]`)
   - `go/<category>/<erc_lowercase>/recompute.go` + `recompute_test.go`
   
   If they're missing and the ERC has spec changes (or had recompute-able claims that were never extracted), flag that Layer 2 needs to be created.

3. **Re-classify only if warranted.** Re-run the recompute-to-verify classification (see `add-erc`'s step 3) only if the interface or semantics changed in a way that could affect the verdict. Otherwise, carry the existing verdict forward unchanged.

4. **Identify pure recompute functions (Layer 2).** For each claim the ERC makes, determine whether it involves a deterministic computation reproducible off-chain as a pure function. This is SEPARATE from recompute-to-verify classification (step 3). See `add-erc`'s step 4 for the full methodology and examples.

   Read the conformance vectors at `/Users/shakku/code/recompute-kit/conformance/agent-flow.vectors.json` — cross-reference the `step` field with the ERC's claims. Any new or changed pure recompute functions from the spec update should be reflected here.

   If the recompute layer files already exist, diff them against any spec changes to the ERC and update accordingly. If they're missing and the ERC has pure recompute claims, plan to generate them.

5. **Propose the updated API.** Based on the interface diff, the re-classification (if run), and the identification of pure recompute functions, propose what changes are needed for both layers and get the user's approval before writing any code.

6. **Update or create the recompute layer (Layer 2).**

   **If files already exist:** Update the affected functions in `recompute.ts` / `recompute.py` / `recompute.rs` and their tests based on any spec changes. Follow the naming convention (camelCase for TS, snake_case for Python, snake_case for Rust), viem top-level import style, test-per-vector granularity, `eth_utils.keccak` preference, `__init__.py` generation, Rust `#[cfg(test)]` inline test pattern, and edge-case checklist from `add-erc`'s step 7. Append new recompute functions if the ERC gained new deterministically computable claims. Amend tests with new golden vectors from the conformance file. After making changes, scan each modified file for unused imports and remove them before finalizing.
   - Go: `recompute.go` + `recompute_test.go` with `func TestGoldenXxx(t *testing.T)` — one test function per golden vector. Follow the naming convention (PascalCase), `crypto.Keccak256Hash` pattern, `common.Hash` for bytes32, ABI encoding with `abi.Arguments.Pack()`, and edge-case checklist from `add-erc`'s step 7e.
   - **Golden vector file reader:** Check whether the recompute test reads from `testkit/vectors/ercXXXX-xxx.vectors.json`. If it doesn't have a file reader, add one following `add-erc`'s step 7f. If it has a reader pointing to `recompute-kit/` (external repo), change the path to `testkit/vectors/` (this repo).

   **If files don't exist but the ERC has pure recompute claims:** Generate them fresh following the `add-erc` skill's step 7 — stateless functions tested against golden conformance vectors, no contract dependencies. Apply the same conventions for all four languages (TS camelCase, Python/Rust snake_case, top-level `'viem'` imports for TS, `eth_utils.keccak` for Python, `alloy-core` primitives for Rust, guard-clause pattern for missing vectors, one test-per-vector granularity, `__init__.py` for new Python test dirs, Rust `#[cfg(test)]` inline tests, edge-case checklist by operation type, and post-generation unused-import scan).
   - Go: `recompute.go` + `recompute_test.go` following `add-erc`'s step 7e — PascalCase naming, `(result, error)` returns, `testing` stdlib, `crypto.Keccak256Hash`/`common.Hash` primitives, one `func Test` per golden vector.
   - **Golden vector file reader:** Include a file reader in the generated recompute tests following `add-erc`'s step 7f, reading from `testkit/vectors/`.

   **If the ERC has no pure recompute claims:** Confirm that no recompute files are needed and move on.

7. **Run recompute tests separately first.** Before touching any contract infrastructure:
   - `npx vitest run <path-to-recompute.test.ts>` (TS)
   - `pytest <path-to-test_recompute.py>` (Python)
   - `cargo test -p agent-sdk-core` (Rust)
   - `go test ./go/<category>/<erc_lowercase>/...` (Go)
   
   These must pass without any blockchain node. If they fail, debug the recompute implementation before proceeding to Layer 1.

8. **Update Layer 1 (contract wrappers).**
   - **TypeScript and Python:**
     * Before writing the client, check existing ERC clients in the SAME category (identity, verify, etc.) for wallet and constructor patterns and match them. Specifically:
       * WalletClient: use the `createWalletClient({ chain: foundry, transport, account })` pattern (see ERC-8004, ERC-8274) — don't invent `{ account }` plain objects or other ad-hoc patterns.
       * Constructor: match the existing `(config, account)` signature pattern from the same category.
     * Update the affected client code and tests in both languages.
   - **Rust:**
     * If `rust/core/src/<erc_lowercase>/client.rs` exists, update it to match any spec changes. If it doesn't exist but the ERC now has a contract interface, generate it following `add-erc`'s step 9 (Rust pattern: generic `Client<D: DataProvider>`, no direct alloy transport).
     * If the recompute function signatures changed, update `recompute.rs` and its inline `#[cfg(test)]` tests.
   - **Go:**
     * If `go/<category>/<erc_lowercase>/client.go` exists, update it to match any spec changes. If it doesn't exist but the ERC now has a contract interface, generate it following `add-erc`'s step 9 (Go pattern: concrete struct with `*ethclient.Client` + `common.Address`, no generics).
     * If the recompute function signatures changed, update `recompute.go` and its `recompute_test.go` tests.
   - Update `testkit/script/<category>/<ERCXXXX>/Deploy<ERCXXXX>.s.sol` (and the mock in `testkit/contracts/mocks/<category>/<ERCXXXX>/`, if one exists) if the contract's constructor or initialization interface changed.

9. **Wire up package exports.** After both layers are updated, ensure the new or changed files are properly exported.

    **TypeScript:**
    - If the ERC's barrel `index.ts` (`typescript/src/<category>/<ERCXXXX>/index.ts`) exists, update it to export any new client classes or recompute functions. If it doesn't exist, create it — see `typescript/src/identity/ERC8004/index.ts` for the pattern.
    - Update or add subpath exports in `typescript/package.json` under `"exports"` to match the files that exist. Follow the existing alphabetical ordering. Each ERC typically needs two entries (full-entry and recompute-only) — see any existing ERC's exports for the exact shape.

    **Python:**
    - Update the ERC module's `__init__.py` (`python/src/agent_sdk/<category>/<ercxxxx>/__init__.py`) to export any new public classes or functions. If it doesn't exist yet, create it following the pattern in `python/src/agent_sdk/identity/erc8004/__init__.py`.
    - Update the category-level `__init__.py` if the new ERC isn't referenced there yet.

    **Rust:**
    - If the ERC module is new or the `pub mod <erc_lowercase>;` line is missing from `rust/core/src/lib.rs`, add it.
    - If the recompute module or client module were added to this ERC, update `rust/core/src/<erc_lowercase>/mod.rs` to export them.

    **Go:**
    - Ensure the ERC package directory `go/<category>/<erc_lowercase>/` exists and contains the expected files. Run `go mod tidy` from the `go/` directory to sync dependencies.

10. **Update root README.** If the ERC is newly supported (wasn't in the "Supported ERCs" table before), append it to the table in the repo root `README.md`. Match the existing row format: ERC name with link to agent-ercs, category, Contract Calls column (list client classes or `—`), Recompute column (list recompute functions or `—`). If the ERC already exists in the table, update its row to reflect any changes (new clients, new recompute functions). Insert or keep in alphabetical order within its category.

11. **Amend the per-ERC READMEs.** Append a dated entry to both existing `README.md` files (TS and Python) describing what changed and why, including any additions or changes to the recompute layer and exports. Amend, don't overwrite — the change history is part of the record.

12. **Run every affected test to green via testkit** — recompute tests first (offline), then deploy and run integration tests through the testkit harness. **Hard requirement: every ERC with a contract interface MUST pass its Rust integration test against a local anvil deployed via testkit.**

    **Recompute (Layer 2 — offline):**
    - `npx vitest run <recompute test path>` (TS)
    - `pytest <recompute test path>` (Python)
    - `cargo test -p agent-sdk-core --lib <erc_lowercase>` (Rust)
    - `go test ./go/<category>/<erc_lowercase>/...` (Go recompute — offline)

    **Integration (Layer 1 — testkit workflow):**
    - Start anvil: `testkit/scripts/start-anvil.sh`
    - Deploy: `testkit/scripts/deploy.sh <category>/<ERCXXXX> <DeployScriptName>`
    - `npx vitest run` (TS)
    - `pytest` (Python)
    - `export ERCXXXX_ADDRESS=<addr> && cargo test --manifest-path rust/core/Cargo.toml --test <erc_lowercase>_integration -- --nocapture` (Rust)
    - `export ERCXXXX_ADDRESS=<addr> && go test -v ./go/test/ -run TestERCXXXX` (Go integration)
    - Run full suites (cross-ERC anvil nonce issues), then stop anvil.

## What gets committed

Only the updated READMEs, recompute layer (recompute.ts, recompute.py, recompute tests), client code (client.ts, client.py, contract wrappers tests), barrel files (index.ts, __init__.py), and package.json exports. Discussion during the early steps is scratch and is not committed.
