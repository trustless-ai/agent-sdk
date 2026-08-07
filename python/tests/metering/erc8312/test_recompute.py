import json
from pathlib import Path

import pytest

from agent_sdk.metering.erc8312.recompute import (
    check_cursor_headroom,
    check_stateful_bound,
    compute_remaining_headroom,
    verify_remaining,
)

# ── Inline golden vectors (primary) ──────────────────────────────────────
# These reproduce the vectors from recompute-kit/conformance/agent-flow.vectors.json
# for step "8312/cap-conservation". They are duplicated here so tests pass
# even when recompute-kit is not present on disk.

STATE_BOUND_INLINE_VECTORS = [
    {
        "id": "8312-cap-conservation-holds",
        "label": "holds: reserved=100, confirmed=0, cap=150",
        "inputs": {"reserved": 100, "confirmed": 0, "cap": 150},
        "expected": True,
    },
    {
        "id": "8312-cap-conservation-breach",
        "label": "breach: reserved=100, confirmed=60, cap=150",
        "inputs": {"reserved": 100, "confirmed": 60, "cap": 150},
        "expected": False,
    },
]

CURSOR_INLINE_VECTORS = [
    {
        "id": "8312-cap-conservation-headroom",
        "label": "headroom: aggregate=0, cap=8000",
        "inputs": {"aggregate": 0, "cap": 8000},
        "expected": True,
    },
]


def _conformance_vectors(step):
    """Read repo-local testkit golden vectors for the given step.

    Returns an empty list if the file is not present (the inline vectors
    are the primary assertion; the file-based check is a secondary
    cross-check).
    """
    vectors_path = (
        Path(__file__).resolve().parents[4]
        / "testkit"
        / "vectors"
        / "erc8312.vectors.json"
    )
    if not vectors_path.exists():
        return []
    with open(vectors_path) as f:
        data = json.load(f)
    return [v for v in data["vectors"] if v["step"] == step]


class TestCheckStatefulBound:
    """ERC-8312 StatefulBound: (reserved + confirmed) <= cap."""

    @pytest.mark.parametrize(
        "vec",
        STATE_BOUND_INLINE_VECTORS,
        ids=[v["id"] for v in STATE_BOUND_INLINE_VECTORS],
    )
    def test_inline_golden_vectors(self, vec):
        assert (
            check_stateful_bound(
                vec["inputs"]["reserved"],
                vec["inputs"]["confirmed"],
                vec["inputs"]["cap"],
            )
            == vec["expected"]
        )

    def test_conformance_vectors_from_file(self):
        file_vectors = _conformance_vectors("8312/cap-conservation")
        if not file_vectors:
            pytest.skip(
                "testkit vectors not found — skipping file-based conformance check"
            )

        for vec in file_vectors:
            label = f"{vec['id']}: {vec.get('desc', vec.get('spec', '(no description)'))}"
            if "reserved" in vec["inputs"] and "confirmed" in vec["inputs"]:
                assert (
                    check_stateful_bound(
                        vec["inputs"]["reserved"],
                        vec["inputs"]["confirmed"],
                        vec["inputs"]["cap"],
                    )
                    == vec["expected"]
                ), label

    def test_exact_cap(self):
        """Exact match at cap boundary."""
        assert check_stateful_bound(100, 50, 150) is True

    def test_exceeds_cap(self):
        """Exceeds cap by one."""
        assert check_stateful_bound(100, 51, 150) is False

    def test_zero_values(self):
        """Zero values within cap."""
        assert check_stateful_bound(0, 0, 0) is True


class TestCheckCursorHeadroom:
    """ERC-8312 Orbmis/headroom: aggregate <= cap."""

    @pytest.mark.parametrize(
        "vec",
        CURSOR_INLINE_VECTORS,
        ids=[v["id"] for v in CURSOR_INLINE_VECTORS],
    )
    def test_inline_golden_vectors(self, vec):
        assert (
            check_cursor_headroom(vec["inputs"]["aggregate"], vec["inputs"]["cap"])
            == vec["expected"]
        )

    def test_conformance_vectors_from_file(self):
        file_vectors = _conformance_vectors("8312/cap-conservation")
        if not file_vectors:
            pytest.skip(
                "testkit vectors not found — skipping file-based conformance check"
            )

        for vec in file_vectors:
            label = f"{vec['id']}: {vec.get('desc', vec.get('spec', '(no description)'))}"
            if "aggregate" in vec["inputs"]:
                assert (
                    check_cursor_headroom(
                        vec["inputs"]["aggregate"],
                        vec["inputs"]["cap"],
                    )
                    == vec["expected"]
                ), label

    def test_equals_cap(self):
        """Aggregate equals cap."""
        assert check_cursor_headroom(8000, 8000) is True

    def test_exceeds_cap(self):
        """Aggregate exceeds cap."""
        assert check_cursor_headroom(8001, 8000) is False

    def test_zero_aggregate(self):
        """Zero aggregate within zero cap."""
        assert check_cursor_headroom(0, 0) is True


class TestComputeRemainingHeadroom:
    """ERC-8312 §IBudgetSubstrate: remaining = cap - spent."""

    def test_normal_headroom(self):
        assert compute_remaining_headroom(150, 60) == 90

    def test_exhausted_returns_zero(self):
        assert compute_remaining_headroom(150, 200) == 0

    def test_full_headroom(self):
        assert compute_remaining_headroom(150, 0) == 150

    def test_verify_reported_matches(self):
        assert verify_remaining(150, 60, 90) is True

    def test_verify_misreport_rejected(self):
        assert verify_remaining(150, 60, 100) is False
