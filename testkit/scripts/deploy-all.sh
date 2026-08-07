#!/usr/bin/env bash
#
# Deploy every testkit contract to a local anvil and emit the address env vars
# the Go and Rust integration suites read.
#
#   eval "$(testkit/scripts/deploy-all.sh)"     # exports into the current shell
#   testkit/scripts/deploy-all.sh > env.sh      # or capture for a later step
#
# Progress goes to stderr, exports to stdout, so the two never mix.
#
# Deployments are DISCOVERED from testkit/script rather than listed here. Adding
# an ERC wires it in automatically; a hardcoded list would let a new ERC's
# integration tests sit permanently unrun while CI stayed green — which is the
# failure this whole file exists to prevent.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TESTKIT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "$TESTKIT_DIR" || exit 1

log() { echo "$@" >&2; }

# Each entry is "<category/ERCXXXX> <DeployContractName>", derived from the
# script tree.
TARGETS=$(
  find script -name "Deploy*.s.sol" \
    | sed -E 's|^script/(.*)/(Deploy[A-Za-z0-9]+)\.s\.sol$|\1 \2|' \
    | sort
)

COUNT=$(printf '%s\n' "$TARGETS" | grep -c '[^[:space:]]' || true)
if [ "$COUNT" -eq 0 ]; then
  log "ERROR: no deploy scripts found under testkit/script — discovery is broken."
  log "       Refusing to emit an empty environment, which would make the"
  log "       integration suites fail with 'ADDRESS not set' and look like a"
  log "       test problem rather than a setup one."
  exit 1
fi

log "Deploying $COUNT contract set(s) to anvil..."

FAILED=""
while IFS=' ' read -r ERC_PATH CONTRACT; do
  [ -n "${ERC_PATH:-}" ] || continue

  ERC_ID=$(basename "$ERC_PATH")

  # deploy.sh prints one address per contract creation, in broadcast order.
  OUT=$(bash "${SCRIPT_DIR}/deploy.sh" "$ERC_PATH" "$CONTRACT" 2>/dev/null)
  N=$(printf '%s\n' "$OUT" | grep -c '^0x' || true)

  if [ "$N" -eq 0 ]; then
    log "  FAILED  $ERC_PATH ($CONTRACT)"
    FAILED="$FAILED $ERC_ID"
    continue
  fi

  # Emit BOTH names, each carrying the FULL deploy output.
  #
  # The suites are inconsistent in a way that is not derivable: ERC-8004 reads
  # ERC8004_ADDRESS and wants one address; ERC-8274 reads ERC8274_ADDRESSES and
  # wants three; ERC-8323 reads the SINGULAR ERC8323_ADDRESS and wants two.
  # Name and cardinality vary independently, so the only safe thing is to
  # publish both names with everything the deploy produced, in broadcast order.
  #
  # For a single-contract deploy both are one address, which is what every
  # existing caller already expects. Guessing per-ERC would export the right
  # name with the wrong contents and the suite would say "got 0" -- reading as
  # a deployment failure rather than a setup bug.
  log "  ok      ${ERC_ID}  ($N address$([ "$N" -eq 1 ] || echo es))"
  echo "export ${ERC_ID}_ADDRESS=\"${OUT}\""
  echo "export ${ERC_ID}_ADDRESSES=\"${OUT}\""
done <<EOF
$TARGETS
EOF

if [ -n "$FAILED" ]; then
  log ""
  log "ERROR: deployment failed for:$FAILED"
  log "       Not emitting a partial environment — the suites would report"
  log "       'ADDRESS not set' for these and pass everything else, which reads"
  log "       as a green run with silently missing coverage."
  exit 1
fi

log "All $COUNT deployed."
