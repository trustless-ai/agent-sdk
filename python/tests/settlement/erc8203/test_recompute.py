import json
from pathlib import Path

import pytest

from agent_sdk.settlement.erc8203.recompute import compute_verdict_hash

# ── Inline golden vectors (primary) ──────────────────────────────────────
# These reproduce the vectors from recompute-kit/conformance/agent-flow.vectors.json
# for step "8203/settlement-proof". They are duplicated here so tests pass even when
# recompute-kit is not present on disk.

INLINE_VECTORS = [
    {
        "id": "settlement-proof-consult",
        "label": "Mainnet settlement (job 0xbc01b40, escrow 0x7057fbA7)",
        "inputs": {
            "jobId": "0xbc01b40fe7a3509f35470053d4bc1844d50c9782546cf0fc11154adcb90caa56",
            "resultText": "No intermediaries required, cryptographic verification only.",
        },
        "expected": "0xdc568bd1cbacdd1ead8231e9d3d6f4e475f5168f3cc9f72b31935d46cfdd48f7",
    },
]


def _conformance_vectors():
    """Read repo-local golden vectors for 8203/settlement-proof (testkit/vectors).

    Returns an empty list if the file is not present (the inline vectors in
    INLINE_VECTORS are the primary assertion; the file-based check is a
    secondary cross-check).
    """
    vectors_path = (
        Path(__file__).resolve().parents[4]
        / "testkit"
        / "vectors"
        / "erc8203-settlement-proof.vectors.json"
    )
    if not vectors_path.exists():
        return []
    with open(vectors_path) as f:
        data = json.load(f)
    return [v for v in data["vectors"] if v["step"] == "8203/settlement-proof"]


class TestComputeVerdictHash:
    """ERC-8203 recompute: verdictHash = keccak256(abi.encode(jobId, keccak256(utf8(resultText))))."""

    @pytest.mark.parametrize(
        "vec",
        INLINE_VECTORS,
        ids=[v["id"] for v in INLINE_VECTORS],
    )
    def test_inline_golden_vectors(self, vec):
        assert compute_verdict_hash(vec["inputs"]["jobId"], vec["inputs"]["resultText"]) == vec["expected"]

    def test_conformance_vectors_from_file(self):
        file_vectors = _conformance_vectors()
        if not file_vectors:
            pytest.skip("testkit vectors not found — skipping file-based conformance check")

        for vec in file_vectors:
            job_id = vec["inputs"]["jobId"]
            result_text = vec["inputs"]["resultText"]
            label = f"{vec['id']}: {vec.get('desc', vec.get('spec', '(no description)'))}"
            assert compute_verdict_hash(job_id, result_text) == vec["expected"], label

    def test_empty_result_text(self):
        """Empty result text produces a deterministic hash (not zero)."""
        job_id = "0x" + "00" * 32
        result = compute_verdict_hash(job_id, "")
        assert result.startswith("0x")
        assert len(result) == 66

    def test_unicode_result_text(self):
        """Result text with special/unicode characters works correctly."""
        job_id = "0x" + "00" * 32
        result = compute_verdict_hash(job_id, "Hello 世界 !@#$%")
        assert result.startswith("0x")
        assert len(result) == 66

    def test_deterministic_output(self):
        """Same inputs always produce the same output."""
        job_id = "0xbc01b40fe7a3509f35470053d4bc1844d50c9782546cf0fc11154adcb90caa56"
        result_text = "No intermediaries required, cryptographic verification only."
        assert compute_verdict_hash(job_id, result_text) == compute_verdict_hash(job_id, result_text)

    def test_different_job_id_different_hash(self):
        """Different jobIds produce different verdict hashes."""
        text = "same text"
        hash1 = compute_verdict_hash("0x" + "00" * 31 + "01", text)
        hash2 = compute_verdict_hash("0x" + "00" * 31 + "02", text)
        assert hash1 != hash2

    def test_different_text_different_hash(self):
        """Different result texts produce different verdict hashes."""
        job_id = "0x" + "00" * 31 + "01"
        assert compute_verdict_hash(job_id, "text A") != compute_verdict_hash(job_id, "text B")
