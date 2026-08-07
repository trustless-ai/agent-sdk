import { beforeAll, describe, expect, it } from 'vitest'
import { keccak256, stringToHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { ConsultEscrowClient } from '../../../src/settlement/ERC8203/client.js'
import { computeVerdictHash } from '../../../src/settlement/ERC8203/recompute.js'
import { ANVIL_RPC_URL, deployContract, getAnvilAccount } from '../../setup/deploy.js'
import type { Hex } from 'viem'

describe('ConsultEscrowClient (ERC-8203)', () => {
  let client: ConsultEscrowClient
  let contractAddress: `0x${string}`
  // Account #1 is used as the consumer; account #2 will be the provider;
  // account #0 is used as the attestor (signer).
  const consumerAccount = privateKeyToAccount(getAnvilAccount(1).privateKey)
  const providerAccount = getAnvilAccount(2)
  const attestorAccount = getAnvilAccount(0)

  beforeAll(() => {
    contractAddress = deployContract('settlement/ERC8203', 'DeployERC8203')
    client = new ConsultEscrowClient({ rpcUrl: ANVIL_RPC_URL, address: contractAddress }, consumerAccount)
  })

  describe('open and getJob', () => {
    it('opens a new escrow job and reads it back', async () => {
      const jobId = keccak256(stringToHex('test-job-1')) as Hex
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
      const value = 1_000_000_000_000_000_000n // 1 ETH

      const receipt = await client.open(
        jobId,
        providerAccount.address as `0x${string}`,
        attestorAccount.address as `0x${string}`,
        deadline,
        value,
      )

      // Verify the Opened event was emitted
      const [opened] = client.parseOpened(receipt)
      expect(opened.jobId).toBe(jobId)
      expect(opened.consumer.toLowerCase()).toBe(consumerAccount.address.toLowerCase())
      expect(opened.provider.toLowerCase()).toBe(providerAccount.address.toLowerCase())
      expect(opened.attestor.toLowerCase()).toBe(attestorAccount.address.toLowerCase())
      expect(opened.amount).toBe(value)
      expect(opened.deadline).toBe(deadline)

      // Read back via getJob
      const job = await client.getJob(jobId)
      expect(job.consumer.toLowerCase()).toBe(consumerAccount.address.toLowerCase())
      expect(job.provider.toLowerCase()).toBe(providerAccount.address.toLowerCase())
      expect(job.attestor.toLowerCase()).toBe(attestorAccount.address.toLowerCase())
      expect(job.amount).toBe(value)
      expect(job.deadline).toBe(deadline)
      expect(job.status).toBe(1) // Open
    })

    it('reverts when opening the same job twice', async () => {
      const jobId = keccak256(stringToHex('test-job-duplicate')) as Hex
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)

      await client.open(
        jobId,
        providerAccount.address as `0x${string}`,
        attestorAccount.address as `0x${string}`,
        deadline,
        1_000_000_000_000_000_000n,
      )

      await expect(
        client.open(
          jobId,
          providerAccount.address as `0x${string}`,
          attestorAccount.address as `0x${string}`,
          deadline,
          1_000_000_000_000_000_000n,
        ),
      ).rejects.toThrow()
    })

    it('reverts on zero value', async () => {
      const jobId = keccak256(stringToHex('test-job-zero-value')) as Hex
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)

      await expect(
        client.open(
          jobId,
          providerAccount.address as `0x${string}`,
          attestorAccount.address as `0x${string}`,
          deadline,
          0n,
        ),
      ).rejects.toThrow()
    })
  })

  describe('release (happy path)', () => {
    it('releases funds when attestor signs the commitment', async () => {
      const jobId = keccak256(stringToHex('test-job-release')) as Hex
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
      const value = 1_000_000_000_000_000_000n
      const resultText = 'Task completed successfully.'

      await client.open(
        jobId,
        providerAccount.address as `0x${string}`,
        attestorAccount.address as `0x${string}`,
        deadline,
        value,
      )

      // Compute the commitment hash
      const resultHash = keccak256(stringToHex(resultText)) as Hex
      const commitmentHash = computeVerdictHash(jobId, resultText)

      // Sign with the attestor's key
      const attestorWallet = privateKeyToAccount(attestorAccount.privateKey)
      const signature = await attestorWallet.signMessage({ message: { raw: commitmentHash } })

      const receipt = await client.release(jobId, resultHash, signature)

      const [released] = client.parseReleased(receipt)
      expect(released.jobId).toBe(jobId)
      expect(released.resultHash).toBe(resultHash)
      expect(released.commitmentHash).toBe(commitmentHash)
      expect(released.provider.toLowerCase()).toBe(providerAccount.address.toLowerCase())
      expect(released.amount).toBe(value)

      // Verify the job is now Released
      const job = await client.getJob(jobId)
      expect(job.status).toBe(2) // Released
    })

    it('rejects release with wrong attestor signature', async () => {
      const jobId = keccak256(stringToHex('test-job-wrong-sig')) as Hex
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
      const value = 1_000_000_000_000_000_000n

      await client.open(
        jobId,
        providerAccount.address as `0x${string}`,
        attestorAccount.address as `0x${string}`,
        deadline,
        value,
      )

      const resultText = 'Tampered result.'
      const resultHash = keccak256(stringToHex(resultText)) as Hex
      const commitmentHash = computeVerdictHash(jobId, resultText)

      // Sign with a DIFFERENT key (account #1) — not the attestor
      const wrongWallet = consumerAccount
      const wrongSignature = await wrongWallet.signMessage({ message: { raw: commitmentHash } })

      await expect(client.release(jobId, resultHash, wrongSignature)).rejects.toThrow()
    })
  })

  describe('refund', () => {
    it('reverts refund before deadline', async () => {
      const jobId = keccak256(stringToHex('test-job-refund-early')) as Hex
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600) // 1 hour from now
      const value = 1_000_000_000_000_000_000n

      await client.open(
        jobId,
        providerAccount.address as `0x${string}`,
        attestorAccount.address as `0x${string}`,
        deadline,
        value,
      )

      await expect(client.refund(jobId)).rejects.toThrow()
    })
  })

  describe('verify (recompute-to-verify)', () => {
    it('confirms a genuine commitment hash', () => {
      const jobId = '0xbc01b40fe7a3509f35470053d4bc1844d50c9782546cf0fc11154adcb90caa56' as Hex
      const resultText = 'No intermediaries required, cryptographic verification only.'
      const commitmentHash = computeVerdictHash(jobId, resultText)

      expect(client.verify(commitmentHash, jobId, resultText)).toBe(true)
    })

    it('rejects a tampered commitment hash', () => {
      const jobId = '0xbc01b40fe7a3509f35470053d4bc1844d50c9782546cf0fc11154adcb90caa56' as Hex
      const resultText = 'No intermediaries required, cryptographic verification only.'
      // This is the REAL commitment hash for the above inputs — use a different one to trigger failure
      const tamperedHash = '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex

      expect(client.verify(tamperedHash, jobId, resultText)).toBe(false)
    })

    it('detects tampered result text', () => {
      const jobId = '0xbc01b40fe7a3509f35470053d4bc1844d50c9782546cf0fc11154adcb90caa56' as Hex
      const originalText = 'No intermediaries required, cryptographic verification only.'
      const tamperedText = 'Tampered result text.'
      const commitmentHash = computeVerdictHash(jobId, originalText)

      // Same commitment hash but different result text — should NOT match
      expect(client.verify(commitmentHash, jobId, tamperedText)).toBe(false)
    })
  })
})
