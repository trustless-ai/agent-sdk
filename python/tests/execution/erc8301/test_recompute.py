import json
from pathlib import Path

import pytest

from agent_sdk.execution.erc8301.recompute import compute_task_hash, compute_reply_hash

# ── Inline golden vectors (primary) ──────────────────────────────────────
# These reproduce the vectors from recompute-kit/conformance/agent-flow.vectors.json
# for step "8301/task-hash". They are duplicated here so tests pass even when
# recompute-kit is not present on disk.

EMPTY_PACKED_INNER = "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"

TASK_HASH_INLINE_VECTORS = [
    {
        "id": "8301-task-hash",
        "label": "Initial task with empty prevReplyHashes and known inputHash",
        "inputs": {
            "stage": 1,
            "taskSeq": 0,
            "inputHash": "0x1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8",
            "timestamp": 1700000000,
            "expiresAt": 1700001000,
            "prevReplyHashesPacked": "0x",
            "workflowRunId": "0x00000000000000000000000000000000000000000000000000000000deadbeef",
        },
        "expected": "0xf1f404c844a4aff1d0d7d17cebb518a2d386197aad09ab86517eaa01448301ec",
    },
]

# No inline golden vector for replyHash — there is no conformance vector
# for it yet. Tests below check determinism and edge cases only.


def _conformance_vectors(step: str) -> list[dict]:
    """Read repo-local testkit golden vectors for a given step.

    Returns an empty list if the file is not present (the inline vectors in
    INLINE_VECTORS are the primary assertion; the file-based check is a
    secondary cross-check).
    """
    vectors_path = (
        Path(__file__).resolve().parents[4]
        / "testkit"
        / "vectors"
        / "erc8301-task-hash.vectors.json"
    )
    if not vectors_path.exists():
        return []
    with open(vectors_path) as f:
        data = json.load(f)
    return [v for v in data["vectors"] if v["step"] == step]


class TestComputeTaskHash:
    """ERC-8301 recompute: taskHash for AgentTask."""

    @pytest.mark.parametrize(
        "vec",
        TASK_HASH_INLINE_VECTORS,
        ids=[v["id"] for v in TASK_HASH_INLINE_VECTORS],
    )
    def test_inline_golden_vectors(self, vec):
        i = vec["inputs"]
        result = compute_task_hash(
            i["stage"], i["taskSeq"], i["inputHash"],
            i["timestamp"], i["expiresAt"],
            i["prevReplyHashesPacked"], i["workflowRunId"],
        )
        assert result == vec["expected"]

    def test_conformance_vectors_from_file(self):
        file_vectors = _conformance_vectors("8301/task-hash")
        if not file_vectors:
            pytest.skip("testkit vectors not found -- skipping file-based conformance check")

        for vec in file_vectors:
            i = vec["inputs"]
            label = f"{vec['id']}: {vec.get('desc', vec.get('spec', '(no description)'))}"
            result = compute_task_hash(
                i["stage"], i["taskSeq"], i["inputHash"],
                i["timestamp"], i["expiresAt"],
                i["prevReplyHashesPacked"], i["workflowRunId"],
            )
            assert result == vec["expected"], label

    def test_empty_prev_reply_hashes_not_bytes32_zero(self):
        """Empty prevReplyHashesPacked produces keccak256("") not bytes32(0).

        A common bug is special-casing empty to zero.
        """
        result = compute_task_hash(
            1, 0,
            "0x1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8",
            1700000000, 1700001000,
            "0x",
            "0x00000000000000000000000000000000000000000000000000000000deadbeef",
        )
        # The golden value proves it uses keccak256("") = 0xc5d2...
        assert result == "0xf1f404c844a4aff1d0d7d17cebb518a2d386197aad09ab86517eaa01448301ec"

    def test_non_empty_prev_reply_hashes(self):
        """Non-empty prevReplyHashesPacked produces a different hash."""
        result = compute_task_hash(
            1, 0,
            "0x1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8",
            1700000000, 1700001000,
            "0xdeadbeef",
            "0x00000000000000000000000000000000000000000000000000000000deadbeef",
        )
        assert result != "0xf1f404c844a4aff1d0d7d17cebb518a2d386197aad09ab86517eaa01448301ec"

    def test_inner_hash_empty_packed(self):
        """Directly verify keccak256("0x") equals the known value."""
        from eth_utils import keccak as k256
        inner = "0x" + k256(b"").hex()
        assert inner == EMPTY_PACKED_INNER


class TestComputeReplyHash:
    """ERC-8301 recompute: replyHash for AgentReply."""

    def test_deterministic(self):
        """Same inputs always produce the same hash."""
        hash1 = compute_reply_hash(
            "0x1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8",
            1700000000,
            "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
            "0x00000000000000000000000000000000000000000000000000000000deadbeef",
            "0x00000000000000000000000000000000000000000000000000000000deadbeef",
        )
        assert len(hash1) == 66
        assert hash1.startswith("0x")
        hash2 = compute_reply_hash(
            "0x1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8",
            1700000000,
            "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
            "0x00000000000000000000000000000000000000000000000000000000deadbeef",
            "0x00000000000000000000000000000000000000000000000000000000deadbeef",
        )
        assert hash1 == hash2

    def test_empty_prev_task_hashes(self):
        """Empty prevTaskHashesPacked produces keccak256("") not bytes32(0)."""
        result = compute_reply_hash(
            "0x1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8",
            1700000000,
            "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
            "0x",
            "0x00000000000000000000000000000000000000000000000000000000deadbeef",
        )
        # Must not be all zeros
        assert result != "0x0000000000000000000000000000000000000000000000000000000000000000"
        assert len(result) == 66

    def test_different_repliers_diff_hashes(self):
        """Different replier addresses produce different reply hashes."""
        hash1 = compute_reply_hash(
            "0x1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8",
            1700000000,
            "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
            "0x",
            "0x00000000000000000000000000000000000000000000000000000000deadbeef",
        )
        hash2 = compute_reply_hash(
            "0x1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8",
            1700000000,
            "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
            "0x",
            "0x00000000000000000000000000000000000000000000000000000000deadbeef",
        )
        assert hash1 != hash2
