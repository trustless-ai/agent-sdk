import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { computeWinRate } from '../../../src/reputation/ERC8275/recompute.js'
import { WIN_RATE_BPS_V0_HASH } from '../../../src/reputation/ERC8275/conventions.js'

// ── Inline golden vectors (primary) ──────────────────────────────────────
// These reproduce the vectors from testkit/vectors/erc8275-reputation-bps-v0.vectors.json
// for step "8275/reputation-bps". They are duplicated here so tests pass even
// when the vectors file is not present on disk.

const INLINE_VECTORS = [
  {
    id: '8275-reputation',
    label: 'computeWinRate with 16 wins, 15 losses → 5161 basis points (0.5161)',
    inputs: { wins: 16, losses: 15 },
    expected: 5161,
  },
]

// ── Conformance vector reader (secondary) ─────────────────────────────────

interface ConformanceVector {
  id: string
  step: string
  spec?: string
  desc?: string
  inputs: Record<string, unknown>
  expected: unknown
  governing_convention_hash: string
}

function loadConformanceVectors(): ConformanceVector[] {
  const vectorsPath = path.resolve(
    fileURLToPath(new URL('.', import.meta.url)),
    '../../../../testkit/vectors/erc8275-reputation-bps-v0.vectors.json',
  )
  if (!existsSync(vectorsPath)) {
    console.warn(
      'testkit vectors not found — skipping file-based conformance check',
    )
    return []
  }
  const raw = readFileSync(vectorsPath, 'utf-8')
  const data = JSON.parse(raw) as { vectors: ConformanceVector[] }
  return data.vectors.filter((v) => v.step === '8275/reputation-bps')
}

describe('computeWinRate (ERC-8275 recompute)', () => {
  describe('inline golden vectors', () => {
    for (const vec of INLINE_VECTORS) {
      it(vec.label, () => {
        expect(computeWinRate(vec.inputs.wins, vec.inputs.losses)).toBe(
          vec.expected,
        )
      })
    }
  })

  describe('conformance vectors from testkit', () => {
    const fileVectors = loadConformanceVectors()

    if (fileVectors.length === 0) {
      it('(no testkit vectors to check — skipping)', () => {
        expect(true).toBe(true)
      })
      return
    }

    for (const vec of fileVectors) {
      it(
        `${vec.id}: ${vec.desc || vec.spec || '(no description)'}`,
        () => {
          const wins = Number(vec.inputs.commit_gated_wins)
          const losses = Number(vec.inputs.commit_gated_losses)
          expect(vec.governing_convention_hash).toBe(WIN_RATE_BPS_V0_HASH)
          const expected = vec.expected as number
          expect(computeWinRate(wins, losses)).toBe(expected)
        },
      )
    }
  })

  describe('edge cases', () => {
    it('handles zero wins (non-zero losses)', () => {
      expect(computeWinRate(0, 15)).toBe(0)
    })

    it('handles zero losses (non-zero wins)', () => {
      expect(computeWinRate(16, 0)).toBe(10000)
    })

    it('integer division truncates (1/3 = 3333 bps)', () => {
      expect(computeWinRate(1, 2)).toBe(3333)
    })

    it('throws when both wins and losses are zero', () => {
      expect(() => computeWinRate(0, 0)).toThrow()
    })
  })
})
