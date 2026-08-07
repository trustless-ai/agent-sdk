import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { computeAgentId } from '../../../src/identity/ERC8004/recompute.js'

// ── Inline golden vectors (primary) ──────────────────────────────────────
// These reproduce the vectors from testkit/vectors/erc8004-agent-id.vectors.json
// for step "8004/agent-id". They are duplicated here so tests pass even when
// the vectors file is not present on disk.

const INLINE_VECTORS = [
  {
    id: '8004-agent-id-wizgob',
    label: 'Wizgob = ERC-8004 registry id 860',
    inputs: { registryId: 860 },
    expected: '0x000000000000000000000000000000000000000000000000000000000000035c' satisfies `0x${string}`,
  },
  {
    id: '8004-agent-id-ours',
    label: 'our dinamic.eth registry id 54848',
    inputs: { registryId: 54848 },
    expected: '0x000000000000000000000000000000000000000000000000000000000000d640' satisfies `0x${string}`,
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
    '../../../../testkit/vectors/erc8004-agent-id.vectors.json',
  )
  if (!existsSync(vectorsPath)) {
    console.warn('testkit vectors not found — skipping file-based conformance check')
    return []
  }
  const raw = readFileSync(vectorsPath, 'utf-8')
  const data = JSON.parse(raw) as { vectors: ConformanceVector[] }
  return data.vectors.filter((v) => v.step === '8004/agent-id')
}

describe('computeAgentId (ERC-8004 recompute)', () => {
  describe('inline golden vectors', () => {
    for (const vec of INLINE_VECTORS) {
      it(vec.label, () => {
        expect(computeAgentId(vec.inputs.registryId)).toBe(vec.expected)
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
        const registryId = Number(vec.inputs.registryId)
        const expected = vec.expected as string
        expect(computeAgentId(registryId)).toBe(expected)
      })
    }
  })

  describe('edge cases', () => {
    it('handles registry id 0 (zero)', () => {
      expect(computeAgentId(0)).toBe('0x0000000000000000000000000000000000000000000000000000000000000000')
    })

    it('handles large registry ids', () => {
      const maxUint = BigInt('0xffffffffffffffffffffffffffffffff')
      const result = computeAgentId(maxUint)
      expect(result).toBe('0x00000000000000000000000000000000ffffffffffffffffffffffffffffffff')
    })

    it('handles registry id 1', () => {
      expect(computeAgentId(1)).toBe('0x0000000000000000000000000000000000000000000000000000000000000001')
    })
  })
})
