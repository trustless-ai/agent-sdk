import json
from pathlib import Path

import pytest

from agent_sdk.verify.erc8299.recompute import compute_raw_input_hash, compute_sanitization_pipeline_hash

# ── Inline golden vectors (primary) ──────────────────────────────────────
# These reproduce the vectors from recompute-kit/conformance/agent-flow.vectors.json
# for steps "wyriwe/raw" and "wyriwe/pipeline". They are duplicated here so
# tests pass even when recompute-kit is not present on disk.

RAW_INLINE_VECTORS = [
    {
        "id": "wyriwe-raw",
        "label": "raw_input_hash = keccak256(raw_user_input) for 'hello'",
        "inputs": {"raw_input_hex": "0x68656c6c6f"},
        "expected": "0x1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8",
    },
]

PIPELINE_INLINE_VECTORS = [
    {
        "id": "wyriwe-pipeline",
        "label": "sanitization_pipeline_hash = keccak256(utf8(cid) || raw_input_hash)",
        "inputs": {
            "spec_cid": "ipfs://QmccvoM6aRVgZ2dtFWvT6Wm3DmTvoAUHHotK7uQufnStVR",
            "raw_input_hash": "0x1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8",
        },
        "expected": "0x5798efed4aa92f96a0622fc30268042b067294bdb5fd06f599bf8d84fd5d734b",
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
        / "erc8299-wyriwe.vectors.json"
    )
    if not vectors_path.exists():
        return []
    with open(vectors_path) as f:
        data = json.load(f)
    return [v for v in data["vectors"] if v["step"] == step]


class TestComputeRawInputHash:
    """ERC-8299 Section 45: raw_input_hash = keccak256(raw_user_input)."""

    @pytest.mark.parametrize(
        "vec",
        RAW_INLINE_VECTORS,
        ids=[v["id"] for v in RAW_INLINE_VECTORS],
    )
    def test_inline_golden_vectors(self, vec):
        assert compute_raw_input_hash(vec["inputs"]["raw_input_hex"]) == vec["expected"]

    def test_conformance_vectors_from_file(self):
        file_vectors = _conformance_vectors("wyriwe/raw")
        if not file_vectors:
            pytest.skip("testkit vectors not found — skipping file-based conformance check")

        for vec in file_vectors:
            label = f"{vec['id']}: {vec.get('desc', vec.get('spec', '(no description)'))}"
            assert compute_raw_input_hash(vec["inputs"]["raw_input_hex"]) == vec["expected"], label

    def test_empty_input(self):
        """Empty hex input has known keccak256 digest."""
        result = compute_raw_input_hash("0x")
        assert result == "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"

    def test_single_byte(self):
        """Single byte input produces a valid hash distinct from empty input."""
        result = compute_raw_input_hash("0x00")
        assert result != compute_raw_input_hash("0x")
        assert result.startswith("0x")
        assert len(result) == 66


class TestComputeSanitizationPipelineHash:
    """ERC-8299 Section 46: sanitization_pipeline_hash = keccak256(utf8(cid) || raw_input_hash)."""

    @pytest.mark.parametrize(
        "vec",
        PIPELINE_INLINE_VECTORS,
        ids=[v["id"] for v in PIPELINE_INLINE_VECTORS],
    )
    def test_inline_golden_vectors(self, vec):
        assert (
            compute_sanitization_pipeline_hash(
                vec["inputs"]["spec_cid"], vec["inputs"]["raw_input_hash"]
            )
            == vec["expected"]
        )

    def test_conformance_vectors_from_file(self):
        file_vectors = _conformance_vectors("wyriwe/pipeline")
        if not file_vectors:
            pytest.skip("testkit vectors not found — skipping file-based conformance check")

        for vec in file_vectors:
            label = f"{vec['id']}: {vec.get('desc', vec.get('spec', '(no description)'))}"
            assert (
                compute_sanitization_pipeline_hash(
                    vec["inputs"]["spec_cid"], vec["inputs"]["raw_input_hash"]
                )
                == vec["expected"]
            ), label

    def test_empty_cid(self):
        """Empty CID produces a valid hash."""
        raw_hash = "0x1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8"
        result = compute_sanitization_pipeline_hash("", raw_hash)
        assert result.startswith("0x")
        assert len(result) == 66

    def test_different_cids_different_hashes(self):
        """Different CIDs produce different pipeline hashes."""
        raw_hash = "0x1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8"
        result1 = compute_sanitization_pipeline_hash("cid:a", raw_hash)
        result2 = compute_sanitization_pipeline_hash("cid:b", raw_hash)
        assert result1 != result2
