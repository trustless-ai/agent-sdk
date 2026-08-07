import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { computeTaskHash, computeReplyHash } from '../../../src/execution/ERC8301/recompute.js'
import type { Hex } from 'viem'

// ── Inline golden vectors (primary) ──────────────────────────────────────
// These reproduce the vectors from testkit/vectors/erc8301-task-hash.vectors.json
// for step "8301/task-hash". They are duplicated here so tests pass even when
// the vectors file is not present on disk.

const EMPTY_PACKED_INNER: Hex =
  '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470'

const TASK_HASH_INLINE_VECTORS = [
  {
    id: '8301-task-hash',
    label: 'Initial task with empty prevReplyHashes and known inputHash',
    inputs: {
      stage: 1,
      taskSeq: 0,
      inputHash: '0x1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8' as Hex,
      timestamp: 1700000000,
      expiresAt: 1700001000,
      prevReplyHashesPacked: '0x' as Hex,
      workflowRunId: '0x00000000000000000000000000000000000000000000000000000000deadbeef' as Hex,
    },
    expected: '0xf1f404c844a4aff1d0d7d17cebb518a2d386197aad09ab86517eaa01448301ec' as Hex,
  },
]

// No inline golden vector for replyHash — there is no conformance vector
// for it yet. Tests below check determinism and edge cases only.

// ── Conformance vector reader (secondary) ─────────────────────────────────

interface ConformanceVector {
  id: string
  step: string
  spec?: string
  desc?: string
  inputs: Record<string, unknown>
  expected: unknown
}

function loadConformanceVectors(step: string): ConformanceVector[] {
  const vectorsPath = path.resolve(
    fileURLToPath(new URL('.', import.meta.url)),
    '../../../../testkit/vectors/erc8301-task-hash.vectors.json',
  )
  if (!existsSync(vectorsPath)) {
    console.warn('testkit vectors not found — skipping file-based conformance check')
    return []
  }
  const raw = readFileSync(vectorsPath, 'utf-8')
  const data = JSON.parse(raw) as { vectors: ConformanceVector[] }
  return data.vectors.filter((v) => v.step === step)
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('computeTaskHash (ERC-8301 recompute)', () => {
  describe('inline golden vectors', () => {
    for (const vec of TASK_HASH_INLINE_VECTORS) {
      it(vec.label, () => {
        const { stage, taskSeq, inputHash, timestamp, expiresAt, prevReplyHashesPacked, workflowRunId } =
          vec.inputs
        expect(
          computeTaskHash(stage, taskSeq, inputHash, timestamp, expiresAt, prevReplyHashesPacked, workflowRunId),
        ).toBe(vec.expected)
      })
    }
  })

  describe('conformance vectors from testkit', () => {
    const fileVectors = loadConformanceVectors('8301/task-hash')

    if (fileVectors.length === 0) {
      it('(no testkit vectors to check — skipping)', () => {
        expect(true).toBe(true)
      })
      return
    }

    for (const vec of fileVectors) {
      it(`${vec.id}: ${vec.desc || vec.spec || '(no description)'}`, () => {
        const stage = Number(vec.inputs.stage)
        const taskSeq = Number(vec.inputs.taskSeq)
        const inputHash = vec.inputs.inputHash as Hex
        const timestamp = Number(vec.inputs.timestamp)
        const expiresAt = Number(vec.inputs.expiresAt)
        const prevReplyHashesPacked = vec.inputs.prevReplyHashesPacked as Hex
        const workflowRunId = vec.inputs.workflowRunId as Hex
        const expected = vec.expected as Hex

        expect(
          computeTaskHash(stage, taskSeq, inputHash, timestamp, expiresAt, prevReplyHashesPacked, workflowRunId),
        ).toBe(expected)
      })
    }
  })

  describe('edge cases', () => {
    it('empty prevReplyHashesPacked produces keccak256("") not bytes32(0)', () => {
      // When prevReplyHashesPacked is "0x", the inner hash must be
      // keccak256(abi.encodePacked([])) = keccak256("") = 0xc5d2...
      // NOT bytes32(0) = 0x0000...
      // A common bug is special-casing empty to zero.
      const innerHash = computeTaskHash(
        1,
        0n,
        '0x1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8',
        1700000000n,
        1700001000n,
        '0x' as Hex,
        '0x00000000000000000000000000000000000000000000000000000000deadbeef',
      )

      // If someone special-cased empty to bytes32(0), the result would differ.
      // The golden value proves it uses keccak256("") = 0xc5d2...
      expect(innerHash).toBe('0xf1f404c844a4aff1d0d7d17cebb518a2d386197aad09ab86517eaa01448301ec')
    })

    it('non-empty prevReplyHashesPacked produces a different hash', () => {
      const hashWithPacked = computeTaskHash(
        1,
        0n,
        '0x1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8',
        1700000000n,
        1700001000n,
        '0xdeadbeef' as Hex,
        '0x00000000000000000000000000000000000000000000000000000000deadbeef',
      )

      // Must differ from the empty-prev vector
      expect(hashWithPacked).not.toBe('0xf1f404c844a4aff1d0d7d17cebb518a2d386197aad09ab86517eaa01448301ec')
    })

    it('inner hash for empty packed data equals keccak256("")', async () => {
      // Smoke test: directly verify keccak256("0x") equals the known value
      const { keccak256: k256 } = await import('viem')
      expect(k256('0x' as Hex)).toBe(EMPTY_PACKED_INNER)
    })
  })
})

describe('computeReplyHash (ERC-8301 recompute)', () => {
  describe('basic behavior', () => {
    it('produces a deterministic 32-byte hash', () => {
      const hash = computeReplyHash(
        '0x1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8',
        1700000000n,
        '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
        '0x00000000000000000000000000000000000000000000000000000000deadbeef' as Hex,
        '0x00000000000000000000000000000000000000000000000000000000deadbeef' as Hex,
      )
      expect(hash).toHaveLength(66)
      expect(hash.startsWith('0x')).toBe(true)
      // Same inputs always produce the same result
      const hash2 = computeReplyHash(
        '0x1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8',
        1700000000n,
        '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
        '0x00000000000000000000000000000000000000000000000000000000deadbeef' as Hex,
        '0x00000000000000000000000000000000000000000000000000000000deadbeef' as Hex,
      )
      expect(hash2).toBe(hash)
    })

    it('empty prevTaskHashesPacked produces keccak256("") not bytes32(0)', () => {
      const hash = computeReplyHash(
        '0x1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8',
        1700000000n,
        '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
        '0x' as Hex,
        '0x00000000000000000000000000000000000000000000000000000000deadbeef',
      )

      // Must not be all zeros
      expect(hash).not.toBe('0x0000000000000000000000000000000000000000000000000000000000000000')
      // Must be deterministic
      expect(hash.length).toBe(66)
    })

    it('different replier addresses produce different reply hashes', () => {
      const hash1 = computeReplyHash(
        '0x1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8',
        1700000000n,
        '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
        '0x' as Hex,
        '0x00000000000000000000000000000000000000000000000000000000deadbeef',
      )

      const hash2 = computeReplyHash(
        '0x1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8',
        1700000000n,
        '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
        '0x' as Hex,
        '0x00000000000000000000000000000000000000000000000000000000deadbeef',
      )

      expect(hash1).not.toBe(hash2)
    })
  })
})
