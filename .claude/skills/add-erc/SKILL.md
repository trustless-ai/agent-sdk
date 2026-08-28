---
name: add-erc
description: Generate TypeScript, Python, and Rust SDK clients for an ERC defined in agent-ercs that doesn't have SDK support yet, including a recompute-to-verify classification, pure recompute functions (Layer 2), and tests run against golden conformance vectors (offline) then a local anvil deployment.
---

# Add ERC

Generate off-chain client support for one ERC that `agent-sdk` doesn't yet implement.

The output has two layers:
- **Layer 1** — contract wrappers: `client.ts` / `client.py` that call the on-chain contract via an RPC node (read/send/verify).
- **Layer 2** — pure recompute: `recompute.ts` / `recompute.py` with stateless functions that reproduce the ERC's deterministic computations from public inputs, verified against golden conformance vectors without requiring any blockchain node.

## Process

1. **Determine which ERC.** If not specified, ask which ERC (by number, e.g. "ERC-8301") to add. If the `agent-ercs` submodule should be read from something other than its currently checked-out `main`, ask for the branch, tag, commit, or local path to use, and check that out in `agent-ercs/` before continuing (default: whatever `main` currently points to).

2. **Read the spec.** Read the ERC's interface file(s) and `README.md` under `agent-ercs/contracts/<category>/<ERCXXXX>/`.

3. **Classify recompute-to-verify capability.** An ERC can make more than one distinct claim — classify each central claim separately rather than forcing one verdict for the whole ERC. For each claim, determine: can a caller independently obtain the same authoritative answer without trusting whoever originally submitted it — either by recomputing off-chain from public data, or by calling a deterministic, callable-by-anyone, immutable on-chain check themselves — or does the guarantee terminate at trusting a specific deployment's unfixed convention (a signing scheme, a derived value) with no way to even know what to check? Write out the reasoning — this is the part of the job that isn't mechanical.
   - See `typescript/src/identity/ERC8004/README.md` for a clean NOT-verifiable case: the interface leaves a signing convention completely unfixed, so there's nothing a generic SDK can check at all.
   - See `typescript/src/verify/ERC8274/README.md` for a split verdict on one ERC: the core validity check *is* recompute-to-verify (anyone can call the deployed, immutable verifier contract themselves and get an authoritative answer — that's a real instance of recompute-to-verify, not "just asking the same contract again"), while a separate derived value (an audit-trail digest) is NOT, because one of its inputs isn't exposed anywhere in the interface. Don't let one claim's verdict force the other's.

4. **Identify pure recompute functions (Layer 2).** For each claim the ERC makes, identify whether it involves a deterministic computation that can be reproduced off-chain from public inputs as a pure mathematical function.

   > **Enumerate the ERC's layers before you start — do not work from the example list below.**
   > An ERC may define several layers, each with its own computations and sometimes its own hash
   > function (ERC-8299 is the standing case: L1-L3 input provenance is keccak256-based, **L4
   > judgment chain-of-custody is sha256-based**). A port is complete only when every layer the ERC
   > defines is covered. Write the layer list out explicitly in the per-ERC README (step 6) and check
   > the implemented functions against it — the examples below are illustrative, never exhaustive,
   > and treating them as a checklist is how a whole layer goes missing in a new language port. This is SEPARATE from the recompute-to-verify classification in step 3:
   - **recompute-to-verify** (step 3): can a caller *independently verify* a claim by calling a contract or recomputing it? The verdict can be YES, NO, or SPLIT.
   - **pure recompute** (this step): is there a *mathematical function* that anyone can compute from public inputs to derive the expected output? The answer is a list of functions, regardless of whether the overall verdict is verifiable.
   
   An ERC can have pure recompute functions even if its overall verdict is NOT verifiable. For example, ERC-8004 is NOT recompute-to-verify (its signing convention is unfixed), but `agentId = bytes32(uint256(registryId))` is a pure recompute function — anyone can compute it from the registry ID.

   Examples of pure recompute from existing conformance vectors:
   - ERC-8004: `agentId = bytes32(uint256(registryId))` — left-padded, no hash (`step: "8004/agent-id"`)
   - ERC-8299 (L1-L3, input provenance): `raw_input_hash = keccak256(raw_user_input)` (`step: "wyriwe/raw"`)
   - ERC-8299 (L1-L3, input provenance): `sanitization_pipeline_hash = keccak256(utf8(cid) \|\| raw_input_hash)` (`step: "wyriwe/pipeline"`)
   - ERC-8299 (**L4, judgment chain-of-custody**): `rawProposalHash = sha256(utf8(artifact))` — note **sha256**, not keccak256: L4 anchors off-chain (relay-published) verdicts as well as on-chain ones
   - ERC-8299 (**L4, judgment chain-of-custody**): `verdictHash = "sha256:" + sha256(JCS(preimage fields))` — the producer's own published `decision_ref_preimage_fields`, sorted, JCS-canonical; binds the verdict to its proposal so a verdict cannot be replayed against a different one ("verdict-shopping")
   - ERC-8301: `taskHash = keccak256(abi.encode(stage, taskSeq, inputHash, timestamp, expiresAt, innerHash, workflowRunId))` (`step: "8301/task-hash"`)
   - Scope-contestation: `scopeRoot = keccak256(abi.encode(merkleRoot, count))` (`step: "scope/binding"`)
   - ENS: `namehash(name)` per EIP-137 (`step: "ens/namehash"`)
   - ERC-8275: `winRateBps = round_half_up(gated_wins * 10000 / (gated_wins + gated_losses))` (`step: "8275/reputation-bps"`)
   - ERC-8203: `verdictHash = keccak256(abi.encode(jobId, keccak256(utf8(resultText))))` (`step: "8203/settlement-proof"`)
   - Scope-contestation bond: "standing" computed from public bond state (`step: "scope/bond-standing"`)
   - Scope-contestation: resolution root from sorted votes (`step: "scope/value-fidelity"`)
   - Scope-contestation: materiality contest check (`step: "scope/contest-verify"`)
   - ERC-8312: cap conservation invariant (`step: "8312/cap-conservation"`)

   Read the conformance vectors at ``recompute-kit/conformance/agent-flow.vectors.json` (clone it as a sibling of this repo, or set `RECOMPUTE_KIT` to its path)` — they are the source of truth for what pure recompute functions exist. Each vector has a `step` field identifying the computation and `inputs`/`expected` for testing. Cross-reference steps with the ERC's claims.

   If pure recompute functions exist, add them to the proposed API in step 5. Propose one function per distinct computation, each documented with the ERC section it comes from. Don't bundle unrelated computations into one function.

5. **Propose the client API (both layers).** Based on the interface, the classification (step 3), and the identified pure recompute functions (step 4), propose the method list for both languages — including whether a `verify()` method is warranted for Layer 1 and which recompute functions are exposed for Layer 2 — and get the user's approval before writing any code.

6. **Write the per-ERC READMEs.** Under both `typescript/src/<category>/<ERCXXXX>/README.md` and `python/src/agent_sdk/<category>/<ercxxxx>/README.md` (lowercase ERC segment for Python), record the verdict, its rationale, the API summary (both layers), and whether pure recompute functions exist.

7. **Implement Layer 2 (pure recompute) — offline, no contract needed.** For each language, generate:

   **a) `recompute.ts` / `recompute.py`:**
   - Pure stateless functions, each documented with the ERC section it comes from.
   - TypeScript: import each utility as a named import from `'viem'` (top-level package), never from deep paths like `'viem/utils'`. Use these and similar pure utilities: `keccak256`, `encodeAbiParameters`, `concat`, `stringToHex`, `toHex`, `namehash`, `bytesToHex`, `hexToBytes`. NO dependency on contract clients, ABIs, viem chains, or deployed addresses.
   - Python: import only from `eth_utils` or `web3.py` equivalents (e.g. `Web3.keccak`, `eth_utils.keccak`, `eth_utils.to_bytes`, `eth_utils.to_hex`). Use `eth_utils.keccak` for hash computations — it's the standard pattern in this project. Avoid `eth_hash` unless it is a declared dependency in `pyproject.toml`. NO dependency on `web3.eth.contract` or RPC. If a computation is trivial (e.g. integer-to-bytes32 padding), pure Python without dependencies is acceptable.
   - Each function signature: clear input types (native JS/Python types, not ABI-encoded blobs) -> deterministic output. Accept `Hex` (0x-prefixed strings) for hash inputs, `number`/`bigint` for integers, `boolean` for booleans, strings for text.
   - Naming convention: TypeScript uses camelCase parameter names (matching Solidity event/function parameter style); Python uses snake_case. Export all functions as named exports. Do not wrap them in a class — they are pure module-level functions.
   - Include a JSDoc/docstring comment on each function describing what it computes and referencing the ERC section (e.g. `// ERC-8299 §45: raw_input_hash = keccak256(raw_user_input)`).

   **b) `recompute.test.ts` / `test_recompute.py`:**
   - Read golden vectors from `recompute-kit/conformance/agent-flow.vectors.json`. Use a relative path from the test file — either resolve via a symlink or compute relative to the repo root. The path to look for: `../../../../../recompute-kit/conformance/agent-flow.vectors.json` from the TypeScript test directory, or an equivalent relative path from Python.
   - For each vector whose `step` matches one of the recompute functions in this ERC, assert `recomputeFn(inputs) === expected`.
   - Test each conformance-file vector individually, not all vectors inside one test function. TypeScript: one `it(...)` per vector. Python: one parametrized test method per vector using `@pytest.mark.parametrize`.
   - Also write a self-contained inline golden vector test (duplicate the vector's inputs and expected values directly in the test file) so tests work even when recompute-kit is not present on disk or the vectors file is unreachable. This inline test is the primary assertion; the file-based reader is a secondary conformance check that vectors haven't drifted.
   - When recompute-kit vectors are not found on disk, use a guard clause / early return pattern: check existence at the top and return/skip immediately, rather than wrapping the bulk of the test logic inside an `if (vectors.length)` branch.
   - Generate an empty `__init__.py` in any new Python test directory (e.g. `python/tests/<category>/<ercxxxx>/__init__.py`) to match sibling ERC test directory patterns.
   - Tests must run without any deployed contract, anvil node, or RPC connection — pure function calls only.
   - TypeScript: use `vitest`. Python: use `pytest`.
   - Cover both happy path (inputs produce expected output) and edge cases where applicable. Edge-case checklist by operation type:

     | Operation | Edge cases to test |
     |---|---|
     | `toHex` / zero-padding | zero, one, max value within bytes32 (2^248-1) |
     | `keccak256` | empty input (`0x`), known short input (1 byte), longer input (32+ bytes), verify against a known golden hash |
     | `abi.encode` / `encodeAbiParameters` | single-argument, multi-argument, each type combination (uint, bytes32, address, tuple/bool — note Solidity encodes booleans as uint8) |
     | `concat` | empty first segment, empty second segment, both empty, multi-segment |
     | `namehash` | single-label (TLD), two-label (`name.eth`), three-label (`sub.name.eth`) |
     | Boolean / invariant checks | true/truthy and false/falsy cases |

   **c) Post-generation cleanup:** After writing all recompute files, scan each file for unused imports and remove them before finalizing. Generated code should be clean on arrival — no dangling imports from copy-paste or removed computations.

   **d) Rust `recompute.rs` + inline tests:**
   - Generate `rust/core/src/<erc_lowercase>/recompute.rs` (lowercase ERC segment, e.g. `erc8004`).
   - **Imports (module-level):** Only what the public functions need. Use `alloy_primitives::{keccak256, FixedBytes}` for hashes and bytes32 types (use `FixedBytes<32>` explicitly, not the `B256` alias). For ABI encoding, use `alloy_core::sol_types::SolValue` — this requires `sol-types` feature enabled on `alloy-core` in `Cargo.toml`. For integer-to-bytes32 padding, use `u64::to_be_bytes()` into a `[0u8; 32]` buffer.
   - **Test imports inside `#[cfg(test)]`:** Put `use alloy_primitives::hex;` inside the test module (not module-level, or it triggers "unused import" in non-test builds). Use `hex!("...")` macro for inline golden vector hex literals.
   - Pure `no_std` functions — no networking, no alloc unless needed. Each function: doc comment with ERC section, clean input types (`u64`, `FixedBytes<32>`, `&str`), `FixedBytes<32>` output (not `B256`).
   - Write inline `#[cfg(test)] mod tests { ... }` directly in `recompute.rs`. Inline golden vectors (duplicate expected values from recompute-kit) are the primary test. Each golden vector gets its own `#[test]` function. Edge cases: zero, empty input, different-inputs-different-hash, max values.
   - Tests run with `cargo test -p agent-sdk-core` — no anvil or network needed.
   - **Concrete patterns by operation type:**

     | Operation | Rust pattern |
     |-----------|-------------|
     | `bytes32(uint256(x))` left-pad | `u64_to_bytes32`: `let mut buf = [0u8; 32]; buf[24..].copy_from_slice(&x.to_be_bytes()); FixedBytes::new(buf)` |
     | `keccak256(bytes)` | `keccak256(&bytes)` — returns `FixedBytes<32>` |
     | `keccak256(utf8(str))` | `keccak256(s.as_bytes())` |
     | `concat(a, b)` then keccak | `let mut v = Vec::new(); v.extend_from_slice(a); v.extend_from_slice(b); keccak256(&v)` |
     | `abi.encode(same-type pairs)` | `(val1, val2).abi_encode()` — works for homogeneous types (both FixedBytes, both U256) |
     | `abi.encode(mixed types)` | Use `alloy_core::sol! { struct S { type1 field1; type2 field2; ... } }` then `alloy_core::sol_types::SolValue::abi_encode(&s)` — needed when types differ (e.g. `uint8 + uint256 + bytes32`) because Rust tuples don't blanket-impl `SolValue` for `u8` |
     | `sha256(bytes)` | `use sha2::Digest; use sha2::Sha256; let h = Sha256::digest(data); FixedBytes::<32>::from_slice(&h)` — note `sha2` crate (already a dependency), NOT `keccak256`. **CRITICAL: ERC-8299 L4 uses sha256, NOT keccak256 — do not mix up.** |
     | `"sha256:" + sha256(JCS(...))` | JCS (RFC 8785) canonicalization in Rust: (1) Collect keys, sort with `.sort()` (Rust's `&str` sort is lexicographic over UTF-8 bytes = code-point order — correct). (2) Build canonical JSON: `let mut parts = Vec::new(); for k in sorted_keys { let kj = serde_json::to_string(k).unwrap(); let vj = match fields.get(k) { Some(v) => serde_json::to_string(v).unwrap(), None => "null".to_string() }; parts.push(format!("{}:{}", kj, vj)); }` (3) `let canon = format!("{{{}}}", parts.join(","));` (4) `let h = Sha256::digest(canon.as_bytes());` (5) `format!("sha256:{}", hex::encode(h))`. Dependencies: `sha2::Sha256` (already in `Cargo.toml`), `serde_json` (dev-dependency, add to main deps if needed), `hex` (from `alloy_primitives`). |

   **e) Go `recompute.go` + inline tests:**
   - Generate `go/<category>/<erc_lowercase>/recompute.go` (lowercase ERC segment, e.g. `erc8275`).
   - Package name: the lowercase ERC segment (e.g. `package erc8275`).
   - **Imports:** Use `github.com/ethereum/go-ethereum/crypto` for hashes, `github.com/ethereum/go-ethereum/common` for `Hash` and `HexToHash`, `encoding/binary` for integer-to-bytes32 padding, `github.com/ethereum/go-ethereum/accounts/abi` for ABI encoding, `errors` for sentinel errors.
   - Pure stateless functions — no network, no contract address, no RPC. Each function: doc comment with ERC section, clean input types (`uint64`, `common.Hash`, `string`), return `(result, error)`.
   - Function naming: PascalCase (Go export convention), e.g. `ComputeWinRate`, `ComputeAgentId`, `ComputeObservationDigest`.
   - Return `error` for invalid inputs (zero where division by zero would occur, empty where required) — never `panic`.
   - Write inline tests in `recompute_test.go` in the same package directory. Use stdlib `testing`: `func TestGoldenXxx(t *testing.T) { ... }`. Inline golden vectors (duplicate expected values from recompute-kit) are the primary test. Each golden vector gets its own `Test` function. Edge cases: zero, empty input, different-inputs-different-hash, max values.
   - Also test from recompute-kit JSON when available: read `../../../../../recompute-kit/conformance/agent-flow.vectors.json`, filter by step, assert each. Use `encoding/json` stdlib. Wrap in a helper that logs and skips when the file is missing.
   - Tests run with `go test ./go/<category>/<erc_lowercase>/...` — no anvil or network needed.

   **Concrete patterns by operation type:**

     | Operation | Go pattern |
     |-----------|-----------|
     | `bytes32(uint256(x))` left-pad | `var b common.Hash; binary.BigEndian.PutUint64(b[24:], x)` — zero-fill then place u64 at bytes 24-31 |
     | `keccak256(bytes)` | `crypto.Keccak256Hash(data)` — returns `common.Hash` |
     | `keccak256(utf8(str))` | `crypto.Keccak256Hash([]byte(s))` |
     | `concat(a, b)` then keccak | `combined := append(a, b...); crypto.Keccak256Hash(combined)` |
     | `abi.encode(same-type pairs)` | `typ, _ := abi.NewType("bytes32", "", nil); args := abi.Arguments{{Type: typ}, {Type: typ}}; packed, _ := args.Pack(val1, val2)` |
     | `abi.encode(mixed types)` | Define each type with `abi.NewType`: `uint8Type, _ := abi.NewType("uint8", "", nil); bytes32Type, _ := abi.NewType("bytes32", "", nil); uint256Type, _ := abi.NewType("uint256", "", nil)`. Then `args := abi.Arguments{{Type: uint8Type}, {Type: uint256Type}, {Type: bytes32Type}, ...}` and `packed, _ := args.Pack(stage, taskSeq, inputHash, ...)` |
     | integer arithmetic | Standard Go `uint64` operators. Basis-points formula example: `num := wins * 20000; result := (num + total) / (2 * total)` |
     | `sha256(bytes)` | `h := sha256.Sum256(data)` — returns `[32]byte`. Format with `fmt.Sprintf("0x%x", h[:])`. Uses stdlib `crypto/sha256` and `fmt` — no go-ethereum dependency. **CRITICAL: ERC-8299 L4 uses sha256, NOT keccak256 — do not mix up.** |
     | `"sha256:" + sha256(JCS(...))` | JCS (RFC 8785) canonicalization in Go: (1) `sort.Strings(keys)` — Go's byte-order sort = code-point sort for UTF-8, so it's RFC-8785-correct. (2) Build canonical JSON string: for each sorted key `k`, `keyJSON, _ := json.Marshal(k); valJSON, _ := json.Marshal(v); parts = append(parts, string(keyJSON)+":"+string(valJSON))`. (3) `canon := "{" + strings.Join(parts, ",") + "}"`. (4) `h := sha256.Sum256([]byte(canon))`. (5) Return `"sha256:" + hex.EncodeToString(h[:])`. Nil/null handling: if a key is missing from the map entirely, emit `null` (not `""`); check with `v, exists := fields[k]; if !exists { use "null" }`. Uses stdlib `crypto/sha256`, `encoding/json`, `encoding/hex`, `sort`, `strings` — no go-ethereum needed. |

   **Post-generation cleanup:** After writing all recompute files, scan each file for unused imports and remove them. Also check that `go.mod` has the required dependencies (`github.com/ethereum/go-ethereum`). Run `go mod tidy` in the `go/` directory to add any missing entries to `go.mod` and `go.sum`.

   **f) Golden vector file reader (all languages):**

   Every ERC with recompute functions MUST include a conformance check that reads the golden vectors from `testkit/vectors/ercXXXX-xxx.vectors.json` inside this repository. Inline golden vectors remain the **primary** assertion; the file reader is the **secondary** conformance check — if the file is missing, skip with a guard clause (do not fail).

   JSON schema: `{ "schema": "...", "vectors": [ { "step": "...", "inputs": {...}, "expected": ... } ] }`.

   **Path from test file to `testkit/vectors/`:**
   - TypeScript: `../../../../testkit/vectors/` (4 levels up from `typescript/test/<category>/<ERCXXXX>/`)
   - Python: `parents[4] / "testkit" / "vectors" /` (4 levels up from `python/tests/<category>/<ercxxxx>/`)
   - Go: `filepath.Join("..", "..", "..", "testkit", "vectors", ...)` (3 levels up from `go/<category>/<ercxxxx>/`, cwd = package dir)
   - Rust: `include_str!("../../../../../testkit/vectors/...")` (5 levels up from `rust/core/src/<ercxxxx>/`)

   **TypeScript template** (add to `recompute.test.ts`):

   ```ts
   import { readFileSync, existsSync } from 'node:fs'
   import { fileURLToPath } from 'node:url'
   import { dirname, resolve } from 'node:path'

   const here = dirname(fileURLToPath(import.meta.url))
   const VECTORS = resolve(here, '../../../../testkit/vectors/ercXXXX-xxx.vectors.json')

   describe('golden vector conformance', () => {
     if (!existsSync(VECTORS)) {
       it('(no golden vectors on disk — skipping)', () => { expect(true).toBe(true) })
       return
     }
     const suite = JSON.parse(readFileSync(VECTORS, 'utf8')).vectors as { step: string; inputs: Record<string, unknown>; expected: unknown }[]
     for (const v of suite) {
       it(`${v.step}`, () => {
         switch (v.step) {
           case "<step>":
             expect(recomputeFn(v.inputs.<field> as <type>)).toBe(v.expected)
             break
           // ... one case per step in this ERC
           default:
             throw new Error(`unknown step ${v.step} — a vector exists that no function covers`)
         }
       })
     }
   })
   ```

   **Python template** (add to `test_recompute.py`):

   ```python
   import json, pathlib
   import pytest

   VECTORS = pathlib.Path(__file__).resolve().parents[4] / "testkit" / "vectors" / "ercXXXX-xxx.vectors.json"

   def _load_vectors():
       if not VECTORS.exists():
           return []
       return json.loads(VECTORS.read_text(encoding="utf-8"))["vectors"]

   @pytest.mark.parametrize("v", _load_vectors(), ids=lambda v: v.get("step", ""))
   def test_golden_vector(v):
       if v["step"] == "<step>":
           assert recompute_fn(v["inputs"]["<field>"]) == v["expected"]
       # ... elif for each additional step
       else:
           pytest.fail(f"unknown step {v['step']} — a vector exists that no function covers")
   ```

   **Go template** (add to `recompute_test.go`):

   ```go
   import (
       "encoding/json"
       "os"
       "path/filepath"
   )

   type vectorFile struct {
       Vectors []vector `json:"vectors"`
   }
   type vector struct {
       Step     string          `json:"step"`
       Inputs   json.RawMessage `json:"inputs"`
       Expected json.RawMessage `json:"expected"`
   }

   func loadVectors(t *testing.T) []vector {
       t.Helper()
       path := filepath.Join("..", "..", "..", "testkit", "vectors", "ercXXXX-xxx.vectors.json")
       raw, err := os.ReadFile(path)
       if err != nil {
           t.Skipf("golden vectors not found — skipping: %v", err)
           return nil
       }
       var file vectorFile
       if err := json.Unmarshal(raw, &file); err != nil {
           t.Fatalf("parse golden vectors: %v", err)
       }
       return file.Vectors
   }

   func TestVectorsFile(t *testing.T) {
       for _, v := range loadVectors(t) {
           t.Run(v.Step, func(t *testing.T) {
               switch {
               case v.Step == "<step>":
                   var in struct{ Field Type `json:"field"` }
                   json.Unmarshal(v.Inputs, &in)
                   // call recompute function, assert
               // ... case for each additional step
               default:
                   t.Fatalf("unknown step %q", v.Step)
               }
           })
       }
   }
   ```

   **Rust template** (add to `recompute.rs` `#[cfg(test)]` module):

   ```rust
   #[cfg(test)]
   mod golden_vector_tests {
       use serde_json::Value;

       const VECTORS_STR: &str = include_str!("../../../../../testkit/vectors/ercXXXX-xxx.vectors.json");

       #[test]
       fn golden_vectors() {
           let data: Value = serde_json::from_str(VECTORS_STR).unwrap();
           for v in data["vectors"].as_array().unwrap() {
               let step = v["step"].as_str().unwrap();
               match step {
                   "<step>" => {
                       let input = v["inputs"]["<field>"].as_u64().unwrap();
                       let expected = /* parse v["expected"] */;
                       assert_eq!(recompute_fn(input), expected);
                   }
                   _ => panic!("unknown step {}", step),
               }
           }
       }
   }
   ```

   **ERC-8275 basis-points convention:**
   The prospective `erc8275-win-rate-bps.v0` vectors carry integer basis-point
   expectations and the exact `governing_convention_hash`. Readers MUST compare
   the integer result directly and MUST reject or mark unverifiable a missing or
   unknown convention pointer. Do not convert the historical float vectors at
   read time; those remain non-retroactive evidence under their original
   convention.

   **List each vector step explicitly in the dispatch** — do NOT write `// similar for other steps`. Every dispatch is one case/elif/switch branch with its exact function call and type conversion.

8. **Run the recompute tests separately first.** Before touching any contract infrastructure, run `npx vitest run <path-to-recompute.test.ts>` (TS), `pytest <path-to-test_recompute.py>` (Python), `cargo test -p agent-sdk-core` (Rust), and `go test ./go/<category>/<erc_lowercase>/...` (Go). These must pass without any blockchain node. If they fail, debug the recompute implementation before proceeding to Layer 1.

9. **Implement Layer 1 (contract wrappers).**
   - Hand-write the ABI fragment for the functions/events the client uses, matching the interface exactly (no dynamic codegen from build artifacts).
   - **TypeScript and Python:**
     * Before writing the client, check existing ERC clients in the SAME category (identity, verify, etc.) for wallet and constructor patterns and match them. Specifically:
       * WalletClient: use the `createWalletClient({ chain: foundry, transport, account })` pattern (see ERC-8004, ERC-8274) — don't invent `{ account }` plain objects or other ad-hoc patterns.
       * Constructor: match the existing `(config, account)` signature pattern.
     * Implement the client, following the shape and conventions of `typescript/src/identity/ERC8004/client.ts` / `python/src/agent_sdk/identity/erc8004/client.py` for a single-contract ERC, or `typescript/src/verify/ERC8274/*Client.ts` / `python/src/agent_sdk/verify/erc8274/client.py` for an ERC that's really several interfaces meant to be deployed as separate, cross-referencing contracts — don't force a multi-contract ERC into one client class. For a claim classified as recompute-to-verify (a deterministic, callable-by-anyone check), expose it as a read-only simulated call/`.call()` rather than a broadcast transaction — nobody should need to spend gas or hold a funded key just to check something.
   - **Rust `client.rs`:**
     * Generate `rust/core/src/<erc_lowercase>/client.rs`. Define a generic struct `Client<D: DataProvider>` — no direct alloy transport dependency, no `tokio`. The `DataProvider` trait from `rust/core/src/trait.rs` supplies external data so the client compiles both in host (RPC-backed) and guest (preimage-backed) contexts.
     * Read-only contract calls: methods return `Result<T, ClientError>` where fetching happens via `self.provider.fetch(key)`. No `send`/broadcast in core — write methods belong in the `providers` crate or a separate host-only layer.
     * For ERCs with no contract interface (recompute-only), skip Rust Layer 1 entirely.
   - Generate `rust/core/src/<erc_lowercase>/mod.rs` that re-exports both `recompute` and `client` modules.

   - **Go `client.go`:**
     * Generate `go/<category>/<erc_lowercase>/client.go`. Define a concrete struct with `*ethclient.Client` and `common.Address` — no generics, no DataProvider trait (Go doesn't target zkVMs):
       ```go
       package ercXXXX

       import (
           "github.com/ethereum/go-ethereum/common"
           "github.com/ethereum/go-ethereum/ethclient"
       )

       type XxxClient struct {
           rpc     *ethclient.Client
           address common.Address
       }

       func NewXxxClient(rpc *ethclient.Client, addr common.Address) *XxxClient {
           return &XxxClient{rpc: rpc, address: addr}
       }
       ```
     * Read-only contract calls: methods return `(T, error)` using `ethclient.Client.CallContract()` with `abi.ABI.Pack(name, args...)` for input encoding and `abi.Arguments.Unpack()`/`abi.ABI.Unpack()` for output decoding. GOTCHA: `abi.Arguments.Pack()` packs the arguments ONLY — it does not prepend the 4-byte method selector. Use `a.Pack(methodName, args...)` (which does) or `append(method.ID, packed...)`; a bare `method.Inputs.Pack(...)` produces a 32-byte-zero fallback call that reverts.
     * Write/send methods: return `(*types.Transaction, error)` using `ethclient.Client.SendTransaction()` with a signed tx built via `bind.NewKeyedTransactorWithChainID()`.
     * ABI kept in `abi.go` as parsed `abi.ABI` from a JSON string constant, or as hand-crafted `abi.Arguments` for simple interfaces.
     * For ERCs with no contract interface (recompute-only), skip Go Layer 1 entirely.

   - **Rust integration tests** (for ERCs with a contract interface):
     * Create `rust/core/tests/<erc_lowercase>_integration.rs`. This test uses the same testkit workflow as TS/Python: anvil running, contract deployed via Foundry deploy script, then calls the contract through the generated Rust client.
     * The integration test should use `alloy-provider` + `alloy-transport-http` (or the full `alloy` meta-crate) for a proper RPC client with signing, nonce management, and gas estimation. Raw `reqwest` + JSON-RPC works for `eth_call` (read-only) but NOT for `eth_sendTransaction` (writes) which need signing.
     * Dev-dependencies needed in `rust/core/Cargo.toml`: `alloy = { version = "2", features = ["full"] }`, `serde_json = "1"`, `tokio` (with `rt` and `macros` features). Version 2.x avoids serde conflicts present in 0.11/0.12. Update `rust/providers/Cargo.toml` to use the same alloy version so workspace resolution doesn't conflict.
     * Define ABI inline using `alloy::sol!` macro with `#[sol(rpc)]` attribute. Use tuple types in function signatures for struct parameters (e.g. `(string, bytes)[]` not `(string, bytes32)[]` — Solidity `bytes` vs `bytes32` encode differently). Create a provider with `ProviderBuilder::new().wallet(signer).connect_http(url)` (note: `connect_http` in v2, not `on_http`). Return types from `call()` use `.0` field access (v2 changed from `._0`).
     * Signer: read the deployer private key from `testkit/.anvil-accounts.json` (account index 0) at runtime, or accept it as an env var `ANVIL_KEY`. Do NOT hardcode a specific private key — anvil generates fresh keys on each start, so a hardcoded key will fail on the next anvil session.
     * Tests match the same flow as TS/Python: anvil start → forge deploy → register/setup → read → assert. Contract address should be read from env var `ERCXXXX_ADDRESS` with a sensible fallback.

   - **Go integration tests** (for ERCs with a contract interface):
     * Create `go/test/<erc_lowercase>_integration_test.go`. Package name: `test`.
     * Read contract address from env var `ERCXXXX_ADDRESS` with `os.Getenv("ERCXXXX_ADDRESS")`. At test start, assert address is not zero: `if addr == (common.Address{}) { t.Fatal("ERCXXXX_ADDRESS not set — deploy first via testkit/scripts/deploy.sh <category>/<ERCXXXX> <DeployScriptName>") }`.
     * Read signer key from `../../testkit/.anvil-accounts.json` relative to the test file. Parse the JSON to extract `accounts[0].privateKey`. Use `crypto.HexToECDSA()` to create a private key and `bind.NewKeyedTransactorWithChainID()` to create an auth for transactions.
     * Connect to anvil: `ethclient.Dial("http://127.0.0.1:8545")`.
     * ABI: define the interface inline using a JSON ABI string + `abi.JSON(strings.NewReader(abiJSON))`.
     * Tests match the same flow as TS/Python/Rust: anvil start → forge deploy → register/setup → read → assert.
     * If the ERC deploys multiple contracts (multi-line output from deploy.sh), read all comma-separated or newline-separated addresses from the env var.
     * Run with `ERCXXXX_ADDRESS=0x... go test -v ./go/test/ -run TestERCXXXX`.
   - If the ERC needs a contract to deploy for testing and `agent-ercs` has no base implementation yet, write a minimal reference implementation under `testkit/contracts/mocks/<category>/<ERCXXXX>/` (one file per contract if the ERC needs more than one), clearly commented as local-testing-only (see `MockIdentityRegistry.sol` for a single-contract pattern, `MockProofVerifier.sol`/`MockAgentVerifier.sol`/`MockAgentVerifiable.sol` for a multi-contract one), plus a Foundry unit test for it/them under `testkit/test/<category>/<ERCXXXX>/`.
   - Write `testkit/script/<category>/<ERCXXXX>/Deploy<ERCXXXX>.s.sol` (file basename must match its contract name, e.g. `DeployERC8301.s.sol` containing `contract DeployERC8301` — Foundry keys broadcast artifacts by script basename only, so reusing a generic name like `Deploy.s.sol` across ERCs would collide). If the ERC needs several wired-together contracts, deploy all of them in one script (constructor-inject each into the next) — `testkit/scripts/deploy.sh` prints one address per line in the order each was deployed; use `deployContracts()`/`deploy_contracts()` (plural, returning the full list) instead of the single-address `deployContract()`/`deploy_contract()` to receive all of them (see `typescript/test/verify/ERC8274/erc.test.ts` / `python/tests/verify/erc8274/test_erc.py`).
   - Write tests for both languages that deploy via `testkit/scripts/deploy.sh` (see `typescript/test/identity/ERC8004/erc.test.ts` and `python/tests/identity/erc8004/test_erc.py` for the single-contract wiring pattern, or the ERC-8274 test files above for multi-contract) and call the client's methods. For any claim classified as recompute-to-verify, also test that the check rejects tampered/incorrect data (a bad proof, a bad signature) — some checks reject by returning a falsy result rather than reverting; assert whichever the contract actually does, don't assume a revert.
   - If double-checking a byte-encoding assumption against the actual Solidity (e.g. whether a hash was built with `abi.encode` vs `abi.encodePacked` — they differ for `bool` and other non-32-byte-aligned types), verify it against the real contract rather than assuming the two are interchangeable.

10. **Wire up package exports.** After both layers are implemented, register the new ERC in the package's public API so consumers can import it.

    **TypeScript:**
    - Create a barrel `index.ts` in the ERC directory (`typescript/src/<category>/<ERCXXXX>/index.ts`) that re-exports the client class(es), recompute functions, and any public types. Use named re-exports. See `typescript/src/identity/ERC8004/index.ts` for the single-client pattern or `typescript/src/execution/ERC8301/index.ts` for a multi-client pattern.
    - Add subpath exports to `typescript/package.json` in the `"exports"` field, in the same alphabetical order as existing entries:
      * Full-entry: `"./<category>/<ERCXXXX>": { "types": "./dist/<category>/<ERCXXXX>/index.d.ts", "default": "./dist/<category>/<ERCXXXX>/index.js" }`
      * Recompute-only (if recompute functions exist): `"./<category>/<ERCXXXX>/recompute": { "types": "./dist/<category>/<ERCXXXX>/recompute.d.ts", "default": "./dist/<category>/<ERCXXXX>/recompute.js" }`

    **Python:**
    - Populate the ERC module's `__init__.py` (`python/src/agent_sdk/<category>/<ercxxxx>/__init__.py`) with proper named imports and `__all__`. See `python/src/agent_sdk/identity/erc8004/__init__.py` for a single-client pattern or `python/src/agent_sdk/execution/erc8301/__init__.py` for a multi-client pattern. Do not leave it empty — it must export all public classes and functions.
    - Update the category-level `__init__.py` (`python/src/agent_sdk/<category>/__init__.py`) with a docstring-only or import-based entry if it doesn't reference the new ERC yet.

    **Rust:**
    - Add `pub mod <erc_lowercase>;` to `rust/core/src/lib.rs` to register the new ERC module.
    - If the ERC introduces a new category that doesn't yet exist in `rust/core/src/`, create an empty category-level `mod.rs` and add the `pub mod` line for it from `lib.rs`.

    **Go:**
    - Create the ERC package directory: `go/<category>/<erc_lowercase>/`. Go packages are self-contained — no central registration needed. Ensure `go.mod` has all required dependencies by running `go mod tidy` from the `go/` directory.

11. **Update root README.** Append the new ERC to the "Supported ERCs" table in the repo root `README.md`. Match the existing row format: ERC name with link to agent-ercs, category, Contract Calls column (list client classes or `—`), Recompute column (list recompute functions or `—`). Insert in alphabetical order within its category.

12. **Run every new test to green via testkit** — recompute tests first (offline), then deploy and run integration tests through the testkit harness. **This is a hard requirement: every ERC with a contract interface MUST pass its Rust integration test against a local anvil deployed via testkit before the ERC is considered done.**

    **Recompute (Layer 2 — offline, no blockchain needed):**
    - `npx vitest run <recompute test path>` (TS)
    - `pytest <recompute test path>` (Python)
    - `cargo test -p agent-sdk-core --lib <erc_lowercase>` (Rust)
    - `go test ./go/<category>/<erc_lowercase>/...` (Go)

    **Integration (Layer 1 — testkit workflow, required for ERCs with a contract interface):**
    - Start anvil: `testkit/scripts/start-anvil.sh`
    - Deploy the mock/real contract: `testkit/scripts/deploy.sh <category>/<ERCXXXX> <DeployScriptName>`
    - Run TS integration tests: `npx vitest run`
    - Run Python integration tests: `pytest`
    - Run Rust integration test: `export ERCXXXX_ADDRESS=<addr> && cargo test --manifest-path rust/core/Cargo.toml --test <erc_lowercase>_integration -- --nocapture`
      * The Rust test reads the contract address from `ERCXXXX_ADDRESS` env var and the signer key from `testkit/.anvil-accounts.json`. It must connect via alloy v2 to the deployed contract and call at least one read and one write method (if writable).
      * If the Rust integration test fails, do NOT proceed — fix the code, re-deploy, and re-run until green.
    - Run Go integration test: `export ERCXXXX_ADDRESS=<addr> && go test -v ./go/test/ -run TestERCXXXX`
      * The Go test reads the contract address from `ERCXXXX_ADDRESS` env var and the signer key from `testkit/.anvil-accounts.json`. It must connect via `ethclient.Dial` to the deployed contract and call at least one read and one write method (if writable).
      * If the Go integration test fails, do NOT proceed — fix the code, re-deploy, and re-run until green.
    - Run each language's *full* suite — shared anvil instance and deployer account across all ERCs can reveal cross-file issues (nonce races, etc.).
    - Stop anvil: `testkit/scripts/stop-anvil.sh`

## What gets committed

Only the final READMEs, recompute layer (recompute.ts/md, recompute.py, recompute.rs, recompute tests), client code (client.ts, client.py, client.rs, contract wrappers tests), barrel files (index.ts, __init__.py, mod.rs), package.json exports, and Rust module registrations. Discussion during the early steps is scratch and is not committed.
