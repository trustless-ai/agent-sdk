import json
from pathlib import Path

import pytest

from agent_sdk.identity.erc8004.recompute import compute_agent_id

# ── Inline golden vectors (primary) ──────────────────────────────────────
# These reproduce the vectors from recompute-kit/conformance/agent-flow.vectors.json
# for step "8004/agent-id". They are duplicated here so tests pass even when
# recompute-kit is not present on disk.

INLINE_VECTORS = [
    {
        "id": "8004-agent-id-wizgob",
        "label": "Wizgob = ERC-8004 registry id 860",
        "inputs": {"registryId": 860},
        "expected": "0x000000000000000000000000000000000000000000000000000000000000035c",
    },
    {
        "id": "8004-agent-id-ours",
        "label": "our dinamic.eth registry id 54848",
        "inputs": {"registryId": 54848},
        "expected": "0x000000000000000000000000000000000000000000000000000000000000d640",
    },
]


def _conformance_vectors():
    """Read repo-local golden vectors for 8004/agent-id (testkit/vectors).

    Returns an empty list if the file is not present (the inline vectors in
    INLINE_VECTORS are the primary assertion; the file-based check is a
    secondary cross-check).
    """
    vectors_path = (
        Path(__file__).resolve().parents[4]
        / "testkit"
        / "vectors"
        / "erc8004-agent-id.vectors.json"
    )
    if not vectors_path.exists():
        return []
    with open(vectors_path) as f:
        data = json.load(f)
    return [v for v in data["vectors"] if v["step"] == "8004/agent-id"]


class TestComputeAgentId:
    """ERC-8004 recompute: agentId = bytes32(uint256(registryId))."""

    @pytest.mark.parametrize(
        "vec",
        INLINE_VECTORS,
        ids=[v["id"] for v in INLINE_VECTORS],
    )
    def test_inline_golden_vectors(self, vec):
        assert compute_agent_id(vec["inputs"]["registryId"]) == vec["expected"]

    def test_conformance_vectors_from_file(self):
        file_vectors = _conformance_vectors()
        if not file_vectors:
            pytest.skip("testkit vectors not found — skipping file-based conformance check")

        for vec in file_vectors:
            rid = vec["inputs"]["registryId"]
            label = f"{vec['id']}: {vec.get('desc', vec.get('spec', '(no description)'))}"
            assert compute_agent_id(rid) == vec["expected"], label

    def test_zero(self):
        """Registry id 0 produces all-zero bytes32."""
        assert compute_agent_id(0) == "0x0000000000000000000000000000000000000000000000000000000000000000"

    def test_one(self):
        """Registry id 1 produces left-padded 1."""
        assert compute_agent_id(1) == "0x0000000000000000000000000000000000000000000000000000000000000001"

    def test_large_value(self):
        """Large registry id within bytes32 bounds."""
        rid = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF
        expected = "0x00000000000000000000000000000000ffffffffffffffffffffffffffffffff"
        assert compute_agent_id(rid) == expected
