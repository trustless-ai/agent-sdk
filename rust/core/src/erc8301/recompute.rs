use alloy_core::sol;
use alloy_primitives::{keccak256, Address, FixedBytes, U256};

sol! {
    /// Solidity struct matching AgentTask encoding.
    struct TaskEncoding {
        uint8 stage;
        uint256 taskSeq;
        bytes32 inputHash;
        uint256 timestamp;
        uint256 expiresAt;
        bytes32 innerHash;
        bytes32 workflowRunId;
    }

    /// Solidity struct matching AgentReply encoding.
    struct ReplyEncoding {
        bytes32 outputHash;
        uint256 timestamp;
        address replier;
        bytes32 innerHash;
        bytes32 workflowRunId;
    }
}

/// Compute the inner hash for an AgentTask or AgentReply.
///
/// ERC-8301 §AgentTask / §AgentReply:
///   innerHash = keccak256(abi.encodePacked(hashesPacked))
///
/// CRITICAL: When hashesPacked is empty, the result is keccak256("") =
/// 0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470,
/// NOT bytes32(0).
pub fn compute_inner_hash(hashes_packed: &[u8]) -> FixedBytes<32> {
    keccak256(hashes_packed)
}

/// Compute the task hash for an AgentTask.
///
/// ERC-8301 §AgentTask:
///   taskHash = keccak256(abi.encode(stage, taskSeq, inputHash, timestamp,
///       expiresAt, keccak256(abi.encodePacked(prevReplyHashes)), workflowRunId))
///
/// Golden vector from recompute-kit "8301/task-hash":
///   → 0xf1f404c844a4aff1d0d7d17cebb518a2d386197aad09ab86517eaa01448301ec
pub fn compute_task_hash(
    stage: u8,
    task_seq: U256,
    input_hash: FixedBytes<32>,
    timestamp: U256,
    expires_at: U256,
    prev_reply_hashes_packed: &[u8],
    workflow_run_id: FixedBytes<32>,
) -> FixedBytes<32> {
    let inner_hash = compute_inner_hash(prev_reply_hashes_packed);
    let enc = TaskEncoding {
        stage,
        taskSeq: task_seq,
        inputHash: input_hash,
        timestamp,
        expiresAt: expires_at,
        innerHash: inner_hash,
        workflowRunId: workflow_run_id,
    };
    keccak256(&alloy_core::sol_types::SolValue::abi_encode(&enc))
}

/// Compute the reply hash for an AgentReply.
///
/// ERC-8301 §AgentReply:
///   replyHash = keccak256(abi.encode(outputHash, timestamp, replier,
///       keccak256(abi.encodePacked(prevTaskHashes)), workflowRunId))
pub fn compute_reply_hash(
    output_hash: FixedBytes<32>,
    timestamp: U256,
    replier: Address,
    prev_task_hashes_packed: &[u8],
    workflow_run_id: FixedBytes<32>,
) -> FixedBytes<32> {
    let inner_hash = compute_inner_hash(prev_task_hashes_packed);
    let enc = ReplyEncoding {
        outputHash: output_hash,
        timestamp,
        replier,
        innerHash: inner_hash,
        workflowRunId: workflow_run_id,
    };
    keccak256(&alloy_core::sol_types::SolValue::abi_encode(&enc))
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloy_primitives::hex;

    /// Inline golden vector from recompute-kit "8301/task-hash".
    #[test]
    fn golden_task_hash_initial() {
        let hash = compute_task_hash(
            1,
            U256::ZERO,
            FixedBytes::<32>::from(hex!(
                "1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8"
            )),
            U256::from(1700000000u64),
            U256::from(1700001000u64),
            &[], // empty prevReplyHashes — critical edge case
            FixedBytes::<32>::from(hex!(
                "00000000000000000000000000000000000000000000000000000000deadbeef"
            )),
        );
        let expected = FixedBytes::<32>::from(hex!(
            "f1f404c844a4aff1d0d7d17cebb518a2d386197aad09ab86517eaa01448301ec"
        ));
        assert_eq!(hash, expected);
    }

    /// Empty inner hash is keccak256(""), NOT bytes32(0).
    #[test]
    fn empty_inner_hash_is_keccak_of_empty() {
        let hash = compute_inner_hash(&[]);
        let expected = FixedBytes::<32>::from(hex!(
            "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"
        ));
        assert_eq!(hash, expected);
    }

    /// keccak256("") != bytes32(0) — this is the guard Fede flagged.
    #[test]
    fn empty_inner_hash_not_bytes32_zero() {
        let hash = compute_inner_hash(&[]);
        assert_ne!(hash, FixedBytes::ZERO);
    }

    #[test]
    fn task_hash_deterministic() {
        let a = compute_task_hash(
            0,
            U256::ZERO,
            FixedBytes::ZERO,
            U256::ZERO,
            U256::ZERO,
            &[],
            FixedBytes::ZERO,
        );
        let b = compute_task_hash(
            0,
            U256::ZERO,
            FixedBytes::ZERO,
            U256::ZERO,
            U256::ZERO,
            &[],
            FixedBytes::ZERO,
        );
        assert_eq!(a, b);
    }

    #[test]
    fn different_stage_different_hash() {
        let a = compute_task_hash(
            0,
            U256::ZERO,
            FixedBytes::ZERO,
            U256::ZERO,
            U256::ZERO,
            &[],
            FixedBytes::ZERO,
        );
        let b = compute_task_hash(
            1,
            U256::ZERO,
            FixedBytes::ZERO,
            U256::ZERO,
            U256::ZERO,
            &[],
            FixedBytes::ZERO,
        );
        assert_ne!(a, b);
    }

    #[test]
    fn reply_hash_vs_task_hash_different() {
        let task = compute_task_hash(
            0,
            U256::ZERO,
            FixedBytes::ZERO,
            U256::ZERO,
            U256::ZERO,
            &[],
            FixedBytes::ZERO,
        );
        let reply = compute_reply_hash(
            FixedBytes::ZERO,
            U256::ZERO,
            Address::ZERO,
            &[],
            FixedBytes::ZERO,
        );
        assert_ne!(task, reply);
    }
}

#[cfg(test)]
mod golden_vector_tests {
    use super::*;
    use alloy_primitives::hex;
    use serde_json::Value;

    const VECTORS_STR: &str =
        include_str!("../../../../testkit/vectors/erc8301-task-hash.vectors.json");

    fn fixed_bytes32(s: &str) -> FixedBytes<32> {
        FixedBytes::<32>::from_slice(&hex::decode(s.trim_start_matches("0x")).unwrap())
    }

    #[test]
    fn golden_vectors() {
        let data: Value = serde_json::from_str(VECTORS_STR).unwrap();
        for v in data["vectors"].as_array().unwrap() {
            let step = v["step"].as_str().unwrap();
            match step {
                "8301/task-hash" => {
                    let inputs = &v["inputs"];
                    let stage = inputs["stage"].as_u64().unwrap() as u8;
                    let task_seq = U256::from(inputs["taskSeq"].as_u64().unwrap());
                    let input_hash = fixed_bytes32(inputs["inputHash"].as_str().unwrap());
                    let timestamp = U256::from(inputs["timestamp"].as_u64().unwrap());
                    let expires_at = U256::from(inputs["expiresAt"].as_u64().unwrap());
                    let prev_reply_hashes_packed = hex::decode(
                        inputs["prevReplyHashesPacked"]
                            .as_str()
                            .unwrap()
                            .trim_start_matches("0x"),
                    )
                    .unwrap();
                    let workflow_run_id = fixed_bytes32(inputs["workflowRunId"].as_str().unwrap());
                    let expected = fixed_bytes32(v["expected"].as_str().unwrap());
                    assert_eq!(
                        compute_task_hash(
                            stage,
                            task_seq,
                            input_hash,
                            timestamp,
                            expires_at,
                            &prev_reply_hashes_packed,
                            workflow_run_id,
                        ),
                        expected
                    );
                }
                _ => panic!("unknown step {}", step),
            }
        }
    }
}
