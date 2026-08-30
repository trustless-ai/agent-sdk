// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Test} from "forge-std/Test.sol";
import {ConfidentialPolicyVerdict} from "../../../contracts/mocks/verify/ERC8354/ConfidentialPolicyVerdict.sol";
import {PolicyDomainRegistry} from "../../../contracts/mocks/verify/ERC8354/PolicyDomainRegistry.sol";
import {Verdict, PolicyKind} from "../../../contracts/mocks/verify/ERC8354/IConfidentialPolicyVerdict.sol";
import {HonkVerifierAdapter} from "../../../contracts/mocks/verify/ERC8354/HonkVerifierAdapter.sol";
import {StrictKeyedTestVerifier} from "../../../contracts/mocks/verify/ERC8354/StrictKeyedTestVerifier.sol";

/// @notice Reproduction + regression coverage for Jimmy Shi's findings on PR #25 and PR #26
/// (trustless-ai/agent-sdk, comments 2026-08-29T17:33:12Z and 2026-08-30T08:03:39-07:00). Every
/// positive/negative control below is exercised with the real fixture proof or a real registry
/// call, no mocks standing in for the boundary under test.
///
/// programKey (PR #25 finding 3, PR #26 5-point follow-up): FIXED and hardened. The adapter now
/// derives its programKey from the vendored circuit's own VK_HASH (no independent
/// constructor-supplied label to duplicate or drift), PolicyDomainRegistry gained a genuine atomic
/// `rotateVerifier` alongside the existing (intentionally fail-closed) `updateProgram`, and the
/// mismatch regression is now load-bearing at the adapter's own boundary, not only through the
/// full Guard/registry integration path.
///
/// expiry (PR #25 finding 2): NOT fixed here, and can't be from inside this repo -- `expiry` was
/// never a circuit public input (see HonkVerifierAdapter's own doc comment and PROVENANCE.md), so
/// no Solidity-level change can bind it without the upstream Noir circuit
/// (zexoverz/confidential-agent-policy-verdicts, issue #3 filed) adding it as one and this repo
/// regenerating its vendored verifier + fixture against the new circuit. Kept as a named,
/// currently-green characterization test documenting the CURRENT (insecure) behavior, so CI keeps
/// surfacing the gap in the test list rather than it silently disappearing -- if this test ever
/// starts failing, that means expiry IS bound now and the test (and this doc comment) need
/// updating to match, not that something broke.
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

    function setUp() public {
        vm.warp(1_700_000_000);
        registry = new PolicyDomainRegistry();
        adapter = new HonkVerifierAdapter();
        guard = new ConfidentialPolicyVerdict(registry);
        registry.registerDomain(DOMAIN, address(0xA11CE), address(adapter), adapter.expectedProgramKey(), 1 hours);
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

    /// @notice The actual fix, proven through the full Guard path: rotating the domain's
    /// registered program key away from what this adapter was deployed for now correctly REJECTS
    /// the same fixture proof, where before the fix it silently kept accepting it. This is
    /// deliberately the fail-closed case (updateProgram alone, verifier left stale) -- see
    /// test_FIXED_RotationToNewVerifierAndKeyAccepted below for the genuine-rotation counterpart.
    function test_FIXED_RotatedProgramKeyNowRejects() public {
        bytes memory proof = vm.readFileBinary(PROOF_PATH);
        Verdict memory v = _verdict();
        assertTrue(guard.verify(v, proof), "sanity: original verdict should verify");

        registry.updateProgram(DOMAIN, keccak256("a-completely-different-program"));

        assertFalse(guard.verify(v, proof), "programKey mismatch must now reject, not silently accept");
    }

    /// @notice Deploy-time negative control: a verifier bound to one program key must reject a
    /// domain registered under a different one, independent of any rotation event. Uses
    /// StrictKeyedTestVerifier rather than a second HonkVerifierAdapter -- the adapter no longer
    /// accepts an arbitrary key (that was the whole point of the fix), so the general "any IVerifier
    /// whose own key doesn't match what's registered must reject" boundary is exercised with a
    /// verifier built specifically to make that key check controllable in a test.
    function test_FIXED_MismatchedProgramKeyAtDeployRejects() public {
        StrictKeyedTestVerifier wrongVerifier = new StrictKeyedTestVerifier(keccak256("some-other-program"));
        registry.registerDomain(
            bytes32(uint256(43)), address(0xA11CE), address(wrongVerifier), adapter.expectedProgramKey(), 1 hours
        );
        registry.updateRoot(bytes32(uint256(43)), POLICY_ROOT);

        Verdict memory v = _verdict();
        v.domainId = bytes32(uint256(43));
        bytes memory proof = vm.readFileBinary(PROOF_PATH);
        assertFalse(guard.verify(v, proof), "verifier bound to a different program must reject");
    }

    /// @notice PR #26 point 3, load-bearing regression: the mismatch check exercised as a DIRECT
    /// call to the adapter's own verifyProof, with the real Verdict and real proof held completely
    /// unchanged and ONLY the programKey argument varied. This proves the check lives in the
    /// adapter itself (not merely as an emergent property of how the Guard happens to call it) --
    /// the positive case passes, the wrong-key case fails, and removing the `if (programKey !=
    /// expectedProgramKey) return false;` line in HonkVerifierAdapter would make this test fail.
    function test_FIXED_DirectAdapterCall_MatchingProgramKeyAccepts() public view {
        bytes memory proof = vm.readFileBinary(PROOF_PATH);
        bytes memory encodedVerdict = abi.encode(_verdict());
        assertTrue(adapter.verifyProof(adapter.expectedProgramKey(), encodedVerdict, proof));
    }

    function test_FIXED_DirectAdapterCall_WrongProgramKeyRejects() public view {
        bytes memory proof = vm.readFileBinary(PROOF_PATH);
        bytes memory encodedVerdict = abi.encode(_verdict());
        assertFalse(adapter.verifyProof(keccak256("wrong-key"), encodedVerdict, proof));
    }

    /// @notice PR #26 point 2: rotation must be genuinely usable, not only fail-closed.
    /// `rotateVerifier` atomically swaps the domain to a new verifier AND a matching new
    /// programKey together -- prove both halves: the OLD adapter+old-key path (superseded, not
    /// re-tested here since test_FIXED_RotatedProgramKeyNowRejects already covers the stale-verifier
    /// case) is not what's registered anymore, and the NEW verifier+key pair, once rotated in,
    /// genuinely accepts. Uses StrictKeyedTestVerifier for the new leg per Jimmy's own guidance --
    /// no need to vendor a second real UltraHonk circuit fixture just to prove the registry
    /// plumbing routes correctly.
    function test_FIXED_RotationToNewVerifierAndKeyAccepted() public {
        bytes32 newKey = keccak256("erc8354-rotated-program-v1");
        StrictKeyedTestVerifier newVerifier = new StrictKeyedTestVerifier(newKey);

        registry.rotateVerifier(DOMAIN, address(newVerifier), newKey);

        Verdict memory v = _verdict();
        // StrictKeyedTestVerifier doesn't check the proof/publicInputs bytes at all (it isn't a
        // real circuit) -- any non-empty proof exercises the real registry+Guard routing path to
        // the newly-rotated verifier, which is what this test is actually proving.
        assertTrue(guard.verify(v, hex"00"), "rotated verifier+key must accept once genuinely routed to");
    }

    /// @notice The mirror of the above: rotating to a new verifier+key does NOT accept a proof
    /// meant for a different key, proving rotateVerifier's key check is real, not a no-op.
    function test_FIXED_RotationToNewVerifierAndKeyStillRejectsWrongKey() public {
        StrictKeyedTestVerifier newVerifier = new StrictKeyedTestVerifier(keccak256("erc8354-rotated-program-v1"));
        registry.rotateVerifier(DOMAIN, address(newVerifier), keccak256("a-key-nobody-rotated-to"));

        Verdict memory v = _verdict();
        assertFalse(guard.verify(v, hex"00"), "rotated-in verifier must still reject a non-matching registered key");
    }
}
