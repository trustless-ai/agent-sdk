import { beforeAll, describe, expect, it } from 'vitest'
import { encodeAbiParameters, encodePacked, keccak256, toHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { ProofVerifierClient } from '../../../src/verify/ERC8274/proofVerifierClient.js'
import { AgentVerifierClient } from '../../../src/verify/ERC8274/agentVerifierClient.js'
import { getTrustedVerifier } from '../../../src/verify/ERC8274/agentVerifiable.js'
import { ANVIL_RPC_URL, deployContracts, getAnvilAccount } from '../../setup/deploy.js'

describe('ERC-8274 verify clients', () => {
  let proofVerifierClient: ProofVerifierClient
  let agentVerifierClient: AgentVerifierClient
  let agentVerifierAddress: `0x${string}`
  let agentVerifiableAddress: `0x${string}`
  const account = privateKeyToAccount(getAnvilAccount(1).privateKey)

  beforeAll(() => {
    const [proofVerifierAddress, agentVerifierAddr, agentVerifiableAddr] = deployContracts(
      'verify/ERC8274',
      'DeployERC8274',
    )
    agentVerifierAddress = agentVerifierAddr
    agentVerifiableAddress = agentVerifiableAddr
    proofVerifierClient = new ProofVerifierClient({ rpcUrl: ANVIL_RPC_URL, address: proofVerifierAddress }, account)
    agentVerifierClient = new AgentVerifierClient({ rpcUrl: ANVIL_RPC_URL, address: agentVerifierAddress }, account)
  })

  it('exposes the proof system identifier and profile', async () => {
    expect(await proofVerifierClient.proofSystem()).toBe('mock-test-only')
    expect(await proofVerifierClient.proofProfile()).toBe(keccak256(toHex('mock-test-only-v1')))
  })

  it('accepts a valid proof and rejects an invalid one', async () => {
    const inputHash = keccak256(toHex('input'))
    const outputHash = keccak256(toHex('output'))
    const metadata = '0x' as const
    const validProof = keccak256(encodePacked(['bytes32', 'bytes32', 'bytes'], [inputHash, outputHash, metadata]))
    const invalidProof = keccak256(toHex('garbage'))

    expect(await proofVerifierClient.verify(inputHash, outputHash, metadata, validProof)).toBe(true)
    expect(await proofVerifierClient.verify(inputHash, outputHash, metadata, invalidProof)).toBe(false)
  })

  it('routes through the agent verifier and produces a recomputable digest', async () => {
    const taskId = keccak256(toHex('task-1'))
    const agentId = keccak256(toHex('agent-1'))
    const inputHash = keccak256(toHex('input'))
    const outputHash = keccak256(toHex('output'))
    // MockAgentVerifier always routes to the proof verifier with empty
    // metadata (the ERC doesn't specify per-agent metadata), so the proof
    // must be constructed against empty metadata to be accepted here.
    const proof = keccak256(encodePacked(['bytes32', 'bytes32', 'bytes'], [inputHash, outputHash, '0x']))

    const { valid, verificationDigest } = await agentVerifierClient.verify(taskId, agentId, inputHash, outputHash, proof)

    expect(valid).toBe(true)

    // The ERC's digest formula includes `agentProofProfile`, which isn't
    // exposed generically by IAgentVerifier (see this ERC's README) — but
    // THIS specific mock happens to reuse the proof verifier's own
    // profile, which IS part of the official IProofVerifier API, so we
    // can recompute the expected digest using only supported client calls.
    const agentProofProfile = await proofVerifierClient.proofProfile()
    // The Solidity side uses `abi.encode` (not `abi.encodePacked`) for this
    // digest, so `bool` is padded to 32 bytes — encodeAbiParameters is the
    // matching viem primitive, not encodePacked.
    const expectedDigest = keccak256(
      encodeAbiParameters(
        [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'bool' }, { type: 'bytes32' }],
        [taskId, agentId, inputHash, outputHash, valid, agentProofProfile],
      ),
    )
    expect(verificationDigest).toBe(expectedDigest)
  })

  it('returns valid=false for a bad proof without reverting', async () => {
    const taskId = keccak256(toHex('task-2'))
    const agentId = keccak256(toHex('agent-2'))
    const inputHash = keccak256(toHex('input'))
    const outputHash = keccak256(toHex('output'))
    const badProof = keccak256(toHex('garbage'))

    const { valid } = await agentVerifierClient.verify(taskId, agentId, inputHash, outputHash, badProof)

    expect(valid).toBe(false)
  })

  it('reads the trusted verifier declared by the settlement contract', async () => {
    const trustedVerifier = await getTrustedVerifier({ rpcUrl: ANVIL_RPC_URL, address: agentVerifiableAddress })
    expect(trustedVerifier.toLowerCase()).toBe(agentVerifierAddress.toLowerCase())
  })
})
