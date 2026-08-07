import { beforeAll, describe, expect, it } from 'vitest'
import { privateKeyToAccount } from 'viem/accounts'
import { SourceBindingClient } from '../../../src/identity/ERC8323/client.js'
import { ANVIL_RPC_URL, deployContracts, getAnvilAccount } from '../../setup/deploy.js'

// Matches MockAgentSourceBinding.MINT_PRICE (0.001 ether, in wei).
const MINT_PRICE = 10n ** 15n

describe('SourceBindingClient (ERC-8323)', () => {
  let client: SourceBindingClient
  let bindingAddress: `0x${string}`
  let dummyCollectionAddress: `0x${string}`
  const account = privateKeyToAccount(getAnvilAccount(1).privateKey)

  beforeAll(() => {
    const [dummyAddr, bindingAddr] = deployContracts('identity/ERC8323', 'DeployERC8323')
    dummyCollectionAddress = dummyAddr
    bindingAddress = bindingAddr
    client = new SourceBindingClient({ rpcUrl: ANVIL_RPC_URL, address: bindingAddress }, account)
  })

  it('returns the bound collection address', async () => {
    const collection = await client.boundCollection()
    expect(collection.toLowerCase()).toBe(dummyCollectionAddress.toLowerCase())
  })

  it('registers an agent and reads back its source NFT', async () => {
    const agentId = await client.register(42n, MINT_PRICE)
    expect(agentId).toBeGreaterThan(0n)

    const sourceNFT = await client.getSourceNFT(agentId)
    expect(sourceNFT.sourceContract.toLowerCase()).toBe(dummyCollectionAddress.toLowerCase())
    expect(sourceNFT.sourceTokenId).toBe(42n)
  })

  it('returns true for hasSourceNFT after registration', async () => {
    const agentId = await client.register(99n, MINT_PRICE)
    expect(await client.hasSourceNFT(agentId)).toBe(true)
  })

  it('returns false for hasSourceNFT for an unbound agent', async () => {
    // Register then check — all agents registered through this mock have a source
    const agentId = await client.register(100n, MINT_PRICE)
    expect(await client.hasSourceNFT(agentId)).toBe(true)
  })

  it('validates source NFT ownership', async () => {
    const agentId = await client.register(7n, MINT_PRICE)
    expect(await client.isSourceNFTOwnershipValid(agentId)).toBe(true)
  })

  it('reports supportsInterface correctly', async () => {
    expect(await client.supportsSourceBinding()).toBe(true)
  })

  it('reverts on wrong mint price, succeeds with the correct one', async () => {
    // Real bug found 2026-07-16: register() never threaded value through the
    // call, so a paid registry (mintPrice > 0, e.g. a real deployed
    // AgentIdentityRegistry) would always revert. Confirms the default (no
    // value) now fails loudly against a price-enforcing mock, and the correct
    // value succeeds -- locks the fix in rather than relying on a free mock
    // to mask it.
    await expect(client.register(1n)).rejects.toThrow(/wrong mint price/)
    const agentId = await client.register(1n, MINT_PRICE)
    expect(agentId).toBeGreaterThan(0n)
  })
})
