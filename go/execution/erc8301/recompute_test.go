package erc8301

import (
	"encoding/json"
	"math/big"
	"os"
	"path/filepath"
	"testing"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
)

// keccak256("") — the inner hash for an empty prev-hash list. The value that
// a naive bytes32(0) special case would destroy.
const emptyPackedInnerHash = "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"

// Golden vector from recompute-kit "8301/task-hash" — cross-verified against
// the TypeScript and Rust SDKs.
func TestGoldenTaskHash(t *testing.T) {
	got, err := ComputeTaskHash(
		1, // stage
		0, // taskSeq
		common.HexToHash("0x1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8"),
		1700000000, // timestamp
		1700001000, // expiresAt
		nil,        // empty prevReplyHashes — the critical edge case
		common.HexToHash("0x00000000000000000000000000000000000000000000000000000000deadbeef"),
	)
	if err != nil {
		t.Fatalf("ComputeTaskHash returned error: %v", err)
	}
	want := common.HexToHash("0xf1f404c844a4aff1d0d7d17cebb518a2d386197aad09ab86517eaa01448301ec")
	if got != want {
		t.Errorf("ComputeTaskHash = %s, want %s", got.Hex(), want.Hex())
	}
}

// Golden replyHash — computed and cross-verified with the TypeScript SDK's
// computeReplyHash (no recompute-kit conformance vector exists for replies
// yet): outputHash 0xabcd0000...0000, timestamp 1700000000, replier
// 0x70997970C51812dc3A010C7d01b50e0d17dc79C8, empty prevTaskHashes,
// workflowRunId 0x0000...deadbeef.
func TestGoldenReplyHash(t *testing.T) {
	got, err := ComputeReplyHash(
		common.HexToHash("0xabcd000000000000000000000000000000000000000000000000000000000000"),
		1700000000,
		common.HexToAddress("0x70997970C51812dc3A010C7d01b50e0d17dc79C8"),
		nil, // empty prevTaskHashes — the critical edge case
		common.HexToHash("0x00000000000000000000000000000000000000000000000000000000deadbeef"),
	)
	if err != nil {
		t.Fatalf("ComputeReplyHash returned error: %v", err)
	}
	want := common.HexToHash("0x65aa5c380a15de82c67b2fb95dacfb12cb327939fd3867c3eb1b64729f17766d")
	if got != want {
		t.Errorf("ComputeReplyHash = %s, want %s", got.Hex(), want.Hex())
	}
}

// Empty packed list hashes to keccak256(""), NOT bytes32(0).
func TestEmptyPackedInnerHashIsKeccakOfEmpty(t *testing.T) {
	got := ComputeInnerHash(nil)
	want := common.HexToHash(emptyPackedInnerHash)
	if got != want {
		t.Errorf("ComputeInnerHash(nil) = %s, want %s", got.Hex(), want.Hex())
	}
	if got == (common.Hash{}) {
		t.Error("ComputeInnerHash(nil) = bytes32(0) — the empty case must be keccak256(\"\"), not the zero hash")
	}
}

// The golden task hash proves the empty case end-to-end: if the empty
// prevReplyHashes list were special-cased to bytes32(0), the golden vector
// would not match.
func TestGoldenTaskHashProvesEmptyIsNotBytes32Zero(t *testing.T) {
	got, err := ComputeTaskHash(
		1, 0,
		common.HexToHash("0x1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8"),
		1700000000, 1700001000,
		nil,
		common.HexToHash("0x00000000000000000000000000000000000000000000000000000000deadbeef"),
	)
	if err != nil {
		t.Fatalf("ComputeTaskHash returned error: %v", err)
	}
	// ComputeTaskHash always uses keccak256("") for the empty list — this
	// variant injects the zero inner hash to show it differs from the golden.
	zeroInner, err := computeTaskHashWithInner(
		1, 0,
		common.HexToHash("0x1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8"),
		1700000000, 1700001000,
		common.Hash{},
		common.HexToHash("0x00000000000000000000000000000000000000000000000000000000deadbeef"),
	)
	if err != nil {
		t.Fatalf("computeTaskHashWithInner returned error: %v", err)
	}
	if zeroInner == got {
		t.Errorf("task hash with bytes32(0) inner hash %s equals the golden — empty list must hash keccak256(\"\")", zeroInner.Hex())
	}
}

func TestTaskHashDeterministic(t *testing.T) {
	input := common.HexToHash("0x1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8")
	runID := common.HexToHash("0x00000000000000000000000000000000000000000000000000000000deadbeef")
	a, err := ComputeTaskHash(1, 0, input, 1700000000, 1700001000, nil, runID)
	if err != nil {
		t.Fatalf("ComputeTaskHash returned error: %v", err)
	}
	b, err := ComputeTaskHash(1, 0, input, 1700000000, 1700001000, nil, runID)
	if err != nil {
		t.Fatalf("ComputeTaskHash returned error: %v", err)
	}
	if a != b {
		t.Errorf("same inputs produced different hashes: %s vs %s", a.Hex(), b.Hex())
	}
}

func TestDifferentInputsDifferentTaskHash(t *testing.T) {
	input := common.HexToHash("0x1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8")
	runID := common.HexToHash("0x00000000000000000000000000000000000000000000000000000000deadbeef")
	stage0, err := ComputeTaskHash(0, 0, input, 1700000000, 1700001000, nil, runID)
	if err != nil {
		t.Fatalf("ComputeTaskHash returned error: %v", err)
	}
	stage1, err := ComputeTaskHash(1, 0, input, 1700000000, 1700001000, nil, runID)
	if err != nil {
		t.Fatalf("ComputeTaskHash returned error: %v", err)
	}
	if stage0 == stage1 {
		t.Error("different stages produced the same task hash")
	}
	seq1, err := ComputeTaskHash(0, 1, input, 1700000000, 1700001000, nil, runID)
	if err != nil {
		t.Fatalf("ComputeTaskHash returned error: %v", err)
	}
	if stage0 == seq1 {
		t.Error("different taskSeq values produced the same task hash")
	}
}

// A non-empty prevReplyHashes list changes the hash versus the empty list.
func TestNonEmptyPrevReplyHashesDifferentTaskHash(t *testing.T) {
	empty, err := ComputeTaskHash(
		1, 0,
		common.HexToHash("0x1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8"),
		1700000000, 1700001000, nil,
		common.HexToHash("0x00000000000000000000000000000000000000000000000000000000deadbeef"),
	)
	if err != nil {
		t.Fatalf("ComputeTaskHash returned error: %v", err)
	}
	// One previous reply: the 32-byte packed form of the golden reply hash.
	prev := common.HexToHash("0x65aa5c380a15de82c67b2fb95dacfb12cb327939fd3867c3eb1b64729f17766d")
	withPrev, err := ComputeTaskHash(
		1, 0,
		common.HexToHash("0x1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8"),
		1700000000, 1700001000, prev.Bytes(),
		common.HexToHash("0x00000000000000000000000000000000000000000000000000000000deadbeef"),
	)
	if err != nil {
		t.Fatalf("ComputeTaskHash returned error: %v", err)
	}
	if withPrev == empty {
		t.Error("task hash with a previous reply equals the empty-list hash")
	}
}

func TestReplyHashDeterministic(t *testing.T) {
	output := common.HexToHash("0xabcd000000000000000000000000000000000000000000000000000000000000")
	replier := common.HexToAddress("0x70997970C51812dc3A010C7d01b50e0d17dc79C8")
	runID := common.HexToHash("0x00000000000000000000000000000000000000000000000000000000deadbeef")
	a, err := ComputeReplyHash(output, 1700000000, replier, nil, runID)
	if err != nil {
		t.Fatalf("ComputeReplyHash returned error: %v", err)
	}
	b, err := ComputeReplyHash(output, 1700000000, replier, nil, runID)
	if err != nil {
		t.Fatalf("ComputeReplyHash returned error: %v", err)
	}
	if a != b {
		t.Errorf("same inputs produced different hashes: %s vs %s", a.Hex(), b.Hex())
	}
}

func TestDifferentReplierDifferentReplyHash(t *testing.T) {
	output := common.HexToHash("0xabcd000000000000000000000000000000000000000000000000000000000000")
	runID := common.HexToHash("0x00000000000000000000000000000000000000000000000000000000deadbeef")
	replierA := common.HexToAddress("0x70997970C51812dc3A010C7d01b50e0d17dc79C8")
	replierB := common.HexToAddress("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266")
	a, err := ComputeReplyHash(output, 1700000000, replierA, nil, runID)
	if err != nil {
		t.Fatalf("ComputeReplyHash returned error: %v", err)
	}
	b, err := ComputeReplyHash(output, 1700000000, replierB, nil, runID)
	if err != nil {
		t.Fatalf("ComputeReplyHash returned error: %v", err)
	}
	if a == b {
		t.Error("different repliers produced the same reply hash")
	}
}

func TestReplyHashVsTaskHashDifferent(t *testing.T) {
	task, err := ComputeTaskHash(
		0, 0, common.Hash{}, 0, 0, nil, common.Hash{},
	)
	if err != nil {
		t.Fatalf("ComputeTaskHash returned error: %v", err)
	}
	reply, err := ComputeReplyHash(common.Hash{}, 0, common.Address{}, nil, common.Hash{})
	if err != nil {
		t.Fatalf("ComputeReplyHash returned error: %v", err)
	}
	if task == reply {
		t.Error("task hash and reply hash for zeroed structs are identical")
	}
}

// computeTaskHashWithInner is the task hash with an explicitly injected inner
// hash — used only by the bytes32(0) guard test to prove the empty-list inner
// hash is keccak256(""), not the zero hash.
func computeTaskHashWithInner(stage uint8, taskSeq uint64, inputHash common.Hash, timestamp, expiresAt uint64, innerHash common.Hash, workflowRunId common.Hash) (common.Hash, error) {
	uint8Type, err := abi.NewType("uint8", "", nil)
	if err != nil {
		return common.Hash{}, err
	}
	uint256Type, err := abi.NewType("uint256", "", nil)
	if err != nil {
		return common.Hash{}, err
	}
	bytes32Type, err := abi.NewType("bytes32", "", nil)
	if err != nil {
		return common.Hash{}, err
	}
	args := abi.Arguments{
		{Type: uint8Type},
		{Type: uint256Type},
		{Type: bytes32Type},
		{Type: uint256Type},
		{Type: uint256Type},
		{Type: bytes32Type},
		{Type: bytes32Type},
	}
	packed, err := args.Pack(
		stage, new(big.Int).SetUint64(taskSeq), inputHash,
		new(big.Int).SetUint64(timestamp), new(big.Int).SetUint64(expiresAt),
		innerHash, workflowRunId,
	)
	if err != nil {
		return common.Hash{}, err
	}
	return crypto.Keccak256Hash(packed), nil
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

// loadVectors reads the ERC-8301 golden vectors published at
// testkit/vectors/erc8301-task-hash.vectors.json. The path is relative to
// this package's directory (go test runs with the package dir as the
// working directory): ../../../testkit/vectors/erc8301-task-hash.vectors.json.
func loadVectors(t *testing.T) []vector {
	t.Helper()
	path := filepath.Join("..", "..", "..", "testkit", "vectors", "erc8301-task-hash.vectors.json")
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
// testkit/vectors/erc8301-task-hash.vectors.json against the Go recompute —
// any future lane adding a vector here must reproduce it too. The empty
// prevReplyHashesPacked hex ("0x") decodes to nil, exercising the critical
// empty-array edge case the golden vector pins.
func TestVectorsFile(t *testing.T) {
	for _, v := range loadVectors(t) {
		v := v
		t.Run(v.Step, func(t *testing.T) {
			switch v.Step {
			case "8301/task-hash":
				var in struct {
					Stage                 uint8  `json:"stage"`
					TaskSeq               uint64 `json:"taskSeq"`
					InputHash             string `json:"inputHash"`
					Timestamp             uint64 `json:"timestamp"`
					ExpiresAt             uint64 `json:"expiresAt"`
					PrevReplyHashesPacked string `json:"prevReplyHashesPacked"`
					WorkflowRunID         string `json:"workflowRunId"`
				}
				if err := json.Unmarshal(v.Inputs, &in); err != nil {
					t.Fatalf("unmarshal inputs: %v", err)
				}
				var wantHex string
				if err := json.Unmarshal(v.Expected, &wantHex); err != nil {
					t.Fatalf("unmarshal expected: %v", err)
				}
				got, err := ComputeTaskHash(
					in.Stage, in.TaskSeq,
					common.HexToHash(in.InputHash),
					in.Timestamp, in.ExpiresAt,
					common.FromHex(in.PrevReplyHashesPacked),
					common.HexToHash(in.WorkflowRunID),
				)
				if err != nil {
					t.Fatalf("ComputeTaskHash returned error: %v", err)
				}
				want := common.HexToHash(wantHex)
				if got != want {
					t.Errorf("ComputeTaskHash = %s, want %s", got.Hex(), want.Hex())
				}
			default:
				t.Fatalf("unknown vector step %q", v.Step)
			}
		})
	}
}
