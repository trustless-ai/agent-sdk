import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { computeVerdictHash } from '../../../src/settlement/ERC8203/recompute.js'
import type { Hex } from 'viem'

// ── Inline golden vectors (primary) ──────────────────────────────────────
// These reproduce the vectors from testkit/vectors/erc8203-settlement-proof.vectors.json
// for step "8203/settlement-proof". They are duplicated here so tests pass even when
// the vectors file is not present on disk.

const INLINE_VECTORS = [
  {
    id: 'settlement-proof-consult',
    label: 'Mainnet settlement (job 0xbc01b40, escrow 0x7057fbA7)',
    inputs: {
      jobId: '0xbc01b40fe7a3509f35470053d4bc1844d50c9782546cf0fc11154adcb90caa56' as Hex,
      resultText: 'No intermediaries required, cryptographic verification only.',
    },
    expected: '0xdc568bd1cbacdd1ead8231e9d3d6f4e475f5168f3cc9f72b31935d46cfdd48f7' as Hex,
  },
]

// ── Conformance vector reader (secondary) ─────────────────────────────────
// Reads testkit's golden vectors as a cross-check that the inline vectors
// haven't drifted from the canonical set.

interface ConformanceVector {
  id: string
  step: string
  spec?: string
  desc?: string
  inputs: Record<string, unknown>
  expected: unknown
}

function loadConformanceVectors(): ConformanceVector[] {
  const vectorsPath = path.resolve(
    fileURLToPath(new URL('.', import.meta.url)),
    '../../../../testkit/vectors/erc8203-settlement-proof.vectors.json',
  )
  if (!existsSync(vectorsPath)) {
    console.warn('testkit vectors not found — skipping file-based conformance check')
    return []
  }
  const raw = readFileSync(vectorsPath, 'utf-8')
  const data = JSON.parse(raw) as { vectors: ConformanceVector[] }
  return data.vectors.filter((v) => v.step === '8203/settlement-proof')
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('computeVerdictHash (ERC-8203 recompute)', () => {
  describe('inline golden vectors', () => {
    for (const vec of INLINE_VECTORS) {
      it(vec.label, () => {
        expect(computeVerdictHash(vec.inputs.jobId, vec.inputs.resultText)).toBe(vec.expected)
      })
    }
  })

  describe('conformance vectors from testkit', () => {
    const fileVectors = loadConformanceVectors()

    if (fileVectors.length === 0) {
      it('(no testkit vectors to check — skipping)', () => {
        // This is a placeholder: the inline tests above are the primary
        // assertions; the file-based check is secondary.
        expect(true).toBe(true)
      })
      return
    }

    for (const vec of fileVectors) {
      it(`${vec.id}: ${vec.desc || vec.spec || '(no description)'}`, () => {
        const jobId = vec.inputs.jobId as Hex
        const resultText = vec.inputs.resultText as string
        const expected = vec.expected as Hex
        expect(computeVerdictHash(jobId, resultText)).toBe(expected)
      })
    }
  })

  describe('edge cases', () => {
    it('handles empty result text', () => {
      const jobId = '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex
      const result = computeVerdictHash(jobId, '')
      // Must be deterministic and 32 bytes
      expect(result).toHaveLength(66)
      expect(result.startsWith('0x')).toBe(true)
    })

    it('handles result text with special characters (unicode)', () => {
      const jobId = '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex
      const result = computeVerdictHash(jobId, 'Hello 世界 !@#$%')
      expect(result).toHaveLength(66)
      expect(result.startsWith('0x')).toBe(true)
    })

    it('produces deterministic output for same inputs', () => {
      const jobId = '0xbc01b40fe7a3509f35470053d4bc1844d50c9782546cf0fc11154adcb90caa56' as Hex
      const resultText = 'No intermediaries required, cryptographic verification only.'
      const hash1 = computeVerdictHash(jobId, resultText)
      const hash2 = computeVerdictHash(jobId, resultText)
      expect(hash1).toBe(hash2)
    })

    it('different jobId produces different verdict hash', () => {
      const text = 'same text'
      const hash1 = computeVerdictHash(
        '0x0000000000000000000000000000000000000000000000000000000000000001' as Hex,
        text,
      )
      const hash2 = computeVerdictHash(
        '0x0000000000000000000000000000000000000000000000000000000000000002' as Hex,
        text,
      )
      expect(hash1).not.toBe(hash2)
    })

    it('different result text produces different verdict hash', () => {
      const jobId = '0x0000000000000000000000000000000000000000000000000000000000000001' as Hex
      expect(computeVerdictHash(jobId, 'text A')).not.toBe(computeVerdictHash(jobId, 'text B'))
    })
  })
})
