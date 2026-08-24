import type { Address, Chain, Hex } from 'viem'

/** Client config for ReviewGateClient — an HTTP endpoint, not an on-chain address. */
export interface ReviewGateConfig {
  /** invinoveritas API key (Bearer token). Required for paid calls; a small free
   * allowance exists per key for evaluation. */
  apiKey: string
  /** Override the default https://api.babyblueviper.com base URL — for testing
   * against a self-hosted or staging deployment of the same API surface. */
  baseUrl?: string
}

export type Verdict = 'approve' | 'reject' | 'approve_with_concerns'

export interface ReviewIssue {
  severity: 'blocker' | 'high' | 'medium' | 'low'
  category: string
  description: string
  suggested_fix?: string
  attribution?: 'agentive' | 'ambiguous' | string
}

/** The signed Nostr (NIP-01) event carrying the verdict — the thing
 * `verifyProofLocal` from `invinoveritas-verify` checks. Opaque to callers
 * that don't need to inspect it directly; pass it straight through. */
export interface SignedEvent {
  id: string
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
  sig: string
}

export interface ReviewProof {
  proof_payload: Record<string, unknown>
  signature_type: string
  event?: SignedEvent
}

export interface ReviewResponse {
  status: string
  verdict: Verdict
  confidence: number
  summary: string
  issues: ReviewIssue[]
  alternative_approaches?: string[]
  /** Present when the review call requested a signed proof (the default —
   * see `ReviewOptions.sign`). Hand this straight to `verifyLocal()` to
   * independently confirm the verdict is untampered before acting on it. */
  proof?: ReviewProof
}

/** Where the ERC-8301 `IAgentWorkflow` contract an agent's on-chain reply would be
 * anchored to actually lives — a read-only lookup, no wallet/account needed. */
export interface AgentWorkflowGateConfig {
  rpcUrl: string
  /** The deployed IAgentWorkflow contract address. */
  address: `0x${string}`
  /**
   * The viem chain this `rpcUrl` points at.
   *
   * Optional, and defaults to `foundry` so local/anvil callers need not supply it. It exists
   * because `confirmReplyAnchored` is documented as confirming against "the deployed
   * IAgentWorkflow contract" generally, not a local devnet — and hardwiring a chain contradicts
   * that. The hardcoded version happened to work only because viem does not enforce chainId on a
   * read-only `eth_call`; that is a property of the call type, not of the code being correct, so
   * it would become a real defect the moment this grows anything write-shaped or viem tightens
   * that path. Raised by Tiago Merlini (via Echo) in review of PR #22.
   */
  chain?: Chain
}

/**
 * The exact return shape of IAgentWorkflow.getAgentReply.
 *
 * Named rather than inlined as a cast so that a future ABI change or a reordered destructure is
 * caught by tsc instead of being silent at compile time and wrong at runtime. The leading slot is
 * the reply tuple itself, which `confirmReplyAnchored` deliberately skips — that ordering is the
 * thing a reviewer previously had to verify by hand against ground truth, and it is exactly what
 * a type should be carrying.
 */
export type AgentReplyTuple = readonly [
  reply: unknown,
  verifier: Address,
  proven: boolean,
  verificationDigest: Hex,
]

/** Result of checking whether a specific reply (identified by its ERC-8301
 * replyHash) was actually anchored on-chain — see
 * `ReviewGateClient.confirmReplyAnchored`. */
export type ReplyAnchorStatus =
  | { anchored: false }
  | {
      anchored: true
      /** True once a proof covering this reply has been submitted via
       * `onAgentProve` — false means the reply is anchored but not yet proven. */
      proven: boolean
      /** The address that called `onAgentProve` for this reply; the zero
       * address if not yet proven. */
      verifier: `0x${string}`
      /** keccak256 of the proof bytes submitted for this reply; a zero
       * bytes32 if not yet proven. */
      verificationDigest: `0x${string}`
    }

export interface ReviewOptions {
  /** What kind of thing `artifact` is — e.g. "shell_command", "code_diff",
   * "trade_order", "general". Free-form; the backend uses it as a hint for
   * which checks apply, not a validated enum. */
  artifactType?: string
  /** Extra context the verdict should weigh (why this action is being
   * proposed, what already happened, constraints the caller knows about). */
  context?: string
  /** Request a signed, independently-verifiable proof alongside the verdict.
   * Defaults to true — the whole point of routing through this client
   * instead of calling an unsigned internal heuristic is to get something
   * you don't have to trust the caller (or invinoveritas) to have reported
   * honestly. Set false only if you genuinely don't need the proof and want
   * to skip the signing step's small latency cost. */
  sign?: boolean
}
