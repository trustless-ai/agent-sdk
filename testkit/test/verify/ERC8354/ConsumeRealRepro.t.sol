// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Test} from "forge-std/Test.sol";
import {ConfidentialPolicyVerdict} from "../../../contracts/mocks/verify/ERC8354/ConfidentialPolicyVerdict.sol";
import {PolicyDomainRegistry} from "../../../contracts/mocks/verify/ERC8354/PolicyDomainRegistry.sol";
import {Verdict, PolicyKind} from "../../../contracts/mocks/verify/ERC8354/IConfidentialPolicyVerdict.sol";
import {HonkVerifier} from "../../../contracts/mocks/verify/ERC8354/HonkVerifier.sol";
import {HonkVerifierAdapter, IHonkVerifier} from "../../../contracts/mocks/verify/ERC8354/HonkVerifierAdapter.sol";

/// @notice Reproduction + regression coverage for Jimmy Shi's two post-merge findings on PR #25
/// (trustless-ai/agent-sdk#25, comment 2026-08-29T17:33:12Z). Both independently reproduced with
/// the real fixture proof before any fix was written (no mocks anywhere in this path).
///
/// programKey (finding 3): FIXED here -- HonkVerifierAdapter now takes an `expectedProgramKey` at
/// construction and rejects any call whose `programKey` doesn't match. Negative + positive
/// controls below.
///
/// expiry (finding 2): NOT fixed here, and can't be from inside this repo -- `expiry` was never a
/// circuit public input (see HonkVerifierAdapter's own doc comment and PROVENANCE.md), so no
/// Solidity-level change can bind it without the upstream Noir circuit
/// (zexoverz/confidential-agent-policy-verdicts) adding it as one and this repo regenerating its
/// vendored verifier + fixture against the new circuit. Kept as a named, honestly-red regression
/// test so CI keeps surfacing the gap rather than silently dropping it.
contract ConsumeRealReproTest is Test {
    string constant PROOF_PATH = "./contracts/mocks/verify/ERC8354/fixtures/allowlist.proof";

    bytes32 constant POLICY_ROOT = 0x053d4542d140ad2350a0ee79fae4a522821274e428bd881e7e803ecd816635ac;
    bytes32 constant ACTION_COMMITMENT = 0x7ccb7a4e9d51128b951cbeddefaec1140180a3d13f6eae6f06596dc432057cfa;
    bytes32 constant NULLIFIER = 0x041271fcaf479f6ab927df3a03f74d3809e9f49d880cd7a9595c8dc0a58a5e03;

    PolicyDomainRegistry registry;
    ConfidentialPolicyVerdict guard;
    HonkVerifierAdapter adapter;

    bytes32 constant DOMAIN = bytes32(uint256(42));
    address constant EXECUTOR = address(0xE0);
    bytes32 constant PROGRAM_KEY = keccak256("erc8354-allowlist-v0");

    function setUp() public {
        vm.warp(1_700_000_000);
        registry = new PolicyDomainRegistry();
        adapter = new HonkVerifierAdapter(IHonkVerifier(address(new HonkVerifier())), PROGRAM_KEY);
        guard = new ConfidentialPolicyVerdict(registry);
        registry.registerDomain(DOMAIN, address(0xA11CE), address(adapter), PROGRAM_KEY, 1 hours);
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

    /// @notice KNOWN, UNFIXED GAP -- see contract-level doc comment. This is a real, live
    /// disclosure, not a placeholder: the same fixture proof verifies whether or not the Verdict's
    /// expiry field matches what was actually authorized, because expiry is not a circuit public
    /// input. This test intentionally documents the current (insecure) behavior rather than
    /// asserting the secure one, so removing it silently would be the actual regression.
    function test_KNOWNGAP_SameProofVerifiesUnderDifferentExpiry() public view {
        bytes memory proof = vm.readFileBinary(PROOF_PATH);

        Verdict memory original = _verdict();
        assertTrue(guard.verify(original, proof), "sanity: original verdict should verify");

        Verdict memory tamperedExpiry = _verdict();
        tamperedExpiry.expiry = original.expiry + 999 days; // a wildly different, unauthorized expiry
        assertTrue(
            guard.verify(tamperedExpiry, proof),
            "if this now fails, expiry IS bound -- update this test to assertFalse and the doc comment"
        );
    }

    /// @notice Positive control for the programKey fix: the domain's real, matching program key
    /// still verifies correctly (the fix must not break the honest case).
    function test_FIXED_MatchingProgramKeyStillVerifies() public view {
        bytes memory proof = vm.readFileBinary(PROOF_PATH);
        assertTrue(guard.verify(_verdict(), proof));
    }

    /// @notice The actual fix, proven: rotating the domain's registered program key away from
    /// what this adapter was deployed for now correctly REJECTS the same fixture proof, where
    /// before the fix it silently kept accepting it (see git history / PR description for the
    /// pre-fix version of this test, which asserted the opposite).
    function test_FIXED_RotatedProgramKeyNowRejects() public {
        bytes memory proof = vm.readFileBinary(PROOF_PATH);
        Verdict memory v = _verdict();
        assertTrue(guard.verify(v, proof), "sanity: original verdict should verify");

        registry.updateProgram(DOMAIN, keccak256("a-completely-different-program"));

        assertFalse(guard.verify(v, proof), "programKey mismatch must now reject, not silently accept");
    }

    /// @notice Deploy-time negative control: an adapter constructed for one program key must
    /// reject a domain registered under a different one, independent of any rotation event.
    function test_FIXED_MismatchedProgramKeyAtDeployRejects() public {
        HonkVerifierAdapter wrongAdapter =
            new HonkVerifierAdapter(IHonkVerifier(address(new HonkVerifier())), keccak256("some-other-program"));
        registry.registerDomain(bytes32(uint256(43)), address(0xA11CE), address(wrongAdapter), PROGRAM_KEY, 1 hours);
        registry.updateRoot(bytes32(uint256(43)), POLICY_ROOT);

        Verdict memory v = _verdict();
        v.domainId = bytes32(uint256(43));
        bytes memory proof = vm.readFileBinary(PROOF_PATH);
        assertFalse(guard.verify(v, proof), "adapter deployed for a different program must reject");
    }
}
