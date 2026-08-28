import json
from pathlib import Path

import pytest

from agent_sdk.reputation.erc8275.recompute import compute_win_rate
from agent_sdk.reputation.erc8275.conventions import WIN_RATE_BPS_V0_HASH

# ── Inline golden vectors (primary) ──────────────────────────────────────
# Convention: basis points (10000 = 1.0, 5161 = 0.5161).
# Exact integer division, half-away-from-zero, never a language float round().

INLINE_VECTORS = [
    {
        "id": "8275-reputation",
        "label": "computeWinRate with 16 wins, 15 losses → 5161 bps (0.5161)",
        "inputs": {"wins": 16, "losses": 15},
        "expected": 5161,
    },
]


def _conformance_vectors():
    """Read repo-local golden vectors for 8275/reputation-bps (testkit/vectors).

    Returns an empty list if the file is not present (the inline vectors in
    INLINE_VECTORS are the primary assertion; the file-based check is a
    secondary cross-check).
    """
    vectors_path = (
        Path(__file__).resolve().parents[4]
        / "testkit"
        / "vectors"
        / "erc8275-reputation-bps-v0.vectors.json"
    )
    if not vectors_path.exists():
        return []
    with open(vectors_path) as f:
        data = json.load(f)
    return [v for v in data["vectors"] if v["step"] == "8275/reputation-bps"]


class TestComputeWinRate:
    """ERC-8275 recompute: winRate = wins * 10000 / (wins + losses) (basis points)."""

    @pytest.mark.parametrize(
        "vec",
        INLINE_VECTORS,
        ids=[v["id"] for v in INLINE_VECTORS],
    )
    def test_inline_golden_vectors(self, vec):
        assert (
            compute_win_rate(vec["inputs"]["wins"], vec["inputs"]["losses"])
            == vec["expected"]
        )

    def test_conformance_vectors_from_file(self):
        file_vectors = _conformance_vectors()
        if not file_vectors:
            pytest.skip(
                "testkit vectors not found — skipping file-based conformance check"
            )

        for vec in file_vectors:
            label = f"{vec['id']}: {vec.get('desc', vec.get('spec', '(no description)'))}"
            wins = vec["inputs"]["commit_gated_wins"]
            losses = vec["inputs"]["commit_gated_losses"]
            assert vec["governing_convention_hash"] == WIN_RATE_BPS_V0_HASH, label
            assert compute_win_rate(wins, losses) == vec["expected"], label

    def test_zero_wins(self):
        assert compute_win_rate(0, 15) == 0

    def test_zero_losses(self):
        assert compute_win_rate(16, 0) == 10000

    def test_integer_division_truncates(self):
        # 1/3 = 3333 basis points
        assert compute_win_rate(1, 2) == 3333

    def test_both_zero_raises(self):
        with pytest.raises(ValueError):
            compute_win_rate(0, 0)
