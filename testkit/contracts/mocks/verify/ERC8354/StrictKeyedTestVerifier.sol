// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.20;

import {IVerifier} from "./IVerifier.sol";

/// @notice Test-only IVerifier that actually checks `programKey`, unlike MockVerifier (which
/// ignores it entirely). Built specifically to exercise PolicyDomainRegistry.rotateVerifier's
/// registry-plumbing without vendoring a second real UltraHonk circuit fixture -- the rotation
/// regression only needs to prove that swapping BOTH verifier and programKey together routes to a
/// verifier that genuinely cares which key it was called with, not a real second proof.
contract StrictKeyedTestVerifier is IVerifier {
    bytes32 public immutable expectedProgramKey;
    bool public result = true;

    constructor(bytes32 _expectedProgramKey) {
        expectedProgramKey = _expectedProgramKey;
    }

    function setResult(bool r) external {
        result = r;
    }

    function verifyProof(bytes32 programKey, bytes calldata, bytes calldata) external view returns (bool) {
        if (programKey != expectedProgramKey) return false;
        return result;
    }
}
