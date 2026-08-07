package erc8299

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/common"
)

// Golden vector: keccak256("hello") — recompute-kit "wyriwe/raw", also
// cross-verified against the TS, Python and Rust SDKs.
func TestRawInputHashGolden(t *testing.T) {
	got := ComputeRawInputHash([]byte("hello"))
	want := common.HexToHash("0x1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8")
	if got != want {
		t.Errorf("ComputeRawInputHash(\"hello\") = %s, want %s", got.Hex(), want.Hex())
	}
}

// keccak256("") is a fixed, non-zero hash — an empty raw input still hashes
// to something deterministic.
func TestRawInputHashEmpty(t *testing.T) {
	got := ComputeRawInputHash(nil)
	if got == (common.Hash{}) {
		t.Error("ComputeRawInputHash(nil) = zero hash, want non-zero")
	}
	want := common.HexToHash("0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470")
	if got != want {
		t.Errorf("ComputeRawInputHash(nil) = %s, want %s (keccak256 of empty)", got.Hex(), want.Hex())
	}
}

// Golden vector: keccak256(utf8("ipfs://QmTest") || raw_input_hash) with the
// rawInputHash from TestRawInputHashGolden. Cross-lane verified.
func TestSanitizationPipelineHashGolden(t *testing.T) {
	rawHash := common.HexToHash("0x1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8")
	got := ComputeSanitizationPipelineHash("ipfs://QmTest", rawHash)
	want := common.HexToHash("0xb9b571ee6d24c3fcd09fcca0811099b00920d274d0a4b2612531201b8a6f35c1")
	if got != want {
		t.Errorf("ComputeSanitizationPipelineHash(\"ipfs://QmTest\", %s) = %s, want %s",
			rawHash.Hex(), got.Hex(), want.Hex())
	}
}

// A different CID must produce a different pipeline hash — the pipeline
// binds the input to the specific sanitization spec.
func TestSanitizationPipelineHashDifferentCid(t *testing.T) {
	rawHash := common.HexToHash("0x1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8")
	a := ComputeSanitizationPipelineHash("ipfs://QmTest", rawHash)
	b := ComputeSanitizationPipelineHash("ipfs://QmOther", rawHash)
	if a == b {
		t.Error("ComputeSanitizationPipelineHash(\"ipfs://QmTest\") == ComputeSanitizationPipelineHash(\"ipfs://QmOther\"), want different hashes")
	}
}

// Golden vector: sha256 of the UTF-8 artifact bytes (L4 — sha256, NOT
// keccak256). Cross-lane vector "8299-l4/raw-proposal-hash".
func TestRawProposalHashGolden(t *testing.T) {
	got := ComputeRawProposalHash("test artifact content for cross-language verification")
	want := "0xb8f70a237da212a272ecd09370acedbce6ca1d7df90745beafcac77e39697a88"
	if got != want {
		t.Errorf("ComputeRawProposalHash(...) = %s, want %s", got, want)
	}
}

// sha256("") is a fixed, non-zero hash — an empty artifact is a legal
// input, not an error. Cross-lane vector "8299-l4/raw-proposal-hash".
func TestRawProposalHashEmpty(t *testing.T) {
	got := ComputeRawProposalHash("")
	want := "0xe3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
	if got != want {
		t.Errorf("ComputeRawProposalHash(\"\") = %s, want %s", got, want)
	}
}

// LIVE vector: recomputes the real decision_ref of invinoveritas /ledger
// entry #236 (api.babyblueviper.com/ledger/236) from its own published
// decision_ref_preimage_fields. The two null-valued preimage fields are
// omitted from the map — the recompute must serialize them as JSON null,
// never "".
func TestVerdictHashRealLedger(t *testing.T) {
	fields := map[string]string{
		"artifact_hash":      "bdb4d93c421d54883a0c31821d37d197a91a972062be28babed3599dcf2fbdb3",
		"artifact_type":      "onchain_action",
		"policy_version":     "invinoveritas.review.v7",
		"verdict":            "reject",
		"source_class":       "agent_reported",
		"vantage_limitation": "source_class=agent_reported: nothing external confirms this /review call happened, or could not be bypassed, before the action it governs. Recomputability makes this record internally consistent (an occurrence claim) — it is not an absence/completeness claim, which needs a vantage the acting agent doesn't control. Sufficient as standalone evidence for a reversible action; for an irreversible or privileged action, treat this proof as advisory input, not standalone authorization, until paired with an independent mediation-point integration.",
	}
	got := ComputeVerdictHash(fields, []string{
		"artifact_hash", "artifact_type", "policy_version", "verdict",
		"source_class", "vantage_limitation", "related_decision_ref", "intended_audience",
	})
	want := "sha256:5bca0bf044c8e1c8e16a01bf3ee44b12c305ce6a50dd9789ff73cbd13482b9b9"
	if got != want {
		t.Errorf("ComputeVerdictHash(real ledger) = %s, want %s", got, want)
	}
}

// Null-valued preimage fields must be present as JSON null, never omitted
// and never "" — vantage_limitation is absent from the map and must hash
// as null. Cross-lane vector "8299-l4/verdict-hash".
func TestVerdictHashNullFields(t *testing.T) {
	fields := map[string]string{
		"artifact_hash":  "b8f70a237da212a272ecd09370acedbce6ca1d7df90745beafcac77e39697a88",
		"artifact_type":  "plan",
		"policy_version": "invinoveritas.review.v4",
		"verdict":        "approve",
		"source_class":   "agent_reported",
	}
	got := ComputeVerdictHash(fields, []string{
		"artifact_hash", "artifact_type", "policy_version", "verdict",
		"source_class", "vantage_limitation",
	})
	want := "sha256:2970854c035d5aedb673b8523128665712895f62dd525c91fc8e858ad588ce58"
	if got != want {
		t.Errorf("ComputeVerdictHash(null fields) = %s, want %s", got, want)
	}
}

// KEY-SORT CONFORMANCE: a preimage key above U+FFFF sorts differently
// under UTF-16 code units (JS Array.sort) than under code points (Python
// sorted). JCS/RFC-8785 requires CODE POINT order; Go's sort.Strings
// compares UTF-8 byte order, which is identical to code-point order.
// Passing this vector is what "byte-compatible" means beyond ASCII.
func TestVerdictHashKeySortCodePoint(t *testing.T) {
	fields := map[string]string{
		"a": "ascii",
		"Ｚ": "fullwidth-Z",
		"😀": "emoji",
	}
	got := ComputeVerdictHash(fields, []string{"a", "Ｚ", "😀"})
	want := "sha256:36e2e43ff6d7062ebb64c209604b7ce028b4eb88d4db2892e872194d16f36bca"
	if got != want {
		t.Errorf("ComputeVerdictHash(key sort) = %s, want %s", got, want)
	}
}

// l4VectorFile is the top-level shape of
// testkit/vectors/erc8299-l4.vectors.json.
type l4VectorFile struct {
	Vectors []l4Vector `json:"vectors"`
}

// l4Vector is one cross-lane vector: a step identifier, the recompute
// inputs, and the expected hash. A *string fields value of nil means the
// field is JSON null in the vector (the recompute emits it as null).
type l4Vector struct {
	Step     string   `json:"step"`
	Inputs   l4Inputs `json:"inputs"`
	Expected string   `json:"expected"`
}

type l4Inputs struct {
	Artifact       *string            `json:"artifact"`
	Fields         map[string]*string `json:"fields"`
	PreimageFields []string           `json:"preimage_fields"`
}

// loadL4Vectors loads the cross-lane ERC-8299 L4 vectors published at
// testkit/vectors/erc8299-l4.vectors.json. The path is relative to this
// package's directory (go test runs with the package dir as the working
// directory): ../../../testkit/vectors/erc8299-l4.vectors.json.
func loadL4Vectors(t *testing.T) []l4Vector {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "testkit", "vectors", "erc8299-l4.vectors.json"))
	if err != nil {
		t.Fatalf("read ../../../testkit/vectors/erc8299-l4.vectors.json: %v", err)
	}
	var file l4VectorFile
	if err := json.Unmarshal(raw, &file); err != nil {
		t.Fatalf("parse erc8299-l4.vectors.json: %v", err)
	}
	return file.Vectors
}

// TestL4VectorsFile runs every cross-lane vector from
// testkit/vectors/erc8299-l4.vectors.json against the Go recompute — any
// future lane adding a vector here must reproduce it too. Null-valued
// fields in the JSON are dropped from the map: the recompute's contract
// is "missing key serializes as JSON null".
func TestL4VectorsFile(t *testing.T) {
	for _, v := range loadL4Vectors(t) {
		v := v
		t.Run(v.Step, func(t *testing.T) {
			switch {
			case strings.HasSuffix(v.Step, "/raw-proposal-hash"):
				if v.Inputs.Artifact == nil {
					t.Fatal("vector is missing the artifact input")
				}
				got := ComputeRawProposalHash(*v.Inputs.Artifact)
				if got != v.Expected {
					t.Errorf("ComputeRawProposalHash(%q) = %s, want %s", *v.Inputs.Artifact, got, v.Expected)
				}
			case strings.HasSuffix(v.Step, "/verdict-hash"):
				fields := make(map[string]string, len(v.Inputs.Fields))
				for k, p := range v.Inputs.Fields {
					if p != nil {
						fields[k] = *p
					}
					// nil (JSON null) fields stay absent — the recompute
					// serializes them as null.
				}
				got := ComputeVerdictHash(fields, v.Inputs.PreimageFields)
				if got != v.Expected {
					t.Errorf("ComputeVerdictHash(%v, %v) = %s, want %s", fields, v.Inputs.PreimageFields, got, v.Expected)
				}
			default:
				t.Fatalf("unknown vector step %q", v.Step)
			}
		})
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

// loadVectors reads the ERC-8299 wyriwe golden vectors published at
// testkit/vectors/erc8299-wyriwe.vectors.json. The path is relative to this
// package's directory (go test runs with the package dir as the working
// directory): ../../../testkit/vectors/erc8299-wyriwe.vectors.json.
func loadVectors(t *testing.T) []vector {
	t.Helper()
	path := filepath.Join("..", "..", "..", "testkit", "vectors", "erc8299-wyriwe.vectors.json")
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

// TestVectorsFile runs every cross-lane wyriwe vector from
// testkit/vectors/erc8299-wyriwe.vectors.json against the Go recompute — any
// future lane adding a vector here must reproduce it too. (The L4 vectors
// live in their own file, exercised by TestL4VectorsFile.)
func TestVectorsFile(t *testing.T) {
	for _, v := range loadVectors(t) {
		v := v
		t.Run(v.Step, func(t *testing.T) {
			switch v.Step {
			case "wyriwe/raw":
				var in struct {
					RawInputHex string `json:"raw_input_hex"`
				}
				if err := json.Unmarshal(v.Inputs, &in); err != nil {
					t.Fatalf("unmarshal inputs: %v", err)
				}
				var wantHex string
				if err := json.Unmarshal(v.Expected, &wantHex); err != nil {
					t.Fatalf("unmarshal expected: %v", err)
				}
				got := ComputeRawInputHash(common.FromHex(in.RawInputHex))
				want := common.HexToHash(wantHex)
				if got != want {
					t.Errorf("ComputeRawInputHash(%s) = %s, want %s", in.RawInputHex, got.Hex(), want.Hex())
				}
			case "wyriwe/pipeline":
				var in struct {
					SpecCID      string `json:"spec_cid"`
					RawInputHash string `json:"raw_input_hash"`
				}
				if err := json.Unmarshal(v.Inputs, &in); err != nil {
					t.Fatalf("unmarshal inputs: %v", err)
				}
				var wantHex string
				if err := json.Unmarshal(v.Expected, &wantHex); err != nil {
					t.Fatalf("unmarshal expected: %v", err)
				}
				got := ComputeSanitizationPipelineHash(in.SpecCID, common.HexToHash(in.RawInputHash))
				want := common.HexToHash(wantHex)
				if got != want {
					t.Errorf("ComputeSanitizationPipelineHash(%q, %s) = %s, want %s",
						in.SpecCID, in.RawInputHash, got.Hex(), want.Hex())
				}
			default:
				t.Fatalf("unknown vector step %q", v.Step)
			}
		})
	}
}
