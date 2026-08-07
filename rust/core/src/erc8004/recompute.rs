use alloy_primitives::FixedBytes;

/// ERC-8004 / ERC-8299: agentId = bytes32(uint256(registryId))
/// Left-padded, NOT a hash. The registry-assigned id as a bytes32.
pub fn compute_agent_id(registry_id: u64) -> FixedBytes<32> {
    let be = registry_id.to_be_bytes();
    let mut buf = [0u8; 32];
    buf[24..32].copy_from_slice(&be);
    FixedBytes::new(buf)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Golden vector: registryId 860 → "0x000000000000000000000000000000000000000000000000000000000000035c"
    #[test]
    fn golden_wizgob_registry_id_860() {
        let id = compute_agent_id(860);
        assert_eq!(id[31], 0x5c);
        assert_eq!(id[30], 0x03);
        assert_eq!(id[0], 0x00);
    }

    /// Golden vector: registryId 54848 → "0x000000000000000000000000000000000000000000000000000000000000d640"
    #[test]
    fn golden_ours_registry_id_54848() {
        let id = compute_agent_id(54848);
        assert_eq!(id[31], 0x40);
        assert_eq!(id[30], 0xd6);
        assert_eq!(id[0], 0x00);
    }

    #[test]
    fn zero_becomes_zero_bytes32() {
        let id = compute_agent_id(0);
        assert_eq!(id, FixedBytes::new([0u8; 32]));
    }

    #[test]
    fn one_is_trailing_byte() {
        let id = compute_agent_id(1);
        assert_eq!(id[31], 1);
        assert_eq!(id[30], 0);
    }

    /// Max u64: 0xffff_ffff_ffff_ffff — still fits in bytes32, left-padded with 24 zero bytes.
    #[test]
    fn max_u64_is_left_padded() {
        let id = compute_agent_id(u64::MAX);
        assert_eq!(id[0], 0x00); // left-padded — first 24 bytes are zero
        assert_eq!(id[23], 0x00);
        assert_eq!(id[24], 0xff); // u64 starts here
    }
}

#[cfg(test)]
mod golden_vector_tests {
    use super::*;
    use alloy_primitives::hex;
    use serde_json::Value;

    const VECTORS_STR: &str =
        include_str!("../../../../testkit/vectors/erc8004-agent-id.vectors.json");

    #[test]
    fn golden_vectors() {
        let data: Value = serde_json::from_str(VECTORS_STR).unwrap();
        for v in data["vectors"].as_array().unwrap() {
            let step = v["step"].as_str().unwrap();
            match step {
                "8004/agent-id" => {
                    let registry_id = v["inputs"]["registryId"].as_u64().unwrap();
                    let expected_bytes =
                        hex::decode(v["expected"].as_str().unwrap().trim_start_matches("0x"))
                            .unwrap();
                    let expected = FixedBytes::<32>::from_slice(&expected_bytes);
                    assert_eq!(compute_agent_id(registry_id), expected);
                }
                _ => panic!("unknown step {}", step),
            }
        }
    }
}
