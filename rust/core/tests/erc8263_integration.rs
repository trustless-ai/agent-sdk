#![cfg(feature = "std")]
/// ERC-8263 integration tests — testkit workflow.
///
/// ```bash
/// testkit/scripts/start-anvil.sh
/// testkit/scripts/deploy.sh anchor/ERC8263 DeployERC8263
/// cargo test --manifest-path rust/core/Cargo.toml --test erc8263_integration -- --nocapture
/// testkit/scripts/stop-anvil.sh
/// ```
use alloy::primitives::{Address, Bytes, FixedBytes};
use alloy::providers::ProviderBuilder;
use alloy::sol;

sol! {
    #[allow(missing_docs)]
    #[sol(rpc)]
    interface IOnChainProof {
        function anchor(uint8 agentIdScheme, bytes32 agentId, bytes32 proofHash) external;
        function anchorWithAux(uint8 agentIdScheme, bytes32 agentId, bytes32 proofHash, bytes aux) external;
        event AnchorProof(uint8 agentIdScheme, bytes32 indexed agentId, bytes32 indexed proofHash, address indexed operator, bytes aux);
    }
}

const ANVIL_RPC: &str = "http://127.0.0.1:8545";

fn anvil_key() -> String {
    if let Ok(key) = std::env::var("ANVIL_KEY") {
        return key;
    }
    let path =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../testkit/.anvil-accounts.json");
    let data = std::fs::read_to_string(&path).expect("cannot read anvil accounts file");
    let parsed: serde_json::Value = serde_json::from_str(&data).expect("invalid JSON");
    parsed["accounts"][0]["privateKey"]
        .as_str()
        .expect("no account")
        .to_string()
}

fn contract_address() -> Address {
    std::env::var("ERC8263_ADDRESS")
        .unwrap_or_default()
        .parse()
        .unwrap_or(Address::ZERO)
}

#[tokio::test]
async fn anchors_emit_anchor_proof_events() {
    let addr = contract_address();
    assert!(
        !addr.is_zero(),
        "ERC8263_ADDRESS not set — deploy first via testkit/scripts/deploy.sh anchor/ERC8263 DeployERC8263"
    );

    let key = anvil_key();
    let signer: alloy::signers::local::PrivateKeySigner = key.parse().expect("invalid key");
    let provider = ProviderBuilder::new()
        .wallet(signer)
        .connect_http(ANVIL_RPC.parse().unwrap());
    let contract = IOnChainProof::new(addr, provider);

    // 1. Anonymous scheme
    let receipt = contract
        .anchor(0, FixedBytes::ZERO, FixedBytes::from([0x01; 32]))
        .send()
        .await
        .expect("anchor ANONYMOUS")
        .get_receipt()
        .await
        .expect("receipt");
    eprintln!("anchor (ANONYMOUS) tx: {:?}", receipt.transaction_hash);
    assert!(receipt.status(), "ANONYMOUS must succeed");
    let logs = receipt.inner.logs();
    assert!(!logs.is_empty(), "should emit AnchorProof event");

    // 2. Registry scheme
    let receipt = contract
        .anchor(1, FixedBytes::from([0xab; 32]), FixedBytes::from([0x02; 32]))
        .send()
        .await
        .expect("anchor REGISTRY")
        .get_receipt()
        .await
        .expect("receipt");
    eprintln!("anchor (REGISTRY) tx: {:?}", receipt.transaction_hash);
    assert!(receipt.status(), "REGISTRY must succeed");

    // 3. URI_HASH scheme
    let receipt = contract
        .anchor(2, FixedBytes::from([0xcd; 32]), FixedBytes::from([0x03; 32]))
        .send()
        .await
        .expect("anchor URI_HASH")
        .get_receipt()
        .await
        .expect("receipt");
    eprintln!("anchor (URI_HASH) tx: {:?}", receipt.transaction_hash);
    assert!(receipt.status(), "URI_HASH must succeed");

    // 4. anchorWithAux
    let aux = Bytes::from(&b"hello-aux"[..]);
    let receipt = contract
        .anchorWithAux(
            1,
            FixedBytes::from([0xff; 32]),
            FixedBytes::from([0xee; 32]),
            aux,
        )
        .send()
        .await
        .expect("anchorWithAux")
        .get_receipt()
        .await
        .expect("receipt");
    eprintln!("anchorWithAux tx: {:?}", receipt.transaction_hash);
    assert!(receipt.status(), "anchorWithAux must succeed");
    let logs = receipt.inner.logs();
    assert!(!logs.is_empty(), "should emit AnchorProof event");
}

#[tokio::test]
async fn rejects_invalid_anchors() {
    let addr = contract_address();
    assert!(
        !addr.is_zero(),
        "ERC8263_ADDRESS not set — deploy first via testkit/scripts/deploy.sh anchor/ERC8263 DeployERC8263"
    );

    let key = anvil_key();
    let signer: alloy::signers::local::PrivateKeySigner = key.parse().expect("invalid key");
    let provider = ProviderBuilder::new()
        .wallet(signer)
        .connect_http(ANVIL_RPC.parse().unwrap());
    let contract = IOnChainProof::new(addr, provider);

    // zero proofHash must revert
    let result = contract
        .anchor(1, FixedBytes::from([0x01; 32]), FixedBytes::ZERO)
        .send()
        .await;
    assert!(result.is_err(), "zero proofHash must revert");

    // ANONYMOUS scheme (0x00) requires agentId == 0
    let result = contract
        .anchor(0, FixedBytes::from([0x01; 32]), FixedBytes::from([0x01; 32]))
        .send()
        .await;
    assert!(
        result.is_err(),
        "ANONYMOUS with non-zero agentId must revert"
    );

    // schemes 0x03+ are reserved
    let result = contract
        .anchor(3, FixedBytes::ZERO, FixedBytes::from([0x01; 32]))
        .send()
        .await;
    assert!(result.is_err(), "reserved scheme must revert");
}
