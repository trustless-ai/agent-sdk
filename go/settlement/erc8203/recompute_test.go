package erc8203

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/ethereum/go-ethereum/common"
)

// Golden vector: recompute-kit "8203/settlement-proof", cross-verified
// against the TypeScript, Python and Rust SDKs.
func TestGoldenVerdictHash(t *testing.T) {
	jobID := common.HexToHash("0xbc01b40fe7a3509f35470053d4bc1844d50c9782546cf0fc11154adcb90caa56")
	text := "No intermediaries required, cryptographic verification only."
	got, err := ComputeVerdictHash(jobID, text)
	if err != nil {
		t.Fatalf("ComputeVerdictHash(%s, %q) returned error: %v", jobID.Hex(), text, err)
	}
	want := common.HexToHash("0xdc568bd1cbacdd1ead8231e9d3d6f4e475f5168f3cc9f72b31935d46cfdd48f7")
	if got != want {
		t.Errorf("ComputeVerdictHash(%s, %q) = %s, want %s", jobID.Hex(), text, got.Hex(), want.Hex())
	}
}

// The commitment is bound to the job — the same result text under a
// different jobId must produce a different verdict hash (the contract
// recomputes the commitment from jobId on-chain precisely so a signature
// cannot be replayed against another job).
func TestDifferentJobIDsDifferentHashes(t *testing.T) {
	text := "same result text"
	a, err := ComputeVerdictHash(common.Hash{}, text)
	if err != nil {
		t.Fatalf("ComputeVerdictHash(zero, %q): %v", text, err)
	}
	b, err := ComputeVerdictHash(common.HexToHash("0x0000000000000000000000000000000000000000000000000000000000000001"), text)
	if err != nil {
		t.Fatalf("ComputeVerdictHash(one, %q): %v", text, err)
	}
	if a == b {
		t.Error("ComputeVerdictHash for different jobIds is equal, want different hashes")
	}
}

// Different result texts under the same jobId must produce different
// verdict hashes.
func TestDifferentTextsDifferentHashes(t *testing.T) {
	jobID := common.Hash{}
	a, err := ComputeVerdictHash(jobID, "option A")
	if err != nil {
		t.Fatalf("ComputeVerdictHash(zero, %q): %v", "option A", err)
	}
	b, err := ComputeVerdictHash(jobID, "option B")
	if err != nil {
		t.Fatalf("ComputeVerdictHash(zero, %q): %v", "option B", err)
	}
	if a == b {
		t.Error("ComputeVerdictHash for different result texts is equal, want different hashes")
	}
}

// Empty result text still commits to a deterministic, non-zero verdict hash
// (resultHash = keccak256("") is itself non-zero, so the commitment can
// never be the all-zero hash).
func TestEmptyResultTextNonZeroHash(t *testing.T) {
	got, err := ComputeVerdictHash(common.Hash{}, "")
	if err != nil {
		t.Fatalf("ComputeVerdictHash(zero, \"\") returned error: %v", err)
	}
	if got == (common.Hash{}) {
		t.Error("ComputeVerdictHash(zero, \"\") = zero hash, want non-zero")
	}
	want := common.HexToHash("0x88d4843af302c2093286898cd34cba7a471c3cdce4c78514fc971c3c6a53891e")
	if got != want {
		t.Errorf("ComputeVerdictHash(zero, \"\") = %s, want %s (keccak256 of abi.encode(0, keccak256(\"\")))",
			got.Hex(), want.Hex())
	}
}

// vectorFile is the top-level shape of testkit/vectors/*.vectors.json.
type vectorFile struct {
	Vectors []vector `json:"vectors"`
}

// vector is one golden vector: a step identifier, the recompute inputs, and
// the expected output. Inputs and expected are kept as raw JSON because
// their shape depends on the step.
type vector struct {
	Step     string          `json:"step"`
	Inputs   json.RawMessage `json:"inputs"`
	Expected json.RawMessage `json:"expected"`
}

// loadVectors reads the ERC-8203 golden vectors published at
// testkit/vectors/erc8203-settlement-proof.vectors.json. The path is
// relative to this package's directory (go test runs with the package dir
// as the working directory):
// ../../../testkit/vectors/erc8203-settlement-proof.vectors.json.
func loadVectors(t *testing.T) []vector {
	t.Helper()
	path := filepath.Join("..", "..", "..", "testkit", "vectors", "erc8203-settlement-proof.vectors.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Skipf("vectors not found — skipping: %v", err)
		return nil
	}
	var file vectorFile
	if err := json.Unmarshal(raw, &file); err != nil {
		t.Fatalf("parse %s: %v", path, err)
	}
	return file.Vectors
}

// TestVectorsFile runs every cross-lane vector from
// testkit/vectors/erc8203-settlement-proof.vectors.json against the Go
// recompute — any future lane adding a vector here must reproduce it too.
func TestVectorsFile(t *testing.T) {
	for _, v := range loadVectors(t) {
		v := v
		t.Run(v.Step, func(t *testing.T) {
			switch v.Step {
			case "8203/settlement-proof":
				var in struct {
					JobID      string `json:"jobId"`
					ResultText string `json:"resultText"`
				}
				if err := json.Unmarshal(v.Inputs, &in); err != nil {
					t.Fatalf("unmarshal inputs: %v", err)
				}
				var wantHex string
				if err := json.Unmarshal(v.Expected, &wantHex); err != nil {
					t.Fatalf("unmarshal expected: %v", err)
				}
				got, err := ComputeVerdictHash(common.HexToHash(in.JobID), in.ResultText)
				if err != nil {
					t.Fatalf("ComputeVerdictHash(%s, %q) returned error: %v", in.JobID, in.ResultText, err)
				}
				want := common.HexToHash(wantHex)
				if got != want {
					t.Errorf("ComputeVerdictHash(%s, %q) = %s, want %s", in.JobID, in.ResultText, got.Hex(), want.Hex())
				}
			default:
				t.Fatalf("unknown vector step %q", v.Step)
			}
		})
	}
}
