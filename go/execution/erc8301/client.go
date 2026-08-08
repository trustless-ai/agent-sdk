package erc8301

import (
	"context"
	"crypto/ecdsa"
	"errors"
	"fmt"
	"math/big"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/ethclient"
)

// ErrNoSigner is returned by the write methods (Run, OnAgentReply,
// OnAgentProve) when the client was constructed without a private key.
var ErrNoSigner = errors.New("erc8301: write methods require a signer key (NewAgentWorkflowClient with non-nil key)")

// AgentWorkflowClient reads and drives workflow state on a deployed ERC-8301
// IAgentWorkflow contract. GetTask/GetReply/Result are read-only view calls
// (no gas, no key); Run/OnAgentReply/OnAgentProve broadcast transactions and
// therefore need a signer key — pass nil to NewAgentWorkflowClient for a
// read-only client.
type AgentWorkflowClient struct {
	rpc     *ethclient.Client
	address common.Address
	key     *ecdsa.PrivateKey // signs run/onAgentReply/onAgentProve; nil for read-only clients
}

// NewAgentWorkflowClient creates a client bound to a deployed ERC-8301
// IAgentWorkflow contract. key signs the write transactions — pass nil for a
// read-only client (GetTask, GetReply, Result only).
func NewAgentWorkflowClient(rpc *ethclient.Client, addr common.Address, key *ecdsa.PrivateKey) *AgentWorkflowClient {
	return &AgentWorkflowClient{rpc: rpc, address: addr, key: key}
}

// RunInfo is the result of starting a workflow run: the contract-generated
// run identifier and the dispatched initial AgentTask, parsed from the
// NewAgentTask event emitted by run() (ERC-8301 IAgentWorkflow.run).
type RunInfo struct {
	WorkflowRunId common.Hash // Contract-generated unique run identifier.
	TaskHash      common.Hash // taskHash of the dispatched initial task.
	Stage         uint8       // FSM stage of the initial task.
}

// Run starts a new workflow run by broadcasting run(inputHash, input,
// expiresAt), waits for the transaction to be mined, and parses the emitted
// NewAgentTask event.
//
// The returned RunInfo is the recompute-to-verify anchor point: any party can
// independently recompute TaskHash from the task fields (see GetTask and
// ComputeTaskHash) and compare it against the event's hash. Returns
// ErrNoSigner if the client has no private key.
func (c *AgentWorkflowClient) Run(ctx context.Context, inputHash common.Hash, input []byte, expiresAt uint64) (RunInfo, error) {
	if c.key == nil {
		return RunInfo{}, ErrNoSigner
	}
	tx, err := c.transact(ctx, "run", inputHash, input, new(big.Int).SetUint64(expiresAt))
	if err != nil {
		return RunInfo{}, err
	}
	receipt, err := bind.WaitMined(ctx, c.rpc, tx)
	if err != nil {
		return RunInfo{}, fmt.Errorf("erc8301: wait for run to mine: %w", err)
	}
	return parseNewAgentTask(receipt)
}

// RunResult is the terminal state of a workflow run (ERC-8301
// IAgentWorkflow.result).
type RunResult struct {
	Status        RunStatus   // Pending | Success | Failed.
	FinalTaskHash common.Hash // taskHash of the terminal AgentTask; zero if not Success.
	CompletedAt   uint64      // block.timestamp at completion; 0 if not Success.
}

// Result reads the terminal state of a run via the result(bytes32) view.
func (c *AgentWorkflowClient) Result(ctx context.Context, workflowRunId common.Hash) (RunResult, error) {
	out, err := c.callView(ctx, "result", workflowRunId)
	if err != nil {
		return RunResult{}, err
	}
	vals, err := c.outputs("result", out)
	if err != nil {
		return RunResult{}, err
	}
	if len(vals) != 3 {
		return RunResult{}, fmt.Errorf("erc8301: result returned %d outputs, want 3", len(vals))
	}
	status, err := asRunStatus(vals[0])
	if err != nil {
		return RunResult{}, err
	}
	finalTaskHash, err := asHash(vals[1])
	if err != nil {
		return RunResult{}, err
	}
	completedAt, err := asUint64(vals[2])
	if err != nil {
		return RunResult{}, err
	}
	return RunResult{Status: status, FinalTaskHash: finalTaskHash, CompletedAt: completedAt}, nil
}

// GetTask reads the stored AgentTask for taskHash via the getAgentTask view,
// together with its proven status (proven=true iff prevReplyHashes is empty
// or all prevReplyHashes are proven).
//
// The stored struct is the recompute-to-verify input: recompute taskHash from
// its fields with ComputeTaskHash and compare against taskHash. Errors if the
// contract reverts (unknown taskHash).
func (c *AgentWorkflowClient) GetTask(ctx context.Context, taskHash common.Hash) (AgentTask, bool, error) {
	out, err := c.callView(ctx, "getAgentTask", taskHash)
	if err != nil {
		return AgentTask{}, false, err
	}
	vals, err := c.outputs("getAgentTask", out)
	if err != nil {
		return AgentTask{}, false, err
	}
	if len(vals) != 2 {
		return AgentTask{}, false, fmt.Errorf("erc8301: getAgentTask returned %d outputs, want 2", len(vals))
	}
	// Outputs.Copy maps every output onto the struct by field name — the
	// tuple output lands in Task, the bool output in Proven.
	var decoded struct {
		Task   AgentTask
		Proven bool
	}
	if err := c.copyOutputs("getAgentTask", &decoded, vals); err != nil {
		return AgentTask{}, false, err
	}
	return decoded.Task, decoded.Proven, nil
}

// GetReply reads the stored AgentReply for replyHash via the getAgentReply
// view, together with its verification status (verifier, proven,
// verificationDigest).
//
// The stored struct is the recompute-to-verify input: recompute replyHash
// from its fields with ComputeReplyHash and compare against replyHash. Errors
// if the contract reverts (unknown replyHash).
func (c *AgentWorkflowClient) GetReply(ctx context.Context, replyHash common.Hash) (AgentReply, common.Address, bool, common.Hash, error) {
	out, err := c.callView(ctx, "getAgentReply", replyHash)
	if err != nil {
		return AgentReply{}, common.Address{}, false, common.Hash{}, err
	}
	vals, err := c.outputs("getAgentReply", out)
	if err != nil {
		return AgentReply{}, common.Address{}, false, common.Hash{}, err
	}
	if len(vals) != 4 {
		return AgentReply{}, common.Address{}, false, common.Hash{}, fmt.Errorf("erc8301: getAgentReply returned %d outputs, want 4", len(vals))
	}
	// Outputs.Copy maps every output onto the struct by field name — the
	// tuple output lands in Reply, the address/bool/bytes32 outputs in
	// Verifier/Proven/VerificationDigest.
	var decoded struct {
		Reply              AgentReply
		Verifier           common.Address
		Proven             bool
		VerificationDigest common.Hash
	}
	if err := c.copyOutputs("getAgentReply", &decoded, vals); err != nil {
		return AgentReply{}, common.Address{}, false, common.Hash{}, err
	}
	return decoded.Reply, decoded.Verifier, decoded.Proven, decoded.VerificationDigest, nil
}

// OnAgentReply submits a reply to a dispatched task by broadcasting
// onAgentReply(reply) and waits for the transaction to be mined, so that a
// subsequent GetReply sees the anchored reply. reply.Replier MUST equal the
// signing account's address; the contract anchors the reply under its derived
// replyHash (see ComputeReplyHash). Returns ErrNoSigner if the client has no
// private key.
func (c *AgentWorkflowClient) OnAgentReply(ctx context.Context, reply AgentReply) (*types.Transaction, error) {
	if c.key == nil {
		return nil, ErrNoSigner
	}
	tx, err := c.transact(ctx, "onAgentReply", reply)
	if err != nil {
		return nil, err
	}
	_, err = bind.WaitMined(ctx, c.rpc, tx)
	if err != nil {
		return nil, fmt.Errorf("erc8301: wait for onAgentReply to mine: %w", err)
	}
	return tx, nil
}

// OnAgentProve submits a cryptographic proof covering one or more anchored
// replies by broadcasting onAgentProve(replyHashes, proof) and waits for the
// transaction to be mined, so that a subsequent GetReply sees the proof
// recorded (proven=true). Returns ErrNoSigner if the client has no private
// key.
func (c *AgentWorkflowClient) OnAgentProve(ctx context.Context, replyHashes []common.Hash, proof []byte) (*types.Transaction, error) {
	if c.key == nil {
		return nil, ErrNoSigner
	}
	tx, err := c.transact(ctx, "onAgentProve", replyHashes, proof)
	if err != nil {
		return nil, err
	}
	_, err = bind.WaitMined(ctx, c.rpc, tx)
	if err != nil {
		return nil, fmt.Errorf("erc8301: wait for onAgentProve to mine: %w", err)
	}
	return tx, nil
}

// transact packs the method inputs via the ABI (a.Pack prepends the 4-byte
// method selector), signs with the client's key and broadcasts. Gas limit,
// base fee and nonce are resolved against the live node; the chain id is
// fetched from the RPC at call time.
func (c *AgentWorkflowClient) transact(ctx context.Context, methodName string, args ...interface{}) (*types.Transaction, error) {
	a, err := AgentWorkflowABI()
	if err != nil {
		return nil, fmt.Errorf("erc8301: parse ABI: %w", err)
	}
	chainID, err := c.rpc.ChainID(ctx)
	if err != nil {
		return nil, fmt.Errorf("erc8301: fetch chain id: %w", err)
	}
	auth, err := bind.NewKeyedTransactorWithChainID(c.key, chainID)
	if err != nil {
		return nil, fmt.Errorf("erc8301: create transactor: %w", err)
	}
	bound := bind.NewBoundContract(c.address, a, c.rpc, c.rpc, c.rpc)
	tx, err := bound.Transact(auth, methodName, args...)
	if err != nil {
		return nil, fmt.Errorf("erc8301: %s: %w", methodName, err)
	}
	return tx, nil
}

// callView packs the function inputs and performs a read-only eth_call
// against the bound contract address.
//
// GOTCHA: the inputs must be packed via abi.ABI.Pack(name, args...), which
// prepends the 4-byte method selector — packing the arguments standalone
// with abi.Arguments.Pack produces calldata with no selector, which the
// node would reject.
func (c *AgentWorkflowClient) callView(ctx context.Context, methodName string, args ...interface{}) ([]byte, error) {
	a, err := AgentWorkflowABI()
	if err != nil {
		return nil, fmt.Errorf("erc8301: parse ABI: %w", err)
	}
	data, err := a.Pack(methodName, args...)
	if err != nil {
		return nil, fmt.Errorf("erc8301: pack %s inputs: %w", methodName, err)
	}
	msg := ethereum.CallMsg{To: &c.address, Data: data}
	return c.rpc.CallContract(ctx, msg, nil)
}

// outputs unpacks the raw call result with the method's declared output
// types.
func (c *AgentWorkflowClient) outputs(methodName string, data []byte) ([]interface{}, error) {
	a, err := AgentWorkflowABI()
	if err != nil {
		return nil, fmt.Errorf("erc8301: parse ABI: %w", err)
	}
	method, ok := a.Methods[methodName]
	if !ok {
		return nil, fmt.Errorf("erc8301: ABI has no method %q", methodName)
	}
	vals, err := method.Outputs.Unpack(data)
	if err != nil {
		return nil, fmt.Errorf("erc8301: unpack %s outputs: %w", methodName, err)
	}
	return vals, nil
}

// copyOutputs copies the decoded outputs into the destination struct via
// abi.Arguments.Copy, mapping every output onto a struct field by name
// (case-insensitive): tuple outputs land in matching struct fields, and
// atomic outputs in their own fields (see GetTask/GetReply).
func (c *AgentWorkflowClient) copyOutputs(methodName string, dest interface{}, vals []interface{}) error {
	a, err := AgentWorkflowABI()
	if err != nil {
		return fmt.Errorf("erc8301: parse ABI: %w", err)
	}
	method, ok := a.Methods[methodName]
	if !ok {
		return fmt.Errorf("erc8301: ABI has no method %q", methodName)
	}
	if err := method.Outputs.Copy(dest, vals); err != nil {
		return fmt.Errorf("erc8301: copy %s outputs: %w", methodName, err)
	}
	return nil
}

// parseNewAgentTask extracts workflowRunId, stage and taskHash from a
// NewAgentTask event log. All three inputs are indexed, so they live in the
// log's topics (topic 0 = event signature; topics 1-3 = values).
func parseNewAgentTask(receipt *types.Receipt) (RunInfo, error) {
	a, err := AgentWorkflowABI()
	if err != nil {
		return RunInfo{}, fmt.Errorf("erc8301: parse ABI: %w", err)
	}
	evt, ok := a.Events["NewAgentTask"]
	if !ok {
		return RunInfo{}, fmt.Errorf("erc8301: ABI has no event NewAgentTask")
	}
	for _, log := range receipt.Logs {
		if log.Topics[0] != evt.ID {
			continue
		}
		if len(log.Topics) != 4 {
			return RunInfo{}, fmt.Errorf("erc8301: NewAgentTask log has %d topics, want 4", len(log.Topics))
		}
		stage := new(big.Int).SetBytes(log.Topics[2].Bytes()).Uint64()
		return RunInfo{
			WorkflowRunId: common.BytesToHash(log.Topics[1].Bytes()),
			TaskHash:      common.BytesToHash(log.Topics[3].Bytes()),
			Stage:         uint8(stage),
		}, nil
	}
	return RunInfo{}, fmt.Errorf("erc8301: NewAgentTask event not found in run receipt")
}

func asRunStatus(v interface{}) (RunStatus, error) {
	if s, ok := v.(uint8); ok {
		return RunStatus(s), nil
	}
	return 0, fmt.Errorf("erc8301: expected uint8 status output, got %T", v)
}

func asUint64(v interface{}) (uint64, error) {
	switch x := v.(type) {
	case uint64:
		return x, nil
	case *big.Int:
		if !x.IsUint64() {
			return 0, fmt.Errorf("erc8301: uint256 output overflows uint64: %s", x.String())
		}
		return x.Uint64(), nil
	}
	return 0, fmt.Errorf("erc8301: expected uint64 output, got %T", v)
}

func asAddress(v interface{}) (common.Address, error) {
	if a, ok := v.(common.Address); ok {
		return a, nil
	}
	return common.Address{}, fmt.Errorf("erc8301: expected address output, got %T", v)
}

func asHash(v interface{}) (common.Hash, error) {
	switch h := v.(type) {
	case common.Hash:
		return h, nil
	case [32]byte:
		return common.BytesToHash(h[:]), nil
	}
	return common.Hash{}, fmt.Errorf("erc8301: expected bytes32 output, got %T", v)
}
