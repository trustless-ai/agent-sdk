import { beforeAll, describe, expect, it } from 'vitest'
import { keccak256, stringToHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { AgentReputationClient } from '../../../src/reputation/ERC8275/client.js'
import { computeWinRate } from '../../../src/reputation/ERC8275/recompute.js'
import { ANVIL_RPC_URL, deployContract, getAnvilAccount } from '../../setup/deploy.js'
import type { Hex } from 'viem'

describe('AgentReputationClient (ERC-8275)', () => {
  let client: AgentReputationClient
  let contractAddress: `0x${string}`
  const account = privateKeyToAccount(getAnvilAccount(1).privateKey)

  const AGENT_ID = keccak256(stringToHex('test-agent')) as Hex
  const ORDER_ID = keccak256(stringToHex('test-order')) as Hex

  beforeAll(() => {
    contractAddress = deployContract('reputation/ERC8275', 'DeployERC8275')
    client = new AgentReputationClient({ rpcUrl: ANVIL_RPC_URL, address: contractAddress }, account)
  })

  describe('getReputation', () => {
    it('returns default (zero) reputation for an unregistered agent', async () => {
      const rep = await client.getReputation(AGENT_ID)
      expect(rep.completedOrders).toBe(0n)
      expect(rep.disputedOrders).toBe(0n)
      expect(rep.totalVolume).toBe(0n)
      expect(rep.lastActiveAt).toBe(0n)
      expect(rep.score).toBe(0)
    })
  })

  describe('getDecayWeight', () => {
    it('returns default (zero) decay weight for an unregistered agent', async () => {
      const weight = await client.getDecayWeight(AGENT_ID)
      expect(weight).toBe(0)
    })
  })

  describe('verifyOutcome', () => {
    it('returns false for an unknown order (no outcome set)', async () => {
      const proof = ('0x' + '00'.repeat(32)) as Hex // empty agentId as proof
      const valid = await client.verifyOutcome(ORDER_ID, proof)
      expect(valid).toBe(false)
    })
  })

  describe('computeWinRate (recompute)', () => {
    it('computes win rate from golden vector: 16 wins, 15 losses', () => {
      expect(computeWinRate(16, 15)).toBe(5161)
    })

    it('handles perfect record (non-zero wins, zero losses)', () => {
      expect(computeWinRate(10, 0)).toBe(10000)
    })

    it('handles zero wins, non-zero losses', () => {
      expect(computeWinRate(0, 10)).toBe(0)
    })

    it('throws when both wins and losses are zero', () => {
      expect(() => computeWinRate(0, 0)).toThrow()
    })
  })
})
