import { beforeAll, describe, expect, it } from 'vitest'
import { privateKeyToAccount } from 'viem/accounts'
import { OnChainProofClient } from '../../../src/anchor/ERC8263/client.js'
import { ANVIL_RPC_URL, deployContract, getAnvilAccount } from '../../setup/deploy.js'

describe('OnChainProofClient (ERC-8263)', () => {
  let client: OnChainProofClient
  let contractAddress: `0x${string}`
  const account = privateKeyToAccount(getAnvilAccount(1).privateKey)

  beforeAll(() => {
    contractAddress = deployContract('anchor/ERC8263', 'DeployERC8263')
    client = new OnChainProofClient({ rpcUrl: ANVIL_RPC_URL, address: contractAddress }, account)
  })

  it('anchors a proof hash with ANONYMOUS scheme', async () => {
    const proofHash = '0x0000000000000000000000000000000000000000000000000000000000000001' as const
    const receipt = await client.anchor(0x00, '0x0000000000000000000000000000000000000000000000000000000000000000', proofHash)
    expect(receipt.status).toBe('success')
  })

  it('anchors a proof hash with REGISTRY scheme', async () => {
    const agentId = '0x0000000000000000000000000000000000000000000000000000000000000001' as const
    const proofHash = '0x0000000000000000000000000000000000000000000000000000000000000002' as const
    const receipt = await client.anchor(0x01, agentId, proofHash)
    expect(receipt.status).toBe('success')
  })

  it('anchors a proof hash with URI_HASH scheme', async () => {
    const agentId = '0x0000000000000000000000000000000000000000000000000000000000000001' as const
    const proofHash = '0x0000000000000000000000000000000000000000000000000000000000000002' as const
    const receipt = await client.anchor(0x02, agentId, proofHash)
    expect(receipt.status).toBe('success')
  })

  it('anchors with aux bytes', async () => {
    const agentId = '0x0000000000000000000000000000000000000000000000000000000000000001' as const
    const proofHash = '0x0000000000000000000000000000000000000000000000000000000000000002' as const
    const aux = '0xc0ffee' as const
    const receipt = await client.anchorWithAux(0x01, agentId, proofHash, aux)
    expect(receipt.status).toBe('success')
  })

  it('rejects zero proofHash', async () => {
    await expect(client.anchor(
      0x01,
      '0x0000000000000000000000000000000000000000000000000000000000000001',
      '0x0000000000000000000000000000000000000000000000000000000000000000',
    )).rejects.toThrow('proofHash must be non-zero')
  })

  it('rejects ANONYMOUS scheme with non-zero agentId', async () => {
    await expect(client.anchor(
      0x00,
      '0x0000000000000000000000000000000000000000000000000000000000000001',
      '0x0000000000000000000000000000000000000000000000000000000000000002',
    )).rejects.toThrow('ANONYMOUS scheme requires agentId == 0')
  })

  it('rejects reserved scheme', async () => {
    await expect(client.anchor(
      0x03,
      '0x0000000000000000000000000000000000000000000000000000000000000000',
      '0x0000000000000000000000000000000000000000000000000000000000000001',
    )).rejects.toThrow('reserved agentIdScheme')
  })
})
