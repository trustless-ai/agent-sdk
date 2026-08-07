package erc8275

import (
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"testing"
)

// Golden vector: wins=16, losses=15 → 5161 (0.5161)
func TestGoldenWinRate(t *testing.T) {
	got, err := ComputeWinRate(16, 15)
	if err != nil {
		t.Fatalf("ComputeWinRate(16, 15) returned error: %v", err)
	}
	if got != 5161 {
		t.Errorf("ComputeWinRate(16, 15) = %d, want 5161", got)
	}
}

func TestZeroWins(t *testing.T) {
	got, err := ComputeWinRate(0, 10)
	if err != nil {
		t.Fatalf("ComputeWinRate(0, 10) returned error: %v", err)
	}
	if got != 0 {
		t.Errorf("ComputeWinRate(0, 10) = %d, want 0", got)
	}
}

func TestAllWins(t *testing.T) {
	got, err := ComputeWinRate(10, 0)
	if err != nil {
		t.Fatalf("ComputeWinRate(10, 0) returned error: %v", err)
	}
	if got != 10000 {
		t.Errorf("ComputeWinRate(10, 0) = %d, want 10000", got)
	}
}

func TestBothZeroReturnsError(t *testing.T) {
	if _, err := ComputeWinRate(0, 0); err == nil {
		t.Error("ComputeWinRate(0, 0) returned nil error, want ErrZeroTotal")
	} else if err != ErrZeroTotal {
		t.Errorf("ComputeWinRate(0, 0) error = %v, want ErrZeroTotal", err)
	}
}

// 1/3 = 0.3333... → 3333 basis points
func TestIntegerDivisionTruncates(t *testing.T) {
	got, err := ComputeWinRate(1, 2)
	if err != nil {
		t.Fatalf("ComputeWinRate(1, 2) returned error: %v", err)
	}
	if got != 3333 {
		t.Errorf("ComputeWinRate(1, 2) = %d, want 3333", got)
	}
}

// Rounding-tie vector: wins=1, losses=31 → 1/32 = 0.03125 → 313 (ROUND_HALF_UP)
func TestRoundingTieHalfUp(t *testing.T) {
	got, err := ComputeWinRate(1, 31)
	if err != nil {
		t.Fatalf("ComputeWinRate(1, 31) returned error: %v", err)
	}
	if got != 313 {
		t.Errorf("ComputeWinRate(1, 31) = %d, want 313", got)
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

// loadVectors reads the ERC-8275 golden vectors published at
// testkit/vectors/erc8275-reputation.vectors.json. The path is relative to
// this package's directory (go test runs with the package dir as the
// working directory): ../../../testkit/vectors/erc8275-reputation.vectors.json.
func loadVectors(t *testing.T) []vector {
	t.Helper()
	path := filepath.Join("..", "..", "..", "testkit", "vectors", "erc8275-reputation.vectors.json")
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
// testkit/vectors/erc8275-reputation.vectors.json against the Go recompute —
// any future lane adding a vector here must reproduce it too.
//
// The vector's expected winRate is the decimal fraction (0.5161); the Go
// recompute returns integer basis points, so the expected value is
// converted with uint64(math.Round(f * 10000)) — the same rounding the
// recompute applies to wins/total.
func TestVectorsFile(t *testing.T) {
	for _, v := range loadVectors(t) {
		v := v
		t.Run(v.Step, func(t *testing.T) {
			switch v.Step {
			case "8275/reputation":
				var in struct {
					Wins   uint64 `json:"commit_gated_wins"`
					Losses uint64 `json:"commit_gated_losses"`
				}
				if err := json.Unmarshal(v.Inputs, &in); err != nil {
					t.Fatalf("unmarshal inputs: %v", err)
				}
				var want float64
				if err := json.Unmarshal(v.Expected, &want); err != nil {
					t.Fatalf("unmarshal expected: %v", err)
				}
				got, err := ComputeWinRate(in.Wins, in.Losses)
				if err != nil {
					t.Fatalf("ComputeWinRate(%d, %d) returned error: %v", in.Wins, in.Losses, err)
				}
				wantBps := uint64(math.Round(want * 10000))
				if got != wantBps {
					t.Errorf("ComputeWinRate(%d, %d) = %d, want %d", in.Wins, in.Losses, got, wantBps)
				}
			default:
				t.Fatalf("unknown vector step %q", v.Step)
			}
		})
	}
}
