import { beforeAll, describe, expect, it } from 'vitest'
import { privateKeyToAccount } from 'viem/accounts'
import { IdentityRegistryClient } from '../../../src/identity/ERC8004/client.js'
import { ANVIL_RPC_URL, deployContract, getAnvilAccount } from '../../setup/deploy.js'

describe('IdentityRegistryClient (ERC-8004)', () => {
  let client: IdentityRegistryClient
  let contractAddress: `0x${string}`
  // Account #1 acts as the agent owner; account #0's address (not its key)
  // is reused below only as an arbitrary target address for "set wallet".
  const account = privateKeyToAccount(getAnvilAccount(1).privateKey)
  const SOME_OTHER_ADDRESS = getAnvilAccount(0).address

  beforeAll(() => {
    contractAddress = deployContract('identity/ERC8004', 'DeployERC8004')
    client = new IdentityRegistryClient({ rpcUrl: ANVIL_RPC_URL, address: contractAddress }, account)
  })

  it('registers an agent and reads back its URI and metadata', async () => {
    const agentId = await client.register('ipfs://agent-1', [
      { metadataKey: 'role', metadataValue: '0x76616c696461746f72' }, // "validator"
    ])

    expect(await client.getAgentURI(agentId)).toBe('ipfs://agent-1')
    expect(await client.getMetadata(agentId, 'role')).toBe('0x76616c696461746f72')
  })

  it('sets the agent wallet given a valid EIP-712 signature', async () => {
    const agentId = await client.register()
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)

    const signature = await account.signTypedData({
      domain: {
        name: 'MockIdentityRegistry',
        version: '1',
        chainId: 31337,
        verifyingContract: contractAddress,
      },
      types: {
        SetAgentWallet: [
          { name: 'agentId', type: 'uint256' },
          { name: 'newWallet', type: 'address' },
          { name: 'deadline', type: 'uint256' },
        ],
      },
      primaryType: 'SetAgentWallet',
      message: { agentId, newWallet: SOME_OTHER_ADDRESS, deadline },
    })

    await client.setAgentWallet(agentId, SOME_OTHER_ADDRESS, deadline, signature)

    expect((await client.getAgentWallet(agentId)).toLowerCase()).toBe(SOME_OTHER_ADDRESS.toLowerCase())
  })

  it('rejects a wallet update signed by the wrong account', async () => {
    const agentId = await client.register()
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
    const wrongAccount = privateKeyToAccount(getAnvilAccount(2).privateKey)

    const signature = await wrongAccount.signTypedData({
      domain: {
        name: 'MockIdentityRegistry',
        version: '1',
        chainId: 31337,
        verifyingContract: contractAddress,
      },
      types: {
        SetAgentWallet: [
          { name: 'agentId', type: 'uint256' },
          { name: 'newWallet', type: 'address' },
          { name: 'deadline', type: 'uint256' },
        ],
      },
      primaryType: 'SetAgentWallet',
      message: { agentId, newWallet: SOME_OTHER_ADDRESS, deadline },
    })

    await expect(client.setAgentWallet(agentId, SOME_OTHER_ADDRESS, deadline, signature)).rejects.toThrow()
  })
})
