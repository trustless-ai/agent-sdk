use alloy_core::sol_types::SolValue;
use alloy_primitives::{keccak256, FixedBytes};

/// ERC-8203 settlement: compute the verdict hash from jobId and resultText.
///
/// verdictHash = keccak256(abi.encode(jobId, resultHash))
///   where resultHash = keccak256(utf8(resultText))
///
/// This is the commitment ConsultEscrow.release() recomputes on-chain
/// before checking the attestor's signature.
pub fn compute_verdict_hash(job_id: FixedBytes<32>, result_text: &str) -> FixedBytes<32> {
    let result_hash = keccak256(result_text.as_bytes());
    let encoded = (job_id, result_hash).abi_encode();
    keccak256(&encoded)
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloy_primitives::hex;

    /// Golden vector from recompute-kit "8203/settlement-proof":
    /// jobId: 0xbc01b40fe7a3509f35470053d4bc1844d50c9782546cf0fc11154adcb90caa56
    /// resultText: "No intermediaries required, cryptographic verification only."
    /// expected: 0xdc568bd1cbacdd1ead8231e9d3d6f4e475f5168f3cc9f72b31935d46cfdd48f7
    #[test]
    fn golden_verdict_hash() {
        let job_id = FixedBytes::<32>::from(hex!(
            "bc01b40fe7a3509f35470053d4bc1844d50c9782546cf0fc11154adcb90caa56"
        ));
        let text = "No intermediaries required, cryptographic verification only.";
        let hash = compute_verdict_hash(job_id, text);
        let expected = FixedBytes::<32>::from(hex!(
            "dc568bd1cbacdd1ead8231e9d3d6f4e475f5168f3cc9f72b31935d46cfdd48f7"
        ));
        assert_eq!(hash, expected);
    }

    #[test]
    fn empty_text_produces_keccak_of_empty_string() {
        let job_id = FixedBytes::ZERO;
        let hash = compute_verdict_hash(job_id, "");
        let result_hash = keccak256(b"");
        let expected = keccak256(&(job_id, result_hash).abi_encode());
        assert_eq!(hash, expected);
    }

    #[test]
    fn different_job_different_hash() {
        let text = "same text";
        let a = compute_verdict_hash(FixedBytes::ZERO, text);
        let other = FixedBytes::<32>::from(hex!(
            "0000000000000000000000000000000000000000000000000000000000000001"
        ));
        let b = compute_verdict_hash(other, text);
        assert_ne!(a, b);
    }

    #[test]
    fn different_text_different_hash() {
        let job_id = FixedBytes::ZERO;
        let a = compute_verdict_hash(job_id, "option A");
        let b = compute_verdict_hash(job_id, "option B");
        assert_ne!(a, b);
    }
}

#[cfg(test)]
mod golden_vector_tests {
    use super::*;
    use alloy_primitives::hex;
    use serde_json::Value;

    const VECTORS_STR: &str =
        include_str!("../../../../testkit/vectors/erc8203-settlement-proof.vectors.json");

    #[test]
    fn golden_vectors() {
        let data: Value = serde_json::from_str(VECTORS_STR).unwrap();
        for v in data["vectors"].as_array().unwrap() {
            let step = v["step"].as_str().unwrap();
            match step {
                "8203/settlement-proof" => {
                    let job_id_bytes =
                        hex::decode(v["inputs"]["jobId"].as_str().unwrap().trim_start_matches("0x"))
                            .unwrap();
                    let job_id = FixedBytes::<32>::from_slice(&job_id_bytes);
                    let result_text = v["inputs"]["resultText"].as_str().unwrap();
                    let expected_bytes =
                        hex::decode(v["expected"].as_str().unwrap().trim_start_matches("0x"))
                            .unwrap();
                    let expected = FixedBytes::<32>::from_slice(&expected_bytes);
                    assert_eq!(compute_verdict_hash(job_id, result_text), expected);
                }
                _ => panic!("unknown step {}", step),
            }
        }
    }
}
