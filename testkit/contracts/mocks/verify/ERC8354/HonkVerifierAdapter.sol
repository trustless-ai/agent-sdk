// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.20;

import {IVerifier} from "./IVerifier.sol";
import {Verdict} from "./IConfidentialPolicyVerdict.sol";
import {HonkVerifier, VK_HASH} from "./HonkVerifier.sol";

/// @notice Minimal view of the bb-generated UltraHonk verifier.
interface IHonkVerifier {
    function verify(bytes calldata proof, bytes32[] calldata publicInputs) external view returns (bool);
}

/// @notice Adapts the Noir/UltraHonk allowlist verifier to the ERC's `IVerifier`. It serializes the
/// Verdict fields that are the circuit's public inputs and calls the generated Honk verifier.
///
/// The circuit's public inputs, in `main()` order, are 39 elements:
///   [0] agentId, [1] domainId, [2] policyRoot, [3..34] the 32 bytes of actionCommitment
///   (each byte as a field element), [35] nullifier, [36] decision, [37] policyKind, [38] executor.
/// `executor` is a committed circuit input (the proof binds to it, per the spec's Security
/// Considerations). `policyKind` is committed too, so the four-state taxonomy cannot be asserted
/// at the boundary without the proof having established it. `expiry` is NOT a circuit input — the
/// Guard enforces it on-chain. All three circuits (allowlist ALLOW, denylist, allowlist
/// non-membership) share this layout; only the constant each asserts for `policyKind` differs.
///
/// SECURITY (2026-08-29, real gap found and reproduced independently -- see
/// test/verify/ERC8354/ConsumeRealRepro.t.sol): `expiry` is not a circuit public input at all
/// (the Guard's on-chain freshness check confirms a *caller-supplied* expiry hasn't lapsed, but
/// never proves the circuit authorized THAT specific expiry -- the same fixture proof verifies
/// under any expiry value). Closing this requires the upstream Noir circuit
/// (zexoverz/confidential-agent-policy-verdicts, see PROVENANCE.md) to add expiry as a public
/// input, regenerate the verifying key, and reissue this adapter's vendored verifier + fixture --
/// none of which is buildable inside this repo alone. Flagged upstream; not fixed here.
contract HonkVerifierAdapter is IVerifier {
    IHonkVerifier public immutable honk;

    /// @notice The program key this specific adapter instance is bound to. Derived from the
    /// vendored circuit's own `VK_HASH` constant (HonkVerifier.sol), not an independent
    /// constructor-supplied label -- so the key is cryptographically tied to which verifying key
    /// this adapter actually wraps, and cannot be set to a value disconnected from the real
    /// verifier. `honk` is constructed INSIDE this constructor (not injected) for the same reason:
    /// the only way to change which verifier an adapter uses is to deploy a new adapter, which by
    /// construction also gets that new verifier's own `VK_HASH`-derived key -- the two can never
    /// drift apart. A domain's registered `programKey` (PolicyDomainRegistry.Domain.programKey)
    /// must match this value for a proof to verify. Real program rotation (deploying a new circuit
    /// and pointing a domain at it) means deploying a fresh adapter and calling
    /// `PolicyDomainRegistry.rotateVerifier` to atomically update BOTH the domain's `verifier`
    /// address and `programKey` together -- updating only `programKey` (the older
    /// `updateProgram`) leaves the domain pointed at an adapter whose own key no longer matches,
    /// which is intentionally fail-closed rather than a rotation mechanism.
    bytes32 public immutable expectedProgramKey;

    constructor() {
        honk = IHonkVerifier(address(new HonkVerifier()));
        expectedProgramKey = bytes32(VK_HASH);
    }

    /// @param programKey the domain's currently-registered program key (PolicyDomainRegistry).
    /// @param publicInputs abi.encode(Verdict) as passed by the Guard.
    function verifyProof(
        bytes32 programKey,
        bytes calldata publicInputs,
        bytes calldata proof
    )
        external
        view
        returns (bool)
    {
        // Mirrors the Guard's own "malformed proof returns false, never reverts" contract --
        // a domain pointed at the wrong adapter is the same class of caller error as a
        // malformed proof, not a distinct revert path.
        if (programKey != expectedProgramKey) return false;
        Verdict memory v = abi.decode(publicInputs, (Verdict));
        return honk.verify(proof, _toPublicInputs(v));
    }

    /// @notice The 39-element public-input vector the circuit expects, from a Verdict.
    function _toPublicInputs(Verdict memory v) internal pure returns (bytes32[] memory pi) {
        pi = new bytes32[](39);
        pi[0] = bytes32(v.agentId);
        pi[1] = v.domainId;
        pi[2] = v.policyRoot;
        for (uint256 i = 0; i < 32; i++) {
            pi[3 + i] = bytes32(uint256(uint8(v.actionCommitment[i])));
        }
        pi[35] = v.nullifier;
        pi[36] = bytes32(uint256(v.decision));
        pi[37] = bytes32(uint256(v.policyKind));
        pi[38] = bytes32(uint256(uint160(v.executor)));
    }
}
