import { beforeAll, describe, expect, it } from 'vitest'
import { keccak256, toHex, zeroHash } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { BoundedAgentActionClient } from '../../../src/metering/ERC8312/boundedAgentActionClient.js'
import { BudgetSubstrateClient } from '../../../src/metering/ERC8312/budgetSubstrateClient.js'
import { ContestableEnvelopeClient } from '../../../src/metering/ERC8312/contestableEnvelopeClient.js'
import { ANVIL_RPC_URL, deployContracts, getAnvilAccount } from '../../setup/deploy.js'

describe('ERC-8312 metering clients', () => {
  let boundedClient: BoundedAgentActionClient
  let budgetClient: BudgetSubstrateClient
  let budgetActionClient: BoundedAgentActionClient // Bounded client for the budget contract
  let contestableClient: ContestableEnvelopeClient
  let contestableActionClient: BoundedAgentActionClient // Bounded client for the contestable contract
  let boundedActionAddress: `0x${string}`
  let budgetAddress: `0x${string}`
  let contestableAddress: `0x${string}`
  const account = privateKeyToAccount(getAnvilAccount(1).privateKey)
  const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 86400)

  beforeAll(() => {
    const [boundedAddr, budgetAddr, contestableAddr] = deployContracts(
      'metering/ERC8312',
      'DeployERC8312',
    )
    boundedActionAddress = boundedAddr
    budgetAddress = budgetAddr
    contestableAddress = contestableAddr
    boundedClient = new BoundedAgentActionClient(
      { rpcUrl: ANVIL_RPC_URL, address: boundedActionAddress },
      account,
    )
    budgetClient = new BudgetSubstrateClient(
      { rpcUrl: ANVIL_RPC_URL, address: budgetAddress },
    )
    // A BoundedAgentActionClient pointed at the budget contract for registration
    budgetActionClient = new BoundedAgentActionClient(
      { rpcUrl: ANVIL_RPC_URL, address: budgetAddress },
      account,
    )
    contestableClient = new ContestableEnvelopeClient(
      { rpcUrl: ANVIL_RPC_URL, address: contestableAddress },
      account,
    )
    // A BoundedAgentActionClient pointed at the contestable contract for registration
    contestableActionClient = new BoundedAgentActionClient(
      { rpcUrl: ANVIL_RPC_URL, address: contestableAddress },
      account,
    )
  })

  it('registers an envelope and reads its metadata', async () => {
    const capabilityRoot = keccak256(toHex('my-capability'))
    const { id } = await boundedClient.registerEnvelope(account.address, capabilityRoot, expiresAt, '0x')
    expect(id).toBeDefined()
    expect(id).not.toBe(zeroHash)

    const env = await boundedClient.getEnvelope(id)
    expect(env.principal.toLowerCase()).toBe(account.address.toLowerCase())
    expect(env.capabilityRoot).toBe(capabilityRoot)
    expect(env.status).toBe(1) // Active
  })

  it('advances the cursor', async () => {
    const capabilityRoot = keccak256(toHex('cursor-test'))
    const { id } = await boundedClient.registerEnvelope(account.address, capabilityRoot, expiresAt, '0x')
    const cursor0 = await boundedClient.getCursor(id)
    expect(cursor0).toBe(zeroHash)

    const witness = keccak256(toHex('advance-1'))
    const { prevCursor, newCursor } = await boundedClient.advanceCursor(id, witness)
    expect(prevCursor).toBe(cursor0)
    expect(newCursor).not.toBe(zeroHash)
    expect(newCursor).not.toBe(prevCursor)
  })

  it('reads envelope status and isActive', async () => {
    const capabilityRoot = keccak256(toHex('status-test'))
    const { id } = await boundedClient.registerEnvelope(account.address, capabilityRoot, expiresAt, '0x')

    expect(await boundedClient.isActive(id)).toBe(true)
    expect(await boundedClient.getStatus(id)).toBe(1) // Active

    await boundedClient.setStatus(id, 2) // Completed

    expect(await boundedClient.getStatus(id)).toBe(2) // Completed
    expect(await boundedClient.isActive(id)).toBe(false)
  })

  it('budget substrate: reads bound, spent, and remaining', async () => {
    // Register on the budget contract itself (it implements IBoundedAgentAction)
    const capabilityRoot = keccak256(toHex('budget-test'))
    const { id } = await budgetActionClient.registerEnvelope(account.address, capabilityRoot, expiresAt, '0x')

    const { cap, asset } = await budgetClient.bound(id)
    expect(cap).toBeGreaterThan(BigInt(0))
    expect(asset).toBeDefined()

    expect(await budgetClient.spent(id)).toBe(BigInt(0))
    expect(await budgetClient.remaining(id)).toBe(cap)
  })

  it('contestable envelope: contest and resolve to active', async () => {
    // Register on the contestable contract itself (it implements IBoundedAgentAction)
    const capabilityRoot = keccak256(toHex('contest-test'))
    const { id } = await contestableActionClient.registerEnvelope(account.address, capabilityRoot, expiresAt, '0x')

    const contested = await contestableClient.contest(id, toHex('evidence'))
    expect(contested.id).toBe(id)

    const status = await contestableActionClient.getStatus(id)
    expect(status).toBe(3) // Contested

    // Resolve back to Active
    const resolved = await contestableClient.resolve(id, 1, toHex('resolution')) // 1 = Active
    expect(resolved.id).toBe(id)
  })
})
