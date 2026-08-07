package erc8312

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// Golden vector from recompute-kit "8312/cap-conservation": reserved=100,
// confirmed=0, cap=150 → holds.
func TestCheckStatefulBoundGolden(t *testing.T) {
	if !CheckStatefulBound(100, 0, 150) {
		t.Error("CheckStatefulBound(100, 0, 150) = false, want true")
	}
}

// Golden vector: breach — reserved=100, confirmed=60, cap=150 → rejects.
func TestCheckStatefulBoundBreach(t *testing.T) {
	if CheckStatefulBound(100, 60, 150) {
		t.Error("CheckStatefulBound(100, 60, 150) = true, want false")
	}
}

// Exact cap boundary: reserved + confirmed == cap holds.
func TestCheckStatefulBoundExactCap(t *testing.T) {
	if !CheckStatefulBound(100, 50, 150) {
		t.Error("CheckStatefulBound(100, 50, 150) = false, want true (exact cap)")
	}
	if !CheckStatefulBound(0, 0, 0) {
		t.Error("CheckStatefulBound(0, 0, 0) = false, want true")
	}
}

// Overflow safety: naive reserved+confirmed would wrap around; the guarded
// form must reject an overflowing sum against any cap <= MaxUint64.
func TestCheckStatefulBoundOverflow(t *testing.T) {
	if CheckStatefulBound(^uint64(0), 1, ^uint64(0)) {
		t.Error("CheckStatefulBound(MaxUint64, 1, MaxUint64) = true — overflowing sum must not satisfy the cap")
	}
	if !CheckStatefulBound(^uint64(0), 0, ^uint64(0)) {
		t.Error("CheckStatefulBound(MaxUint64, 0, MaxUint64) = false, want true")
	}
}

// Golden vector from recompute-kit "8312/cap-conservation": aggregate=0,
// cap=8000 → holds.
func TestCheckCursorHeadroomGolden(t *testing.T) {
	if !CheckCursorHeadroom(0, 8000) {
		t.Error("CheckCursorHeadroom(0, 8000) = false, want true")
	}
}

// Golden vector: breach — aggregate=8001, cap=8000 → rejects.
func TestCheckCursorHeadroomBreach(t *testing.T) {
	if CheckCursorHeadroom(8001, 8000) {
		t.Error("CheckCursorHeadroom(8001, 8000) = true, want false")
	}
}

func TestCheckCursorHeadroomZeroCap(t *testing.T) {
	if !CheckCursorHeadroom(0, 0) {
		t.Error("CheckCursorHeadroom(0, 0) = false, want true")
	}
}

// Spec-aligned: remaining = cap - spent (IBudgetSubstrate).
func TestComputeRemainingHeadroom(t *testing.T) {
	if got := ComputeRemainingHeadroom(150, 60); got != 90 {
		t.Errorf("ComputeRemainingHeadroom(150, 60) = %d, want 90", got)
	}
	// Exhausted: spent > cap saturates to 0.
	if got := ComputeRemainingHeadroom(150, 200); got != 0 {
		t.Errorf("ComputeRemainingHeadroom(150, 200) = %d, want 0 (saturated)", got)
	}
	if got := ComputeRemainingHeadroom(150, 0); got != 150 {
		t.Errorf("ComputeRemainingHeadroom(150, 0) = %d, want 150", got)
	}
}

// Golden vector "8312/budget-substrate — budget-headroom": cap=150, spent=60,
// reported=90 → holds.
func TestVerifyRemainingHolds(t *testing.T) {
	if !VerifyRemaining(150, 60, 90) {
		t.Error("VerifyRemaining(150, 60, 90) = false, want true")
	}
}

// Golden vector "8312/budget-substrate — budget-substrate-misreport":
// reports 100 but cap - spent = 90 → rejects.
func TestVerifyRemainingMisreport(t *testing.T) {
	if VerifyRemaining(150, 60, 100) {
		t.Error("VerifyRemaining(150, 60, 100) = true, want false")
	}
}

// CRITICAL guard: spent > cap must be rejected even when reported = 0 —
// the saturating subtraction makes cap - spent == 0 when spent > cap, so
// without the spent <= cap guard this would wrongly pass.
func TestVerifyRemainingRejectsSpentOverCap(t *testing.T) {
	if VerifyRemaining(150, 200, 0) {
		t.Error("VerifyRemaining(150, 200, 0) = true, want false (spent > cap must be rejected)")
	}
	// A saturated misreport with a non-zero value must also be rejected.
	if VerifyRemaining(150, 200, 50) {
		t.Error("VerifyRemaining(150, 200, 50) = true, want false (spent > cap)")
	}
}

// Boundary sanity: spent == cap is exactly exhausted (remaining 0), and an
// untouched budget reports the full cap.
func TestVerifyRemainingBoundaries(t *testing.T) {
	if !VerifyRemaining(150, 150, 0) {
		t.Error("VerifyRemaining(150, 150, 0) = false, want true (spent == cap, remaining 0)")
	}
	if !VerifyRemaining(150, 0, 150) {
		t.Error("VerifyRemaining(150, 0, 150) = false, want true (untouched budget)")
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

// loadVectors reads the ERC-8312 golden vectors published at
// testkit/vectors/erc8312.vectors.json. The path is relative to this
// package's directory (go test runs with the package dir as the working
// directory): ../../../testkit/vectors/erc8312.vectors.json.
func loadVectors(t *testing.T) []vector {
	t.Helper()
	path := filepath.Join("..", "..", "..", "testkit", "vectors", "erc8312.vectors.json")
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
// testkit/vectors/erc8312.vectors.json against the Go recompute — any future
// lane adding a vector here must reproduce it too. The cap-conservation
// step appears in two input shapes: {reserved, confirmed, cap} exercises
// CheckStatefulBound, {aggregate, cap} exercises CheckCursorHeadroom.
func TestVectorsFile(t *testing.T) {
	for _, v := range loadVectors(t) {
		v := v
		t.Run(v.Step, func(t *testing.T) {
			switch v.Step {
			case "8312/cap-conservation":
				var in struct {
					Reserved  *uint64 `json:"reserved"`
					Confirmed *uint64 `json:"confirmed"`
					Aggregate *uint64 `json:"aggregate"`
					Cap       *uint64 `json:"cap"`
				}
				if err := json.Unmarshal(v.Inputs, &in); err != nil {
					t.Fatalf("unmarshal inputs: %v", err)
				}
				var want bool
				if err := json.Unmarshal(v.Expected, &want); err != nil {
					t.Fatalf("unmarshal expected: %v", err)
				}
				var got bool
				switch {
				case in.Reserved != nil:
					if in.Confirmed == nil || in.Cap == nil {
						t.Fatal("cap-conservation vector missing reserved/confirmed/cap")
					}
					got = CheckStatefulBound(*in.Reserved, *in.Confirmed, *in.Cap)
				case in.Aggregate != nil:
					if in.Cap == nil {
						t.Fatal("cap-conservation vector missing aggregate/cap")
					}
					got = CheckCursorHeadroom(*in.Aggregate, *in.Cap)
				default:
					t.Fatal("cap-conservation vector has neither reserved nor aggregate inputs")
				}
				if got != want {
					t.Errorf("cap-conservation vector %q = %v, want %v", v.Step, got, want)
				}
			case "8312/budget-substrate":
				var in struct {
					Cap       uint64 `json:"cap"`
					Spent     uint64 `json:"spent"`
					Remaining uint64 `json:"remaining"`
				}
				if err := json.Unmarshal(v.Inputs, &in); err != nil {
					t.Fatalf("unmarshal inputs: %v", err)
				}
				var want bool
				if err := json.Unmarshal(v.Expected, &want); err != nil {
					t.Fatalf("unmarshal expected: %v", err)
				}
				got := VerifyRemaining(in.Cap, in.Spent, in.Remaining)
				if got != want {
					t.Errorf("VerifyRemaining(%d, %d, %d) = %v, want %v", in.Cap, in.Spent, in.Remaining, got, want)
				}
			default:
				t.Fatalf("unknown vector step %q", v.Step)
			}
		})
	}
}
