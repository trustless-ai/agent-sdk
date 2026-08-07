import { beforeAll, describe, expect, it } from 'vitest'
import { privateKeyToAccount } from 'viem/accounts'
import { keccak256, toHex } from 'viem'
import { AgentWorkflowClient } from '../../../src/execution/ERC8301/client.js'
import type { AgentReply } from '../../../src/execution/ERC8301/types.js'
import { ANVIL_RPC_URL, deployContract, getAnvilAccount } from '../../setup/deploy.js'

describe('AgentWorkflowClient (ERC-8301)', () => {
  let client: AgentWorkflowClient
  let contractAddress: `0x${string}`
  const account = privateKeyToAccount(getAnvilAccount(1).privateKey)

  beforeAll(() => {
    contractAddress = deployContract('execution/ERC8301', 'DeployERC8301')
    client = new AgentWorkflowClient({ rpcUrl: ANVIL_RPC_URL, address: contractAddress }, account)
  })

  it('starts a workflow run and emits NewAgentTask', async () => {
    const inputHash = keccak256(toHex('test input'))
    const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 1000)

    const result = await client.run(inputHash, '0x7465737420696e707574', expiresAt)

    expect(result.workflowRunId).toBeDefined()
    expect(result.workflowRunId).not.toBe('0x0000000000000000000000000000000000000000000000000000000000000000')
    expect(result.taskHash).toBeDefined()
    expect(result.stage).toBe(1)
  })

  it('retrieves the task after running', async () => {
    const inputHash = keccak256(toHex('test retrieval'))
    const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 1000)

    const { taskHash } = await client.run(inputHash, '0x746573742072657472696576616c', expiresAt)

    const { task, proven } = await client.getTask(taskHash)
    expect(task.stage).toBe(1)
    expect(task.inputHash).toBe(inputHash)
    expect(task.workflowRunId).toBeDefined()
    expect(proven).toBe(true) // initial task with empty prevReplyHashes is proven
  })

  it('retrieves the run result', async () => {
    const inputHash = keccak256(toHex('test result'))
    const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 1000)

    const { workflowRunId } = await client.run(inputHash, '0x7465737420726573756c74', expiresAt)

    const runResult = await client.result(workflowRunId)
    expect(runResult.status).toBe(0) // Pending
  })

  it('starts a run, submits a reply, and retrieves the reply', async () => {
    const inputHash = keccak256(toHex('test reply flow'))
    const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 1000)

    const { workflowRunId } = await client.run(inputHash, '0x74657374207265706c7920666c6f77', expiresAt)

    const outputHash = keccak256(toHex('reply output'))
    const now = BigInt(Math.floor(Date.now() / 1000))

    const reply: AgentReply = {
      outputHash,
      output: '0x7265706c79206f7574707574',
      timestamp: now,
      replier: account.address,
      prevTaskHashes: [] as readonly `0x${string}`[],
      workflowRunId,
    }

    await client.onAgentReply(reply)

    // Compute the expected replyHash
    const { computeReplyHash } = await import('../../../src/execution/ERC8301/recompute.js')
    const replyHash = computeReplyHash(
      outputHash,
      now,
      account.address,
      '0x' as `0x${string}`,
      workflowRunId,
    )

    const { reply: storedReply, verifier, proven } = await client.getReply(replyHash)
    expect(storedReply.outputHash).toBe(outputHash)
    expect(storedReply.replier.toLowerCase()).toBe(account.address.toLowerCase())
    expect(storedReply.workflowRunId).toBe(workflowRunId)
    expect(verifier).toBe('0x0000000000000000000000000000000000000000')
    expect(proven).toBe(false)
  })

  it('marks a reply as proven via onAgentProve', async () => {
    const inputHash = keccak256(toHex('test prove'))
    const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 1000)

    const { workflowRunId } = await client.run(inputHash, '0x746573742070726f7665', expiresAt)

    const outputHash = keccak256(toHex('prove output'))
    const now = BigInt(Math.floor(Date.now() / 1000))

    const reply: AgentReply = {
      outputHash,
      output: '0x70726f7665206f7574707574',
      timestamp: now,
      replier: account.address,
      prevTaskHashes: [] as readonly `0x${string}`[],
      workflowRunId,
    }

    await client.onAgentReply(reply)

    const { computeReplyHash } = await import('../../../src/execution/ERC8301/recompute.js')
    const replyHash = computeReplyHash(
      outputHash,
      now,
      account.address,
      '0x' as `0x${string}`,
      workflowRunId,
    )

    await client.onAgentProve([replyHash], '0x70726f6f66' as `0x${string}`)

    const { verifier, proven, verificationDigest } = await client.getReply(replyHash)
    expect(proven).toBe(true)
    expect(verifier.toLowerCase()).toBe(account.address.toLowerCase())
    expect(verificationDigest).toBeDefined()
  })

  it('reverts when querying a nonexistent task', async () => {
    const fakeHash = '0x0000000000000000000000000000000000000000000000000000000000000001' as `0x${string}`
    await expect(client.getTask(fakeHash)).rejects.toThrow()
  })

  it('reverts when querying a nonexistent reply', async () => {
    const fakeHash = '0x0000000000000000000000000000000000000000000000000000000000000002' as `0x${string}`
    await expect(client.getReply(fakeHash)).rejects.toThrow()
  })
})
