# Known failures

No known failures. Every suite runs green on CI.

Entries were **executed and reported**, never excluded — a skipped test that
nobody sees is how a suite drifts from green-because-correct to
green-because-quiet. Delete an entry the moment it passes; delete the file when
the list empties.

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
