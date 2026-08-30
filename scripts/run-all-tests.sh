#!/usr/bin/env bash
#
# Run every suite in this repo: Foundry, TypeScript, Python, Go, Rust, plus the
# provenance check on the vendored ERC-8354 verifier.
#
# CI calls this, and so can you:
#
#   git clone https://github.com/trustless-ai/agent-ercs   # into ./agent-ercs
#   ./scripts/run-all-tests.sh
#
# Everything runs in ONE process so the anvil started here survives until the
# end. Splitting anvil and the suites across separate shells kills it between
# them, and every integration test then reports "ADDRESS not set" — which looks
# like a broken test suite rather than a dead node.
#
# Exit code is the verdict: 0 only if every suite passed.

set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1

FAILED=""
note() { echo ""; echo "── $*"; }

cleanup() { bash testkit/scripts/stop-anvil.sh >/dev/null 2>&1 || true; }
trap cleanup EXIT

# ── Preconditions ──────────────────────────────────────────────────────────
# The testkit's foundry remapping is @agent-ercs/=../agent-ercs/contracts/,
# resolved from testkit/, so the interfaces repo must sit at ./agent-ercs.
# Without it the mocks do not compile and every on-chain suite fails with a
# missing-source error that reads like a code problem.
if [ ! -d agent-ercs/contracts ]; then
  echo "ERROR: ./agent-ercs is missing." >&2
  echo "       git clone https://github.com/trustless-ai/agent-ercs" >&2
  exit 1
fi

# The vendored ERC-8354 verifier and fixture proof are what makes
# ConsumeReal.t.sol a real cryptographic check rather than a shaped one, so the
# hashes PROVENANCE.md pins have to hold before any of that is worth running.
# Offline on purpose: --upstream refetches the pinned source, which would make a
# green build depend on raw.githubusercontent.com being up.
note "provenance (vendored ERC-8354 verifier)"
./scripts/check-provenance.sh || FAILED="$FAILED provenance"

note "forge deps"
(cd testkit && [ -d lib/forge-std ] || forge install foundry-rs/forge-std --no-git >/dev/null 2>&1)
(cd testkit && [ -d lib/openzeppelin-contracts ] || forge install OpenZeppelin/openzeppelin-contracts --no-git >/dev/null 2>&1)
(cd testkit && forge build >/dev/null 2>&1) || { echo "ERROR: testkit failed to compile" >&2; exit 1; }

# The Solidity suite gates too. Until this was added the script only ever built
# the testkit, so the Foundry tests were compiled on every CI run and executed
# on none of them -- a contract could go red and CI would still be green.
# It needs no anvil, so it runs here, before the slower suites.
note "Foundry (testkit)"
(cd testkit && forge test) || FAILED="$FAILED foundry"

# TypeScript FIRST, and this ordering is load-bearing.
#
# typescript/vitest.config.ts sets globalSetup: ['./test/setup/anvil.ts'], which
# calls start-anvil.sh on setup and stop-anvil.sh on teardown. It owns anvil's
# lifecycle globally, so running it AFTER we stand up a node kills that node and
# every Go/Rust integration test then fails with "connection refused" -- which
# reads as broken tests rather than a torn-down dependency.
note "TypeScript (manages its own anvil)"
(cd typescript && { npm ci --silent 2>/dev/null || npm install --silent 2>/dev/null; }; npx vitest run) || FAILED="$FAILED typescript"

note "Python"
# The [dev] extra is where pytest lives. Installing the package alone gives
# "No module named pytest" -- which passed locally only because the venv
# already had it, and CI caught on its first run.
(cd python && python3 -m pip install -q -e ".[dev]" && python3 -m pytest -q) || FAILED="$FAILED python"

note "anvil + deploy (for Go and Rust)"
bash testkit/scripts/stop-anvil.sh >/dev/null 2>&1 || true
rm -f testkit/.anvil.pid
bash testkit/scripts/start-anvil.sh || { echo "ERROR: anvil failed to start" >&2; exit 1; }

ENV_FILE="$(mktemp)"
if ! bash testkit/scripts/deploy-all.sh > "$ENV_FILE"; then
  echo "ERROR: deployment failed -- integration suites would report 'ADDRESS not set'" >&2
  exit 1
fi
# anvil regenerates keys on every start, so the deployer key is read at run time.
ANVIL_KEY="$(python3 -c "import json;print(json.load(open('testkit/.anvil-accounts.json'))['accounts'][0]['privateKey'])")"
export ANVIL_KEY
set -a; . "$ENV_FILE"; set +a
echo "   $(grep -c '^export' "$ENV_FILE") address exports + ANVIL_KEY"

# Package suites gate. go/test (the integration package) used to be split out
# into a separate "known-failing, not gating" block below, tracking a single
# real finding (TestERC8301AgentWorkflow) that was reported on every run but
# never allowed to fail the build. That finding is fixed -- KNOWN-FAILURES.md
# has said "no known failures" since, and running the full package here
# confirms it: go/test passes cleanly like every other package. The old split
# meant an ERC-8354 (or any other) regression inside go/test's non-ERC-8354
# tests would only ever surface inside the known-failing block, where it read
# as "still failing on the known issue" instead of failing the build --
# genuinely gate the whole package now that there is nothing left to quarantine.
note "Go (all packages, including go/test)"
(cd go && go test -count=1 ./...) || FAILED="$FAILED go"

# --test-threads=1 is REQUIRED for the integration tests. They all send
# transactions from the same anvil account, and cargo runs test binaries in
# parallel by default, so concurrent sends race on the nonce and fail with
# "nonce too low". Serialising them turns erc8312 from 1/3 into 3/3 -- the
# failure was never in the code under test.
note "Rust"
(cd rust && cargo test --lib && cargo test --tests -- --test-threads=1) || FAILED="$FAILED rust"

# ── Verdict ────────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════"
if [ -n "$FAILED" ]; then
  echo "FAILED:$FAILED"
  exit 1
fi
echo "All five suites passed."
