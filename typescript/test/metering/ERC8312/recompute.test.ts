import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  checkStatefulBound,
  checkCursorHeadroom,
  computeRemainingHeadroom,
  verifyRemaining,
} from '../../../src/metering/ERC8312/recompute.js'

// ── Inline golden vectors (primary) ──────────────────────────────────────
// These reproduce the vectors from testkit/vectors/erc8312.vectors.json
// for step "8312/cap-conservation". They are duplicated here so tests pass
// even when the vectors file is not present on disk.

const STATE_BOUND_VECTORS = [
  {
    id: '8312-cap-conservation-holds',
    label: 'holds: reserved=100, confirmed=0, cap=150',
    inputs: { reserved: 100, confirmed: 0, cap: 150 },
    expected: true as const,
  },
  {
    id: '8312-cap-conservation-breach',
    label: 'breach: reserved=100, confirmed=60, cap=150',
    inputs: { reserved: 100, confirmed: 60, cap: 150 },
    expected: false as const,
  },
]

const CURSOR_HEADROOM_VECTORS = [
  {
    id: '8312-cap-conservation-headroom',
    label: 'headroom: aggregate=0, cap=8000',
    inputs: { aggregate: 0, cap: 8000 },
    expected: true as const,
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
    '../../../../testkit/vectors/erc8312.vectors.json',
  )
  if (!existsSync(vectorsPath)) {
    console.warn(
      'testkit vectors not found — skipping file-based conformance check',
    )
    return []
  }
  const raw = readFileSync(vectorsPath, 'utf-8')
  const data = JSON.parse(raw) as { vectors: ConformanceVector[] }
  return data.vectors.filter((v) => v.step === step)
}

describe('checkStatefulBound (ERC-8312 StatefulBound)', () => {
  describe('inline golden vectors', () => {
    for (const vec of STATE_BOUND_VECTORS) {
      it(vec.label, () => {
        expect(
          checkStatefulBound(
            vec.inputs.reserved,
            vec.inputs.confirmed,
            vec.inputs.cap,
          ),
        ).toBe(vec.expected)
      })
    }
  })

  describe('conformance vectors from testkit', () => {
    const fileVectors = loadConformanceVectors('8312/cap-conservation')

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
          // Filter for StatefulBound-type vectors (have reserved/confirmed)
          if (
            'reserved' in vec.inputs &&
            'confirmed' in vec.inputs
          ) {
            const reserved = Number(vec.inputs.reserved)
            const confirmed = Number(vec.inputs.confirmed)
            const cap = Number(vec.inputs.cap)
            const expected = vec.expected as boolean
            expect(checkStatefulBound(reserved, confirmed, cap)).toBe(
              expected,
            )
          } else {
            // Skip headroom-only vectors in this block
            expect(true).toBe(true)
          }
        },
      )
    }
  })

  describe('edge cases', () => {
    it('exact match at cap boundary', () => {
      expect(checkStatefulBound(100, 50, 150)).toBe(true)
    })

    it('exceeds cap by one', () => {
      expect(checkStatefulBound(100, 51, 150)).toBe(false)
    })

    it('zero values within cap', () => {
      expect(checkStatefulBound(0, 0, 0)).toBe(true)
    })
  })
})

describe('checkCursorHeadroom (ERC-8312 Orbmis/headroom)', () => {
  describe('inline golden vectors', () => {
    for (const vec of CURSOR_HEADROOM_VECTORS) {
      it(vec.label, () => {
        expect(
          checkCursorHeadroom(vec.inputs.aggregate, vec.inputs.cap),
        ).toBe(vec.expected)
      })
    }
  })

  describe('conformance vectors from testkit', () => {
    const fileVectors = loadConformanceVectors('8312/cap-conservation')

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
          // Filter for headroom-type vectors (have aggregate field)
          if ('aggregate' in vec.inputs) {
            const aggregate = Number(vec.inputs.aggregate)
            const cap = Number(vec.inputs.cap)
            const expected = vec.expected as boolean
            expect(checkCursorHeadroom(aggregate, cap)).toBe(expected)
          } else {
            // Skip stateful-bound-only vectors in this block
            expect(true).toBe(true)
          }
        },
      )
    }
  })

  describe('edge cases', () => {
    it('aggregate equals cap', () => {
      expect(checkCursorHeadroom(8000, 8000)).toBe(true)
    })

    it('aggregate exceeds cap', () => {
      expect(checkCursorHeadroom(8001, 8000)).toBe(false)
    })

    it('zero aggregate within cap', () => {
      expect(checkCursorHeadroom(0, 0)).toBe(true)
    })
  })

  describe('computeRemainingHeadroom (IBudgetSubstrate)', () => {
    it('normal headroom', () => {
      expect(computeRemainingHeadroom(150, 60)).toBe(90)
    })

    it('exhausted returns zero', () => {
      expect(computeRemainingHeadroom(150, 200)).toBe(0)
    })

    it('full headroom when nothing spent', () => {
      expect(computeRemainingHeadroom(150, 0)).toBe(150)
    })

    it('verify: reported matches recomputed', () => {
      expect(verifyRemaining(150, 60, 90)).toBe(true)
    })

    it('verify: misreport is rejected', () => {
      expect(verifyRemaining(150, 60, 100)).toBe(false)
    })
  })
})
