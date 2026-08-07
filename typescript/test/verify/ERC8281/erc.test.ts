import { beforeAll, describe, expect, it } from 'vitest'
import { keccak256, toHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { ObservationCommitmentClient } from '../../../src/verify/ERC8281/client.js'
import { computeObservationDigest } from '../../../src/verify/ERC8281/recompute.js'
import { ANVIL_RPC_URL, deployContract, getAnvilAccount } from '../../setup/deploy.js'

describe('ObservationCommitmentClient (ERC-8281)', () => {
  let client: ObservationCommitmentClient
  let contractAddress: `0x${string}`
  const account = privateKeyToAccount(getAnvilAccount(1).privateKey)

  beforeAll(() => {
    contractAddress = deployContract('verify/ERC8281', 'DeployERC8281')
    client = new ObservationCommitmentClient({ rpcUrl: ANVIL_RPC_URL, address: contractAddress }, account)
  })

  it('supports the observation commitment interface', async () => {
    expect(await client.supportsObservationCommitment()).toBe(true)
  })

  it('records a digest and emits Recorded event', async () => {
    const digest = keccak256(toHex('test-observation'))
    const receipt = await client.record(digest)

    expect(receipt.transactionHash).toBeDefined()
    expect(receipt.status).toBe('success')

    const event = client.parseRecordedEvent(receipt)
    expect(event.digest).toBe(digest)
    expect(event.committer.toLowerCase()).toBe(account.address.toLowerCase())
  })

  it('verifies via recompute: digest matches keccak256(observation)', () => {
    const observation = '0xdeadbeef' as const
    const digest = computeObservationDigest(observation)
    const expected = keccak256(observation)
    expect(digest).toBe(expected)
  })

  it('records multiple digests with different values', async () => {
    const digest1 = keccak256(toHex('obs-1'))
    const digest2 = keccak256(toHex('obs-2'))

    const receipt1 = await client.record(digest1)
    const receipt2 = await client.record(digest2)

    expect(receipt1.status).toBe('success')
    expect(receipt2.status).toBe('success')

    const event1 = client.parseRecordedEvent(receipt1)
    const event2 = client.parseRecordedEvent(receipt2)
    expect(event1.digest).toBe(digest1)
    expect(event2.digest).toBe(digest2)
  })
})
