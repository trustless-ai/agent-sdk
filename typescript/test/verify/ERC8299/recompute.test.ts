import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { computeRawInputHash, computeSanitizationPipelineHash } from '../../../src/verify/ERC8299/recompute.js'

// ── Inline golden vectors (primary) ──────────────────────────────────────
// These reproduce the vectors from testkit/vectors/erc8299-wyriwe.vectors.json
// for steps "wyriwe/raw" and "wyriwe/pipeline". They are duplicated here so
// tests pass even when the vectors file is not present on disk.

const RAW_VECTORS = [
  {
    id: 'wyriwe-raw',
    label: 'raw_input_hash = keccak256(raw_user_input) for "hello"',
    inputs: { raw_input_hex: '0x68656c6c6f' as const },
    expected: '0x1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8' as const,
  },
]

const PIPELINE_VECTORS = [
  {
    id: 'wyriwe-pipeline',
    label: 'sanitization_pipeline_hash = keccak256(utf8(cid) || raw_input_hash)',
    inputs: {
      spec_cid: 'ipfs://QmccvoM6aRVgZ2dtFWvT6Wm3DmTvoAUHHotK7uQufnStVR',
      raw_input_hash: '0x1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8' as const,
    },
    expected: '0x5798efed4aa92f96a0622fc30268042b067294bdb5fd06f599bf8d84fd5d734b' as const,
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
}

function loadConformanceVectors(step: string): ConformanceVector[] {
  const vectorsPath = path.resolve(
    fileURLToPath(new URL('.', import.meta.url)),
    '../../../../testkit/vectors/erc8299-wyriwe.vectors.json',
  )
  if (!existsSync(vectorsPath)) {
    console.warn('testkit vectors not found — skipping file-based conformance check')
    return []
  }
  const raw = readFileSync(vectorsPath, 'utf-8')
  const data = JSON.parse(raw) as { vectors: ConformanceVector[] }
  return data.vectors.filter((v) => v.step === step)
}

describe('ERC-8299 recompute functions', () => {
  describe('computeRawInputHash (wyriwe/raw)', () => {
    describe('inline golden vectors', () => {
      for (const vec of RAW_VECTORS) {
        it(vec.label, () => {
          expect(computeRawInputHash(vec.inputs.raw_input_hex)).toBe(vec.expected)
        })
      }
    })

    describe('conformance vectors from testkit', () => {
      const fileVectors = loadConformanceVectors('wyriwe/raw')

      if (fileVectors.length === 0) {
        it('(no testkit vectors to check — skipping)', () => {
          expect(true).toBe(true)
        })
        return
      }

      for (const vec of fileVectors) {
        it(`${vec.id}: ${vec.desc || vec.spec || '(no description)'}`, () => {
          const rawInputHex = vec.inputs.raw_input_hex as string
          const expected = vec.expected as string
          expect(computeRawInputHash(rawInputHex as `0x${string}`)).toBe(expected)
        })
      }
    })

    describe('edge cases', () => {
      it('handles empty input', () => {
        const result = computeRawInputHash('0x')
        expect(result).toBe('0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470')
      })

      it('handles single byte', () => {
        const result = computeRawInputHash('0x00')
        // Should be a valid 32-byte hash, distinct from empty input hash
        expect(result).not.toBe(computeRawInputHash('0x'))
        expect(result.startsWith('0x')).toBe(true)
        expect(result.length).toBe(66)
      })
    })
  })

  describe('computeSanitizationPipelineHash (wyriwe/pipeline)', () => {
    describe('inline golden vectors', () => {
      for (const vec of PIPELINE_VECTORS) {
        it(vec.label, () => {
          expect(
            computeSanitizationPipelineHash(vec.inputs.spec_cid, vec.inputs.raw_input_hash),
          ).toBe(vec.expected)
        })
      }
    })

    describe('conformance vectors from testkit', () => {
      const fileVectors = loadConformanceVectors('wyriwe/pipeline')

      if (fileVectors.length === 0) {
        it('(no testkit vectors to check — skipping)', () => {
          expect(true).toBe(true)
        })
        return
      }

      for (const vec of fileVectors) {
        it(`${vec.id}: ${vec.desc || vec.spec || '(no description)'}`, () => {
          const specCid = vec.inputs.spec_cid as string
          const rawInputHash = vec.inputs.raw_input_hash as string
          const expected = vec.expected as string
          expect(
            computeSanitizationPipelineHash(specCid, rawInputHash as `0x${string}`),
          ).toBe(expected)
        })
      }
    })

    describe('edge cases', () => {
      it('handles with empty cid', () => {
        const rawHash = '0x1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8' as const
        const result = computeSanitizationPipelineHash('', rawHash)
        // keccak256(utf8('') || 0x1c8a...)
        expect(result).toBeDefined()
        expect(result.startsWith('0x')).toBe(true)
      })

      it('produces different result for different cid', () => {
        const rawHash = '0x1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8' as const
        const result1 = computeSanitizationPipelineHash('cid:a', rawHash)
        const result2 = computeSanitizationPipelineHash('cid:b', rawHash)
        expect(result1).not.toBe(result2)
      })
    })
  })
})
