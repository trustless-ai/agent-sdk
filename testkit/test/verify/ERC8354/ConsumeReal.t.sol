// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Test} from "forge-std/Test.sol";
import {ConfidentialPolicyVerdict} from "../../../contracts/mocks/verify/ERC8354/ConfidentialPolicyVerdict.sol";
import {PolicyDomainRegistry} from "../../../contracts/mocks/verify/ERC8354/PolicyDomainRegistry.sol";
import {Verdict, PolicyKind} from "../../../contracts/mocks/verify/ERC8354/IConfidentialPolicyVerdict.sol";
import {HonkVerifier} from "../../../contracts/mocks/verify/ERC8354/HonkVerifier.sol";
import {HonkVerifierAdapter, IHonkVerifier} from "../../../contracts/mocks/verify/ERC8354/HonkVerifierAdapter.sol";

/// @notice The no-mock counterpart to ConfidentialPolicyVerdict.t.sol. Every other test in this
/// directory drives the verifier boundary with MockVerifier's settable boolean, which proves the
/// Guard delegates to IVerifier correctly but never exercises a real proof. Here the Guard's own
/// consume runs its full check order with the proof step verifying a genuine UltraHonk proof
/// through the bb-generated verifier, so nothing in the path is mocked.
///
/// The Verdict values are not free parameters: the fixture proof is only valid for this exact set
/// of public inputs, so they are carried over unchanged from the reference implementation's own
/// ConsumeReal test.
contract ConsumeRealTest is Test {
    string constant PROOF_PATH = "./contracts/mocks/verify/ERC8354/fixtures/allowlist.proof";

    bytes32 constant POLICY_ROOT = 0x053d4542d140ad2350a0ee79fae4a522821274e428bd881e7e803ecd816635ac;
    bytes32 constant ACTION_COMMITMENT = 0x7ccb7a4e9d51128b951cbeddefaec1140180a3d13f6eae6f06596dc432057cfa;
    bytes32 constant NULLIFIER = 0x041271fcaf479f6ab927df3a03f74d3809e9f49d880cd7a9595c8dc0a58a5e03;

    PolicyDomainRegistry registry;
    ConfidentialPolicyVerdict guard;
    HonkVerifierAdapter adapter;

    bytes32 constant DOMAIN = bytes32(uint256(42));
    address constant EXECUTOR = address(0xE0);

    function setUp() public {
        vm.warp(1_700_000_000);
        registry = new PolicyDomainRegistry();
        adapter = new HonkVerifierAdapter(IHonkVerifier(address(new HonkVerifier())));
        guard = new ConfidentialPolicyVerdict(registry);
        registry.registerDomain(DOMAIN, address(0xA11CE), address(adapter), bytes32(0), 1 hours);
        registry.updateRoot(DOMAIN, POLICY_ROOT);
    }

    function _verdict() internal view returns (Verdict memory) {
        return Verdict({
            agentId: 7,
            domainId: DOMAIN,
            policyRoot: POLICY_ROOT,
            actionCommitment: ACTION_COMMITMENT,
            executor: EXECUTOR,
            expiry: uint64(block.timestamp + 1 hours),
            nullifier: NULLIFIER,
            decision: 1,
            policyKind: PolicyKind.ALLOWED
        });
    }

    function test_VerifyWithRealProof() public view {
        assertTrue(guard.verify(_verdict(), vm.readFileBinary(PROOF_PATH)));
    }

    function test_ConsumeWithRealProof() public {
        Verdict memory v = _verdict();
        vm.prank(EXECUTOR);
        guard.consume(v, vm.readFileBinary(PROOF_PATH));
        assertTrue(guard.isConsumed(DOMAIN, v.nullifier));
    }

    /// @notice A tampered proof must fail cryptographically, not merely because a mock was told to
    /// return false. This is the assurance MockVerifier cannot give.
    function test_VerifyFalseOnTamperedProof() public view {
        bytes memory proof = vm.readFileBinary(PROOF_PATH);
        proof[proof.length - 1] = bytes1(uint8(proof[proof.length - 1]) ^ 0x01);
        assertFalse(guard.verify(_verdict(), proof));
    }
}
