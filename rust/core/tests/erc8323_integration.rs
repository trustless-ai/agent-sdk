#![cfg(feature = "std")]
/// ERC-8323 integration tests — testkit workflow.
use alloy::primitives::Address;
use alloy::providers::ProviderBuilder;
use alloy::sol;

sol! {
    #[allow(missing_docs)]
    #[sol(rpc)]
    interface IAgentSourceBinding {
        function boundCollection() external view returns (address);
        function getSourceNFT(uint256 agentId) external view returns (address, uint256);
        function hasSourceNFT(uint256 agentId) external view returns (bool);
        function isSourceNFTOwnershipValid(uint256 agentId) external view returns (bool);
        function register(uint256 sourceTokenId) external returns (uint256 agentId);
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
    // DeployERC8323 deploys two contracts and the suites read both from this one
    // variable, in broadcast order: [0] the dummy collection, [1] the binding
    // registry (see go/test/erc8323_integration_test.go, which documents the
    // same ordering). This test constructs IAgentSourceBinding, so it wants the
    // binding registry -- the LAST address, not the whole string.
    std::env::var("ERC8323_ADDRESS")
        .unwrap_or_default()
        .split_whitespace()
        .last()
        .unwrap_or_default()
        .parse()
        .unwrap_or(Address::ZERO)
}

#[tokio::test]
async fn bound_collection_reads() {
    let addr = contract_address();
    assert!(
        !addr.is_zero(),
        "ERC8323_ADDRESS not set — deploy first via testkit/scripts/deploy.sh"
    );

    let key = anvil_key();
    let signer: alloy::signers::local::PrivateKeySigner = key.parse().expect("invalid key");
    let provider = ProviderBuilder::new()
        .wallet(signer)
        .connect_http(ANVIL_RPC.parse().unwrap());

    let contract = IAgentSourceBinding::new(addr, provider);
    let collection = contract
        .boundCollection()
        .call()
        .await
        .expect("boundCollection");
    eprintln!("boundCollection = {collection:?}");
}
