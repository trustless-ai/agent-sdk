# Known failures

Tests that run on every CI run and currently fail. They are **executed and
reported**, never excluded — a skipped test that nobody sees is how a suite
drifts from green-because-correct to green-because-quiet.

Delete an entry the moment it passes; delete the file when the list empties.

---

## `go/test` — `TestERC8301AgentWorkflow`

**Status:** real finding, not a setup problem.

The test gets as far as a successful run: `run()` returns a `runId`, and
`getAgentTask` reads back `stage=1 proven=true`. It then calls `onAgentProve`
for the **reply** and the reply does not come back proven:

```
erc8301_integration_test.go:164: reply proven = false after onAgentProve, want true
erc8301_integration_test.go:167: reply verifier = 0x000…000, want signer 0x835f…0D3A
erc8301_integration_test.go:170: reply verificationDigest = 0x000…000,
                                 want keccak256(proof) 0x2adf2af3…45d68
```

Three zero values where the prove call should have written a verifier, a digest
and the flag. The same flow works for the task earlier in the test, so this is
specific to the reply path — either the client targets the wrong record or the
mock does not persist reply proofs.

Owner: whoever owns `go/execution/erc8301` (@JimmyShi22 wrote the Go SDK).
Not diagnosed further here rather than guessed at.

---

## Fixed while adding CI (kept for the record)

These looked like known failures and were not:

- **Rust `erc8312_integration`** — failed with `nonce too low`. All the
  integration tests send from one anvil account and `cargo` runs test binaries
  in parallel, so they raced on the nonce. `--test-threads=1` → 3/3. Nothing
  wrong with the code under test.
- **Rust `erc8274` / `erc8312` address parsing** — split `_ADDRESSES` on `,`
  while `deploy.sh` emits one address per line and Go reads with
  `strings.Fields`. `erc8312` used both separators in the same file. Now
  `split_whitespace()`.
- **Rust `erc8323`** — `.parse()`d a two-address value as one address. It needs
  the binding registry, which is index `[1]` in broadcast order (documented in
  the Go test). Now takes the last address.
- **The "10 pre-existing failures"** — not an RPC problem, as previously
  assumed. `./agent-ercs` was simply not checked out, so the testkit mocks
  could not compile.
