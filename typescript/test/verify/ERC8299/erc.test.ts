import { beforeAll, describe, expect, it } from 'vitest'
import { encodeAbiParameters, keccak256, toHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { WyriweAttestationClient } from '../../../src/verify/ERC8299/wyriweAttestationClient.js'
import { JudgmentExecutionClient } from '../../../src/verify/ERC8299/judgmentExecutionClient.js'
import { ANVIL_RPC_URL, deployContracts, getAnvilAccount } from '../../setup/deploy.js'

describe('ERC-8299 verify clients', () => {
  let wyriweClient: WyriweAttestationClient
  let judgmentClient: JudgmentExecutionClient
  const account = privateKeyToAccount(getAnvilAccount(1).privateKey)

  beforeAll(() => {
    const [wyriweAddr, judgmentAddr] = deployContracts(
      'verify/ERC8299',
      'DeployERC8299',
    )
    wyriweClient = new WyriweAttestationClient({ rpcUrl: ANVIL_RPC_URL, address: wyriweAddr }, account)
    judgmentClient = new JudgmentExecutionClient({ rpcUrl: ANVIL_RPC_URL, address: judgmentAddr }, account)
  })

  describe('WyriweAttestationClient', () => {
    it('exposes the proof system identifier', async () => {
      expect(await wyriweClient.proofSystem()).toBe('attestation/wyriwe')
    })

    it('accepts a valid proof and rejects an invalid one', async () => {
      const agentId = keccak256(toHex('agent-1'))
      const registry = account.address
      const modelHash = keccak256(toHex('model-v1'))
      const rawInputHash = keccak256(toHex('raw input'))
      const sanitizationPipelineHash = keccak256(toHex('sanitization pipeline'))
      const inputHash = keccak256(toHex('sanitized input'))
      const outputHash = keccak256(toHex('model output'))
      const timestamp = BigInt(Math.floor(Date.now() / 1000))

      // Encode as a tuple to match Solidity's abi.encode(struct)
      const encoded = encodeAbiParameters(
        [
          {
            type: 'tuple',
            components: [
              { type: 'bytes32' },
              { type: 'address' },
              { type: 'bytes32' },
              { type: 'bytes32' },
              { type: 'bytes32' },
              { type: 'bytes32' },
              { type: 'bytes32' },
              { type: 'uint256' },
            ],
          },
        ],
        [[agentId, registry, modelHash, rawInputHash, sanitizationPipelineHash, inputHash, outputHash, timestamp]],
      )
      const validSignature = keccak256(encoded)

      const result = await wyriweClient.verify(
        { agentId, registry, modelHash, rawInputHash, sanitizationPipelineHash, inputHash, outputHash, timestamp },
        validSignature,
      )
      expect(result).toBe(true)

      // Invalid signature (random bytes)
      const invalidSignature = ('0x' + 'ff'.repeat(32)) as `0x${string}`
      const invalidResult = await wyriweClient.verify(
        { agentId, registry, modelHash, rawInputHash, sanitizationPipelineHash, inputHash, outputHash, timestamp },
        invalidSignature,
      )
      expect(invalidResult).toBe(false)
    })
  })

  describe('JudgmentExecutionClient', () => {
    it('exposes the proof system identifier', async () => {
      expect(await judgmentClient.proofSystem()).toBe('attestation/judgment')
    })

    it('accepts a valid proof and rejects an invalid one', async () => {
      const agentId = keccak256(toHex('executing-agent'))
      const registry = account.address
      const validatorId = keccak256(toHex('validator'))
      const rawProposalHash = keccak256(toHex('proposal'))
      const verdictHash = keccak256(toHex('verdict'))
      const executedActionHash = keccak256(toHex('executed action'))
      const verdictTimestamp = BigInt(Math.floor(Date.now() / 1000) - 3600)
      const executedTimestamp = BigInt(Math.floor(Date.now() / 1000))
      const recordPointer = 'https://example.com/record/1'

      // Encode as a tuple to match Solidity's abi.encode(struct)
      const encoded = encodeAbiParameters(
        [
          {
            type: 'tuple',
            components: [
              { type: 'bytes32' },
              { type: 'address' },
              { type: 'bytes32' },
              { type: 'bytes32' },
              { type: 'bytes32' },
              { type: 'bytes32' },
              { type: 'uint256' },
              { type: 'uint256' },
              { type: 'string' },
            ],
          },
        ],
        [[
          agentId,
          registry,
          validatorId,
          rawProposalHash,
          verdictHash,
          executedActionHash,
          verdictTimestamp,
          executedTimestamp,
          recordPointer,
        ]],
      )
      const validSignature = keccak256(encoded)

      const result = await judgmentClient.verify(
        {
          agentId,
          registry,
          validatorId,
          rawProposalHash,
          verdictHash,
          executedActionHash,
          verdictTimestamp,
          executedTimestamp,
          recordPointer,
        },
        validSignature,
      )
      expect(result).toBe(true)

      // Invalid signature (random bytes)
      const invalidSignature = ('0x' + 'aa'.repeat(32)) as `0x${string}`
      const invalidResult = await judgmentClient.verify(
        {
          agentId,
          registry,
          validatorId,
          rawProposalHash,
          verdictHash,
          executedActionHash,
          verdictTimestamp,
          executedTimestamp,
          recordPointer,
        },
        invalidSignature,
      )
      expect(invalidResult).toBe(false)
    })
  })
})
