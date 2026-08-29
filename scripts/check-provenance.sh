#!/usr/bin/env bash
#
# Check the vendored ERC-8354 UltraHonk verifier and its fixture proof against
# the hashes committed beside them.
#
#   ./scripts/check-provenance.sh              # offline, checks this tree
#   ./scripts/check-provenance.sh --upstream   # also refetches the pinned source
#
# Why this exists as a script rather than a paragraph of copy-and-paste: the
# whole point of ConsumeReal.t.sol is that a REAL proof goes through a REAL
# verifier. Regenerate the verifier or swap the fixture and that test still
# passes, just against a different artifact than the one PROVENANCE.md claims.
# Nothing would notice. run-all-tests.sh runs this so something does.
#
# PROVENANCE.md's table is the only place the repo, the commit and the hashes
# are written. Everything below is parsed out of it, so the doc cannot drift
# from what is enforced.
#
# Exit code is the verdict: 0 only if every file checked matches.

set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$ROOT/testkit/contracts/mocks/verify/ERC8354"
PROV="$DIR/PROVENANCE.md"

UPSTREAM=0
[ "${1:-}" = "--upstream" ] && UPSTREAM=1

[ -f "$PROV" ] || { echo "ERROR: $PROV is missing" >&2; exit 1; }

REPO="$(sed -n 's#^ *repo: *https://github.com/\([^ ]*\)#\1#p' "$PROV")"
COMMIT="$(sed -n 's/^ *commit: *\([0-9a-f]\{40\}\).*/\1/p' "$PROV")"

# One row per vendored file: local path, upstream path, sha256. The header and
# the separator row do not start with a backticked cell, so they drop out here.
ROWS="$(awk -F'|' '
  /^\| `/ {
    for (i = 2; i <= 4; i++) gsub(/[ `]/, "", $i)
    if ($4 ~ /^[0-9a-f]{64}$/) print $2, $3, $4
  }' "$PROV")"

# A parse that finds nothing must not read as "everything matched". This is the
# same failure shape the check is here to catch, one level up.
COUNT="$(printf '%s\n' "$ROWS" | grep -c . )"
if [ -z "$REPO" ] || [ -z "$COMMIT" ] || [ "$COUNT" -eq 0 ]; then
  echo "ERROR: could not parse source or hash table out of PROVENANCE.md" >&2
  exit 1
fi

echo "   $REPO@${COMMIT:0:8}, $COUNT files"

BAD=0

while read -r local upstream want; do
  [ -n "$local" ] || continue

  if [ ! -f "$DIR/$local" ]; then
    echo "   MISSING  $local"
    BAD=1
    continue
  fi
  got="$(sha256sum "$DIR/$local" | cut -d' ' -f1)"
  if [ "$got" = "$want" ]; then
    echo "   ok       $local"
  else
    echo "   MISMATCH $local"
    echo "              committed $want"
    echo "              on disk   $got"
    BAD=1
  fi

  [ "$UPSTREAM" -eq 1 ] || continue

  # A fetch that fails is a failure, not a skip. Reporting "could not check" as
  # a pass would make the upstream claim weaker than not checking at all.
  up="$(curl -sfL "https://raw.githubusercontent.com/$REPO/$COMMIT/$upstream" | sha256sum | cut -d' ' -f1)"
  if [ -z "$up" ] || [ "$up" = "$(printf '' | sha256sum | cut -d' ' -f1)" ]; then
    echo "   FETCH    $upstream could not be fetched at $COMMIT"
    BAD=1
  elif [ "$up" = "$want" ]; then
    echo "   ok       $upstream (upstream)"
  else
    echo "   MISMATCH $upstream (upstream)"
    echo "              committed $want"
    echo "              upstream  $up"
    BAD=1
  fi
done <<< "$ROWS"

if [ "$BAD" -ne 0 ]; then
  echo "   provenance FAILED: the vendored files are not what PROVENANCE.md pins" >&2
  exit 1
fi
echo "   provenance ok"
