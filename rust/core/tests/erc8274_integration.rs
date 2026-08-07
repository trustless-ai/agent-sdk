#![cfg(feature = "std")]
/// ERC-8274 integration tests — testkit workflow.
///
/// Deploy order: proofVerifier, agentVerifier, agentVerifiable (3 addresses).
/// Use ERC8274_ADDRESSES env var: comma-separated in deploy order.
use alloy::primitives::{Address, FixedBytes};
use alloy::providers::ProviderBuilder;
use alloy::sol;

sol! {
    #[allow(missing_docs)]
    #[sol(rpc)]
    interface IProofVerifier {
        function verify(bytes32 inputHash, bytes32 outputHash, bytes metadata, bytes proof) external view returns (bool);
        function proofSystem() external view returns (string);
    }

    #[allow(missing_docs)]
    #[sol(rpc)]
    interface IAgentVerifier {
        function verify(bytes32 taskId, bytes32 agentId, bytes32 inputHash, bytes32 outputHash, bytes proof) external returns (bool);
    }

    #[allow(missing_docs)]
    #[sol(rpc)]
    interface IAgentVerifiable {
        function agentVerifier() external view returns (address);
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

fn addresses() -> Vec<Address> {
    std::env::var("ERC8274_ADDRESSES")
        .unwrap_or_default()
        .split_whitespace()
        .filter(|s| !s.is_empty())
        .map(|s| s.parse().expect("invalid address"))
        .collect()
}

#[tokio::test]
async fn proof_system_and_verify() {
    let addrs = addresses();
    assert!(
        addrs.len() >= 3,
        "ERC8274_ADDRESSES not set (needs 3 addresses) — deploy first via testkit/scripts/deploy.sh"
    );

    let key = anvil_key();
    let signer: alloy::signers::local::PrivateKeySigner = key.parse().expect("invalid key");
    let provider = ProviderBuilder::new()
        .wallet(signer)
        .connect_http(ANVIL_RPC.parse().unwrap());

    let proof = IProofVerifier::new(addrs[0], provider.clone());
    let agent = IAgentVerifier::new(addrs[1], provider.clone());
    let verifiable = IAgentVerifiable::new(addrs[2], provider);

    // ProofVerifier
    let system = proof.proofSystem().call().await.expect("proofSystem");
    eprintln!("proofSystem = {system}");

    // AgentVerifiable
    let trusted = verifiable
        .agentVerifier()
        .call()
        .await
        .expect("agentVerifier");
    eprintln!("agentVerifier = {trusted:?}");

    // AgentVerifier (broadcast)
    let tx = agent.verify(
        FixedBytes::ZERO,
        FixedBytes::ZERO,
        FixedBytes::ZERO,
        FixedBytes::ZERO,
        vec![].into(),
    );
    let receipt = tx
        .send()
        .await
        .expect("verify")
        .get_receipt()
        .await
        .expect("receipt");
    eprintln!("agent verify tx: {:?}", receipt.transaction_hash);
}
