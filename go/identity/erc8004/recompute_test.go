package erc8004

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/ethereum/go-ethereum/common"
)

// Golden vector: registryId 860 → 0x0000...035c
func TestGoldenRegistryID860(t *testing.T) {
	want := common.HexToHash("0x000000000000000000000000000000000000000000000000000000000000035c")
	got := ComputeAgentId(860)
	if got != want {
		t.Errorf("ComputeAgentId(860) = %s, want %s", got.Hex(), want.Hex())
	}
}

func TestZeroRegistryID(t *testing.T) {
	got := ComputeAgentId(0)
	if got != (common.Hash{}) {
		t.Errorf("ComputeAgentId(0) = %s, want all-zero hash", got.Hex())
	}
}

// 54848 = 0xD640 — still fits in the trailing two bytes, so the leading
// 24 bytes must stay zero (correct left padding).
func TestRegistryID54848(t *testing.T) {
	want := common.HexToHash("0x000000000000000000000000000000000000000000000000000000000000d640")
	got := ComputeAgentId(54848)
	if got != want {
		t.Errorf("ComputeAgentId(54848) = %s, want %s", got.Hex(), want.Hex())
	}
}

// Max u64: 0xffff_ffff_ffff_ffff — still fits in bytes32, left-padded with
// 24 zero bytes; the u64 occupies bytes 24..32.
func TestMaxUint64LeftPadded(t *testing.T) {
	got := ComputeAgentId(^uint64(0))
	for i := 0; i < 24; i++ {
		if got[i] != 0 {
			t.Fatalf("ComputeAgentId(^uint64(0)) byte %d = 0x%02x, want 0x00 (left-padded)", i, got[i])
		}
	}
	if got[24] != 0xff {
		t.Errorf("ComputeAgentId(^uint64(0)) byte 24 = 0x%02x, want 0xff", got[24])
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

// loadVectors reads the ERC-8004 golden vectors published at
// testkit/vectors/erc8004-agent-id.vectors.json. The path is relative to
// this package's directory (go test runs with the package dir as the
// working directory): ../../../testkit/vectors/erc8004-agent-id.vectors.json.
func loadVectors(t *testing.T) []vector {
	t.Helper()
	path := filepath.Join("..", "..", "..", "testkit", "vectors", "erc8004-agent-id.vectors.json")
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
// testkit/vectors/erc8004-agent-id.vectors.json against the Go recompute —
// any future lane adding a vector here must reproduce it too.
func TestVectorsFile(t *testing.T) {
	for _, v := range loadVectors(t) {
		v := v
		t.Run(v.Step, func(t *testing.T) {
			switch v.Step {
			case "8004/agent-id":
				var in struct {
					RegistryID uint64 `json:"registryId"`
				}
				if err := json.Unmarshal(v.Inputs, &in); err != nil {
					t.Fatalf("unmarshal inputs: %v", err)
				}
				var wantHex string
				if err := json.Unmarshal(v.Expected, &wantHex); err != nil {
					t.Fatalf("unmarshal expected: %v", err)
				}
				got := ComputeAgentId(in.RegistryID)
				want := common.HexToHash(wantHex)
				if got != want {
					t.Errorf("ComputeAgentId(%d) = %s, want %s", in.RegistryID, got.Hex(), want.Hex())
				}
			default:
				t.Fatalf("unknown vector step %q", v.Step)
			}
		})
	}
}
