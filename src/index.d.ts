// Type surface for @onchain-ai/agent-sdk (v0.1).

export interface VerifyResult {
  valid: boolean;
  checks: Record<string, boolean>;
  proof_payload?: any;
  error?: string;
  how_to_verify?: string;
}

export interface VerifyOpts {
  /** x-only hex of the issuer you require (authorship gate). Omit to skip. */
  expectPubkey?: string;
  /** require content.schema to start with this, e.g. "onchain-ai." */
  schemaPrefix?: string;
}

export interface CommitSpec {
  job_id?: string;
  [k: string]: unknown;
}

export interface BuiltCommit {
  /** Unsigned event (no `sig`) — caller signs with their own key management. */
  event: Record<string, any>;
  id: string;
  artifact_hash: string;
}

export interface FullFlowResult {
  /** valid && artifact_hash_matches && anchored. Escrow ALSO checks on-chain delivery. */
  ok: boolean;
  valid: boolean;
  artifact_hash_matches: boolean;
  anchored: boolean;
  verify: VerifyResult;
  note: string;
}

export function verifyProof(event: object, opts?: VerifyOpts): VerifyResult;
export function nostrEventId(ev: object): string;
export function artifactHash(spec: CommitSpec): string;
export function canonical(value: unknown): string;
export function buildCommitEvent(p: {
  spec: CommitSpec;
  pubkey: string;
  judgmentType: string;
  schema?: string;
  createdAt?: number;
}): BuiltCommit;
export function verifyFullFlow(p: {
  proofEvent: object;
  expectArtifactHash: string;
  expectPubkey?: string;
  schemaPrefix?: string;
  relaySeen?: boolean;
  otsVerified?: boolean;
}): FullFlowResult;
export function recompute(events: object[], opts?: VerifyOpts): {
  total: number; valid: number; entries: Array<Record<string, any>>;
};
export const PROOF_KIND: number;
export const CORE: { name: string; verifies_like: string; proof_kind: number };
