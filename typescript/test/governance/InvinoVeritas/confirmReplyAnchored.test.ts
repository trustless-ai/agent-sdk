import { beforeAll, describe, expect, it } from 'vitest'
import { keccak256, toHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { ReviewGateClient } from '../../../src/governance/InvinoVeritas/client.js'
import { AgentWorkflowClient } from '../../../src/execution/ERC8301/client.js'
import { computeReplyHash } from '../../../src/execution/ERC8301/recompute.js'
import type { AgentReply } from '../../../src/execution/ERC8301/types.js'
import { ANVIL_RPC_URL, deployContract, getAnvilAccount } from '../../setup/deploy.js'

// Real gap this closes (BUILD_QUEUE.md, self-committed on
// ethereum-magicians.org/t/28785/57, 2026-08-10): review() and verifyLocal()
// only prove what invinoveritas SAID about an action -- nothing confirms the
// downstream on-chain reply actually reached an ERC-8301 IAgentWorkflow gate
// rather than getting silently dropped before submission. This suite runs
// against a REAL local MockAgentWorkflow deployment (Anvil + Foundry, same
// harness the execution/ERC8301 module's own tests use) -- not a mocked
// readContract call -- so "anchored" and "not anchored" are genuine on-chain
// states, not fixture assertions.
describe('ReviewGateClient.confirmReplyAnchored (ERC-8301 IAgentWorkflow, real local chain)', () => {
  const reviewClient = new ReviewGateClient({ apiKey: 'unused-for-this-suite' })
  let workflowClient: AgentWorkflowClient
  let contractAddress: `0x${string}`
  const account = privateKeyToAccount(getAnvilAccount(1).privateKey)

  beforeAll(() => {
    contractAddress = deployContract('execution/ERC8301', 'DeployERC8301')
    workflowClient = new AgentWorkflowClient({ rpcUrl: ANVIL_RPC_URL, address: contractAddress }, account)
  })

  it('reports anchored:false for a replyHash that was never submitted', async () => {
    const neverSubmittedHash = '0x0000000000000000000000000000000000000000000000000000000000000042' as `0x${string}`

    const status = await reviewClient.confirmReplyAnchored(
      { rpcUrl: ANVIL_RPC_URL, address: contractAddress },
      neverSubmittedHash,
    )

    expect(status.anchored).toBe(false)
  })

  it('reports anchored:true, proven:false for a reply submitted but not yet proven', async () => {
    const inputHash = keccak256(toHex('confirmReplyAnchored: anchored-not-proven'))
    const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 1000)
    const { workflowRunId } = await workflowClient.run(inputHash, '0x', expiresAt)

    const outputHash = keccak256(toHex('real review verdict output'))
    const timestamp = BigInt(Math.floor(Date.now() / 1000))
    const reply: AgentReply = {
      outputHash,
      output: '0x',
      timestamp,
      replier: account.address,
      prevTaskHashes: [] as readonly `0x${string}`[],
      workflowRunId,
    }
    await workflowClient.onAgentReply(reply)
    const replyHash = computeReplyHash(outputHash, timestamp, account.address, '0x' as `0x${string}`, workflowRunId)

    const status = await reviewClient.confirmReplyAnchored(
      { rpcUrl: ANVIL_RPC_URL, address: contractAddress },
      replyHash,
    )

    expect(status.anchored).toBe(true)
    if (status.anchored) {
      expect(status.proven).toBe(false)
      expect(status.verifier).toBe('0x0000000000000000000000000000000000000000')
    }
  })

  it('reports anchored:true, proven:true, and the real verifier/digest once onAgentProve runs', async () => {
    const inputHash = keccak256(toHex('confirmReplyAnchored: anchored-and-proven'))
    const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 1000)
    const { workflowRunId } = await workflowClient.run(inputHash, '0x', expiresAt)

    const outputHash = keccak256(toHex('real review verdict output, proven case'))
    const timestamp = BigInt(Math.floor(Date.now() / 1000))
    const reply: AgentReply = {
      outputHash,
      output: '0x',
      timestamp,
      replier: account.address,
      prevTaskHashes: [] as readonly `0x${string}`[],
      workflowRunId,
    }
    await workflowClient.onAgentReply(reply)
    const replyHash = computeReplyHash(outputHash, timestamp, account.address, '0x' as `0x${string}`, workflowRunId)

    const proofBytes = '0x70726f6f66' as `0x${string}` // "proof"
    await workflowClient.onAgentProve([replyHash], proofBytes)

    const status = await reviewClient.confirmReplyAnchored(
      { rpcUrl: ANVIL_RPC_URL, address: contractAddress },
      replyHash,
    )

    expect(status.anchored).toBe(true)
    if (status.anchored) {
      expect(status.proven).toBe(true)
      expect(status.verifier.toLowerCase()).toBe(account.address.toLowerCase())
      expect(status.verificationDigest).toBe(keccak256(proofBytes))
    }
  })

  it('propagates a genuine connection failure rather than reporting anchored:false', async () => {
    // A bad RPC URL is a "couldn't check" failure, not a "confirmed not
    // anchored" one -- conflating the two would make this method fail open
    // on exactly the case it exists to catch.
    await expect(
      reviewClient.confirmReplyAnchored(
        { rpcUrl: 'http://127.0.0.1:1', address: contractAddress },
        '0x0000000000000000000000000000000000000000000000000000000000000001' as `0x${string}`,
      ),
    ).rejects.toThrow()
  })
})
