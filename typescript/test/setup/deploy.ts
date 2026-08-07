import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const testkitDir = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../testkit')

export const ANVIL_RPC_URL = 'http://127.0.0.1:8545'


export interface AnvilAccount {
  address: `0x${string}`
  privateKey: `0x${string}`
}

// Reads one of anvil's own locally-generated (freshly random per process)
// default accounts, written by testkit/scripts/start-anvil.sh. No address
// or private key is ever a literal in this repo's source.
export function getAnvilAccount(index: number): AnvilAccount {
  const accountsPath = path.join(testkitDir, '.anvil-accounts.json')
  let data: string
  try {
    data = readFileSync(accountsPath, 'utf-8')
  } catch {
    throw new Error(
      `${accountsPath} not found — start anvil first: testkit/scripts/start-anvil.sh`,
    )
  }
  const { accounts } = JSON.parse(data) as { accounts: AnvilAccount[] }
  const account = accounts[index]
  if (!account) {
    throw new Error(`getAnvilAccount: no anvil account at index ${index}`)
  }
  return account
}

// Returns every contract address deployed by the given script, in
// broadcast order, for scripts that deploy more than one wired-together
// contract (e.g. a verifier plus the agent-facing contract that wraps it).
export function deployContracts(ercPath: string, contractName: string): `0x${string}`[] {
  const output = execFileSync(path.join(testkitDir, 'scripts', 'deploy.sh'), [ercPath, contractName], {
    cwd: testkitDir,
    encoding: 'utf-8',
  })
  return output
    .trim()
    .split('\n')
    .filter((line) => line.length > 0) as `0x${string}`[]
}

export function deployContract(ercPath: string, contractName: string): `0x${string}` {
  return deployContracts(ercPath, contractName)[0]
}
