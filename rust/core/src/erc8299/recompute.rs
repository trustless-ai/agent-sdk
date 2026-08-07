use alloc::format;
use alloc::string::String;
use alloc::vec::Vec;
use alloy_primitives::hex;
use alloy_primitives::{keccak256, FixedBytes};
use sha2::{Digest, Sha256};

/// ERC-8299 §45: raw_input_hash = keccak256(raw_user_input)
pub fn compute_raw_input_hash(raw_user_input: &[u8]) -> FixedBytes<32> {
    keccak256(raw_user_input)
}

/// ERC-8299 §46: sanitization_pipeline_hash = keccak256(utf8(cid) || raw_input_hash)
pub fn compute_sanitization_pipeline_hash(
    cid: &str,
    raw_input_hash: FixedBytes<32>,
) -> FixedBytes<32> {
    let mut buf = Vec::with_capacity(cid.len() + 32);
    buf.extend_from_slice(cid.as_bytes());
    buf.extend_from_slice(raw_input_hash.as_slice());
    keccak256(&buf)
}

/// ERC-8299 L4: rawProposalHash = sha256(utf8(artifact)) — sha256, NOT keccak256.
///
/// The L4 layer (judgment validator chain-of-custody) is designed to anchor
/// off-chain (Nostr-relay-published) verdicts as well as on-chain ones, so it
/// uses sha256 over the raw artifact string directly — matching
/// invinoveritas's reference implementation (services/proof_signing.py:
/// `artifact_hash = sha256(artifact)`), not the EVM-native keccak256 the
/// L1-L3 layer uses for its on-chain contract calls.
pub fn compute_raw_proposal_hash(artifact: &str) -> String {
    let h = Sha256::digest(artifact.as_bytes());
    format!("0x{}", hex::encode(h))
}

/// ERC-8299 L4: verdictHash = "sha256:" + sha256(JCS(preimage fields)).
///
/// JCS (RFC 8785): keys sorted by code-point order, canonical JSON (no
/// extraneous whitespace, literal UTF-8 — never \uXXXX-escaped), sha256.
/// Rust's `&str` ordering is UTF-8 byte order, which is identical to
/// code-point order (unlike JS UTF-16 code-unit order), so `sort()` is
/// JCS-conformant. A preimage key missing from `fields` serializes as JSON
/// null (never as "").
pub fn compute_verdict_hash(
    fields: &[(&str, Option<&str>)],
    preimage_fields: &[&str],
) -> String {
    let mut sorted: Vec<&str> = preimage_fields.to_vec();
    sorted.sort(); // UTF-8 byte order = code-point order for valid UTF-8

    let mut parts: Vec<String> = Vec::new();
    for k in &sorted {
        let kj = serde_json::to_string(k).unwrap();
        let vj = match fields.iter().find(|(fk, _)| *fk == *k) {
            Some((_, Some(v))) => serde_json::to_string(v).unwrap(),
            _ => String::from("null"),
        };
        parts.push(format!("{}:{}", kj, vj));
    }
    let canon = format!("{{{}}}", parts.join(","));
    let h = Sha256::digest(canon.as_bytes());
    format!("sha256:{}", hex::encode(h))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Golden vector "wyriwe/raw" (testkit/vectors/erc8299-wyriwe.vectors.json):
    /// raw_input_hex "0x68656c6c6f"
    /// expected: 0x1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8
    #[test]
    fn golden_raw_input_hash() {
        let raw = hex!("68656c6c6f");
        let hash = compute_raw_input_hash(&raw);
        let expected = FixedBytes::<32>::from(hex!(
            "1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8"
        ));
        assert_eq!(hash, expected);
    }

    /// Golden vector "wyriwe/pipeline" (testkit/vectors/erc8299-wyriwe.vectors.json):
    /// cid "ipfs://QmccvoM6aRVgZ2dtFWvT6Wm3DmTvoAUHHotK7uQufnStVR" + raw_input_hash
    /// expected: 0x5798efed4aa92f96a0622fc30268042b067294bdb5fd06f599bf8d84fd5d734b
    #[test]
    fn golden_sanitization_pipeline_hash() {
        let raw_hash = FixedBytes::<32>::from(hex!(
            "1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8"
        ));
        let cid = "ipfs://QmccvoM6aRVgZ2dtFWvT6Wm3DmTvoAUHHotK7uQufnStVR";
        let hash = compute_sanitization_pipeline_hash(cid, raw_hash);
        let expected = FixedBytes::<32>::from(hex!(
            "5798efed4aa92f96a0622fc30268042b067294bdb5fd06f599bf8d84fd5d734b"
        ));
        assert_eq!(hash, expected);
    }

    #[test]
    fn empty_input_produces_keccak_of_empty() {
        let hash = compute_raw_input_hash(&[]);
        // keccak256("") = 0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470
        let expected = FixedBytes::<32>::from(hex!(
            "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"
        ));
        assert_eq!(hash, expected);
    }

    #[test]
    fn different_input_different_hash() {
        let a = compute_raw_input_hash(&[1u8]);
        let b = compute_raw_input_hash(&[2u8]);
        assert_ne!(a, b);
    }

    /// Golden vector "8299-l4/raw-proposal-hash" (testkit/vectors/erc8299-l4.vectors.json):
    /// sha256(utf8(artifact)) — sha256, NOT keccak256
    /// expected: 0xb8f70a237da212a272ecd09370acedbce6ca1d7df90745beafcac77e39697a88
    #[test]
    fn golden_raw_proposal_hash() {
        let artifact = "test artifact content for cross-language verification";
        assert_eq!(
            compute_raw_proposal_hash(artifact),
            "0xb8f70a237da212a272ecd09370acedbce6ca1d7df90745beafcac77e39697a88"
        );
    }

    /// Golden vector "8299-l4/raw-proposal-hash": empty artifact is a legal input
    /// expected: sha256("") = 0xe3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    #[test]
    fn golden_raw_proposal_hash_empty() {
        assert_eq!(
            compute_raw_proposal_hash(""),
            "0xe3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    /// Golden vector "8299-l4/verdict-hash" (LIVE): reproduces the real
    /// decision_ref of invinoveritas /ledger entry #236 from its published
    /// decision_ref_preimage_fields — 8 fields, two of them null
    /// expected: sha256:5bca0bf044c8e1c8e16a01bf3ee44b12c305ce6a50dd9789ff73cbd13482b9b9
    #[test]
    fn golden_verdict_hash_real_ledger() {
        let fields: &[(&str, Option<&str>)] = &[
            (
                "artifact_hash",
                Some("bdb4d93c421d54883a0c31821d37d197a91a972062be28babed3599dcf2fbdb3"),
            ),
            ("artifact_type", Some("onchain_action")),
            ("policy_version", Some("invinoveritas.review.v7")),
            ("verdict", Some("reject")),
            ("source_class", Some("agent_reported")),
            (
                "vantage_limitation",
                Some("source_class=agent_reported: nothing external confirms this /review call happened, or could not be bypassed, before the action it governs. Recomputability makes this record internally consistent (an occurrence claim) — it is not an absence/completeness claim, which needs a vantage the acting agent doesn't control. Sufficient as standalone evidence for a reversible action; for an irreversible or privileged action, treat this proof as advisory input, not standalone authorization, until paired with an independent mediation-point integration."),
            ),
            ("related_decision_ref", None),
            ("intended_audience", None),
        ];
        let preimage_fields: &[&str] = &[
            "artifact_hash",
            "artifact_type",
            "policy_version",
            "verdict",
            "source_class",
            "vantage_limitation",
            "related_decision_ref",
            "intended_audience",
        ];
        assert_eq!(
            compute_verdict_hash(fields, preimage_fields),
            "sha256:5bca0bf044c8e1c8e16a01bf3ee44b12c305ce6a50dd9789ff73cbd13482b9b9"
        );
    }

    /// Golden vector "8299-l4/verdict-hash": null-valued preimage fields must be
    /// present as JSON null, never omitted — 6 fields, one of them null
    /// expected: sha256:2970854c035d5aedb673b8523128665712895f62dd525c91fc8e858ad588ce58
    #[test]
    fn golden_verdict_hash_null_fields() {
        let fields: &[(&str, Option<&str>)] = &[
            (
                "artifact_hash",
                Some("b8f70a237da212a272ecd09370acedbce6ca1d7df90745beafcac77e39697a88"),
            ),
            ("artifact_type", Some("plan")),
            ("policy_version", Some("invinoveritas.review.v4")),
            ("verdict", Some("approve")),
            ("source_class", Some("agent_reported")),
            ("vantage_limitation", None),
        ];
        let preimage_fields: &[&str] = &[
            "artifact_hash",
            "artifact_type",
            "policy_version",
            "verdict",
            "source_class",
            "vantage_limitation",
        ];
        assert_eq!(
            compute_verdict_hash(fields, preimage_fields),
            "sha256:2970854c035d5aedb673b8523128665712895f62dd525c91fc8e858ad588ce58"
        );
    }

    /// Golden vector "8299-l4/verdict-hash" (KEY-SORT CONFORMANCE): a preimage
    /// key above U+FFFF (😀) sorts differently under UTF-16 code units (JS
    /// Array.sort) than under code points (JCS/RFC-8785 requires CODE POINT
    /// order). Rust's &str ordering is UTF-8 byte order == code-point order,
    /// so this port passes where naive JS sorting fails.
    /// expected: sha256:36e2e43ff6d7062ebb64c209604b7ce028b4eb88d4db2892e872194d16f36bca
    #[test]
    fn golden_verdict_hash_key_sort() {
        let fields: &[(&str, Option<&str>)] = &[
            ("a", Some("ascii")),
            ("Ｚ", Some("fullwidth-Z")),
            ("😀", Some("emoji")),
        ];
        let preimage_fields: &[&str] = &["a", "Ｚ", "😀"];
        assert_eq!(
            compute_verdict_hash(fields, preimage_fields),
            "sha256:36e2e43ff6d7062ebb64c209604b7ce028b4eb88d4db2892e872194d16f36bca"
        );
    }
}

#[cfg(test)]
mod golden_vector_tests {
    use super::*;
    use serde_json::Value;

    const WYRIWE_VECTORS_STR: &str =
        include_str!("../../../../testkit/vectors/erc8299-wyriwe.vectors.json");
    const L4_VECTORS_STR: &str =
        include_str!("../../../../testkit/vectors/erc8299-l4.vectors.json");

    fn fixed_bytes32(s: &str) -> FixedBytes<32> {
        FixedBytes::<32>::from_slice(&hex::decode(s.trim_start_matches("0x")).unwrap())
    }

    #[test]
    fn golden_vectors_wyriwe() {
        let data: Value = serde_json::from_str(WYRIWE_VECTORS_STR).unwrap();
        for v in data["vectors"].as_array().unwrap() {
            let step = v["step"].as_str().unwrap();
            match step {
                "wyriwe/raw" => {
                    let raw = hex::decode(
                        v["inputs"]["raw_input_hex"]
                            .as_str()
                            .unwrap()
                            .trim_start_matches("0x"),
                    )
                    .unwrap();
                    assert_eq!(
                        compute_raw_input_hash(&raw),
                        fixed_bytes32(v["expected"].as_str().unwrap())
                    );
                }
                "wyriwe/pipeline" => {
                    let cid = v["inputs"]["spec_cid"].as_str().unwrap();
                    let raw_input_hash =
                        fixed_bytes32(v["inputs"]["raw_input_hash"].as_str().unwrap());
                    assert_eq!(
                        compute_sanitization_pipeline_hash(cid, raw_input_hash),
                        fixed_bytes32(v["expected"].as_str().unwrap())
                    );
                }
                _ => panic!("unknown step {}", step),
            }
        }
    }

    #[test]
    fn golden_vectors_l4() {
        let data: Value = serde_json::from_str(L4_VECTORS_STR).unwrap();
        for v in data["vectors"].as_array().unwrap() {
            let step = v["step"].as_str().unwrap();
            match step {
                "8299-l4/raw-proposal-hash" => {
                    let artifact = v["inputs"]["artifact"].as_str().unwrap();
                    let expected = v["expected"].as_str().unwrap().to_string();
                    assert_eq!(compute_raw_proposal_hash(artifact), expected);
                }
                "8299-l4/verdict-hash" => {
                    let fields_obj = v["inputs"]["fields"].as_object().unwrap();
                    let fields: Vec<(&str, Option<&str>)> = fields_obj
                        .iter()
                        .map(|(k, val)| (k.as_str(), val.as_str()))
                        .collect();
                    let preimage_fields: Vec<&str> = v["inputs"]["preimage_fields"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|k| k.as_str().unwrap())
                        .collect();
                    let expected = v["expected"].as_str().unwrap().to_string();
                    assert_eq!(compute_verdict_hash(&fields, &preimage_fields), expected);
                }
                _ => panic!("unknown step {}", step),
            }
        }
    }
}
