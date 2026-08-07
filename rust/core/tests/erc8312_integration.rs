#![cfg(feature = "std")]
/// ERC-8312 integration tests — testkit workflow.
///
/// Deploy order: boundedAgentAction, budgetSubstrate, contestableEnvelope
/// (3 addresses). Use ERC8312_ADDRESSES env var: comma-separated in deploy
/// order.
use alloy::primitives::{Address, FixedBytes};
use alloy::providers::ProviderBuilder;
use alloy::sol;

sol! {
    #[allow(missing_docs)]
    #[sol(rpc)]
    interface IBoundedAgentAction {
        event EnvelopeRegistered(bytes32 indexed id, address indexed principal, bytes32 indexed capabilityRoot);
        event EnvelopeAdvanced(bytes32 indexed id, bytes32 prevCursor, bytes32 newCursor);
        event EnvelopeStatusChanged(bytes32 indexed id, uint8 fromStatus, uint8 toStatus);

        function registerEnvelope(address principal, bytes32 capabilityRoot, uint64 expiresAt, bytes initData) external returns (bytes32);
        function advanceCursor(bytes32 id, bytes witness) external returns (bytes32);
        function setStatus(bytes32 id, uint8 newStatus) external;
        function getEnvelope(bytes32 id) external view returns (bytes32 id_, address principal, bytes32 capabilityRoot, bytes32 cursorRoot, uint64 createdAt, uint64 expiresAt, uint8 status);
        function getCursor(bytes32 id) external view returns (bytes32);
        function getStatus(bytes32 id) external view returns (uint8);
        function isActive(bytes32 id) external view returns (bool);
    }

    #[allow(missing_docs)]
    #[sol(rpc)]
    interface IBudgetSubstrate {
        function bound(bytes32 id) external view returns (uint256 cap, address asset);
        function spent(bytes32 id) external view returns (uint256);
        function remaining(bytes32 id) external view returns (uint256);
    }

    #[allow(missing_docs)]
    #[sol(rpc)]
    interface IContestableEnvelope {
        event EnvelopeContested(bytes32 indexed id, address indexed challenger);
        event EnvelopeResolved(bytes32 indexed id, uint8 outcome);

        function contest(bytes32 id, bytes evidence) external;
        function resolve(bytes32 id, uint8 outcome, bytes resolution) external;
    }
}

const ANVIL_RPC: &str = "http://127.0.0.1:8545";

fn anvil_key() -> String {
    if let Ok(key) = std::env::var("ANVIL_KEY") {
        return key;
    }
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../testkit/.anvil-accounts.json");
    let data = std::fs::read_to_string(&path).expect("cannot read anvil accounts file");
    let parsed: serde_json::Value = serde_json::from_str(&data).expect("invalid JSON");
    parsed["accounts"][0]["privateKey"]
        .as_str()
        .expect("no account")
        .to_string()
}

fn addresses() -> Vec<Address> {
    std::env::var("ERC8312_ADDRESSES")
        .unwrap_or_default()
        .split_whitespace()
        .filter(|s| !s.is_empty())
        .map(|s| s.parse().expect("invalid address"))
        .collect()
}

fn deploy_addresses() -> Vec<Address> {
    let output = std::process::Command::new("sh")
        .arg("-c")
        .arg(format!(
            "cd {} && ./scripts/deploy.sh metering/ERC8312 DeployERC8312",
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../testkit")
                .display()
        ))
        .output()
        .expect("deploy failed");
    assert!(output.status.success(), "deploy.sh failed");
    String::from_utf8_lossy(&output.stdout)
        .trim()
        .split_whitespace()
        .filter(|s| !s.is_empty())
        .map(|s| s.parse().expect("invalid address"))
        .collect()
}

fn ids_from_deploy() -> Vec<Address> {
    let addrs = addresses();
    if addrs.len() >= 3 {
        addrs
    } else {
        deploy_addresses()
    }
}

fn extract_envelope_id(receipt: &alloy::rpc::types::TransactionReceipt) -> FixedBytes<32> {
    // Parse the first log as EnvelopeRegistered event
    for log in receipt.logs() {
        // EnvelopeRegistered signature: keccak256("EnvelopeRegistered(bytes32,address,bytes32)")
        let sig = alloy::primitives::keccak256(b"EnvelopeRegistered(bytes32,address,bytes32)");
        if log.topics().len() >= 2 && log.topics()[0] == sig {
            // First indexed param (id) is in topics[1]
            return FixedBytes::from(log.topics()[1]);
        }
    }
    FixedBytes::ZERO
}

#[tokio::test]
async fn bounded_agent_action_lifecycle() {
    let addrs = ids_from_deploy();
    let signer: alloy::signers::local::PrivateKeySigner = anvil_key().parse().expect("invalid key");
    let provider = ProviderBuilder::new()
        .wallet(signer.clone())
        .connect_http(ANVIL_RPC.parse().unwrap());

    let bounded = IBoundedAgentAction::new(addrs[0], &provider);

    let cap_root = alloy::primitives::keccak256(b"my-capability");
    let expires_at: u64 = 2000000000;

    // registerEnvelope
    let tx = bounded
        .registerEnvelope(signer.address(), cap_root, expires_at, vec![].into())
        .send()
        .await
        .expect("registerEnvelope");
    let receipt = tx.get_receipt().await.expect("receipt");
    assert!(receipt.status(), "registerEnvelope reverted");

    let id = extract_envelope_id(&receipt);
    assert_ne!(id, FixedBytes::ZERO, "envelope id should not be zero");

    // Read envelope
    let env = bounded.getEnvelope(id).call().await.expect("getEnvelope");
    assert_eq!(env.principal, signer.address());
    assert_eq!(env.capabilityRoot, cap_root);
    assert_eq!(env.status, 1); // Active

    // isActive
    assert!(bounded.isActive(id).call().await.expect("isActive"));

    // advanceCursor
    let advance = bounded.advanceCursor(id, b"witness-data".to_vec().into());
    let advance_receipt = advance.send().await.expect("advanceCursor").get_receipt().await.expect("receipt");
    assert!(advance_receipt.status(), "advanceCursor reverted");

    // setStatus to Completed
    let status_tx = bounded.setStatus(id, 2);
    let status_receipt = status_tx.send().await.expect("setStatus").get_receipt().await.expect("receipt");
    assert!(status_receipt.status(), "setStatus reverted");

    let status: u8 = bounded.getStatus(id).call().await.expect("getStatus");
    assert_eq!(status, 2);

    assert!(!bounded.isActive(id).call().await.expect("isActive after complete"));

    eprintln!("boundedAgentAction lifecycle test complete: {} tests passed", 1);
}

#[tokio::test]
async fn budget_substrate_views() {
    let addrs = ids_from_deploy();
    let signer: alloy::signers::local::PrivateKeySigner = anvil_key().parse().expect("invalid key");
    let provider = ProviderBuilder::new()
        .wallet(signer.clone())
        .connect_http(ANVIL_RPC.parse().unwrap());

    // Register on the budget contract itself (it implements IBoundedAgentAction)
    let budget_action = IBoundedAgentAction::new(addrs[1], &provider);
    let budget = IBudgetSubstrate::new(addrs[1], &provider);

    let cap_root = alloy::primitives::keccak256(b"budget-test");
    let expires_at: u64 = 2000000000;

    let tx = budget_action
        .registerEnvelope(signer.address(), cap_root, expires_at, vec![].into())
        .send()
        .await
        .expect("registerEnvelope");
    let receipt = tx.get_receipt().await.expect("receipt");
    assert!(receipt.status(), "registerEnvelope reverted");

    let id = extract_envelope_id(&receipt);
    assert_ne!(id, FixedBytes::ZERO, "envelope id should not be zero");

    // bound
    let bound_result = budget.bound(id).call().await.expect("bound");
    assert!(bound_result.cap > alloy::primitives::U256::ZERO);
    assert_ne!(bound_result.asset, Address::ZERO);

    // spent
    let spent: alloy::primitives::U256 = budget.spent(id).call().await.expect("spent");
    assert_eq!(spent, alloy::primitives::U256::ZERO);

    // remaining
    let remaining: alloy::primitives::U256 = budget.remaining(id).call().await.expect("remaining");
    assert_eq!(remaining, bound_result.cap);

    eprintln!("budgetSubstrate views test complete");
}

#[tokio::test]
async fn contestable_envelope_contest_resolve() {
    let addrs = ids_from_deploy();
    let signer: alloy::signers::local::PrivateKeySigner = anvil_key().parse().expect("invalid key");
    let provider = ProviderBuilder::new()
        .wallet(signer.clone())
        .connect_http(ANVIL_RPC.parse().unwrap());

    let contestable_action = IBoundedAgentAction::new(addrs[2], &provider);
    let contestable = IContestableEnvelope::new(addrs[2], &provider);

    let cap_root = alloy::primitives::keccak256(b"contest-test");
    let expires_at: u64 = 2000000000;

    // Register
    let tx = contestable_action
        .registerEnvelope(signer.address(), cap_root, expires_at, vec![].into())
        .send()
        .await
        .expect("registerEnvelope");
    let receipt = tx.get_receipt().await.expect("receipt");
    assert!(receipt.status(), "registerEnvelope reverted");

    let id = extract_envelope_id(&receipt);
    assert_ne!(id, FixedBytes::ZERO, "envelope id should not be zero");

    // Contest
    let contest_tx = contestable.contest(id, b"evidence".to_vec().into());
    let contest_receipt = contest_tx.send().await.expect("contest").get_receipt().await.expect("receipt");
    assert!(contest_receipt.status(), "contest reverted");

    // Check status is Contested (3)
    let status: u8 = contestable_action.getStatus(id).call().await.expect("getStatus");
    assert_eq!(status, 3);

    // Resolve back to Active (1)
    let resolve_tx = contestable.resolve(id, 1, b"resolution".to_vec().into());
    let resolve_receipt = resolve_tx.send().await.expect("resolve").get_receipt().await.expect("receipt");
    assert!(resolve_receipt.status(), "resolve reverted");

    // Check status is Active (1)
    let status2: u8 = contestable_action.getStatus(id).call().await.expect("getStatus after resolve");
    assert_eq!(status2, 1);

    eprintln!("contestableEnvelope contest/resolve test complete");
}
