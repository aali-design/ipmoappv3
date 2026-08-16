import { describe, expect, it } from 'vitest'
import {
  applyFixedMinor,
  applyPercentMinor,
  percentToBasisPoints,
  sumMinor,
} from './money.js'

describe('money — percentToBasisPoints', () => {
  it('parses numeric values into basis points', () => {
    expect(percentToBasisPoints('12.50')).toBe(1250n)
    expect(percentToBasisPoints('5')).toBe(500n)
    expect(percentToBasisPoints(5)).toBe(500n)
    expect(percentToBasisPoints('0.05')).toBe(5n)
    expect(percentToBasisPoints('')).toBe(0n)
  })
})

describe('money — applyPercentMinor', () => {
  it('applies a percentage with half-up rounding to the minor unit', () => {
    expect(applyPercentMinor(10000n, 500n)).toBe(500n) // 5%
    expect(applyPercentMinor(999n, 500n)).toBe(50n) // 49.95 → 50
  })
})

describe('money — applyFixedMinor', () => {
  it('caps a fixed discount at the amount', () => {
    expect(applyFixedMinor(10000n, 2000n)).toBe(2000n)
    expect(applyFixedMinor(100n, 200n)).toBe(100n)
  })
})

describe('money — sumMinor', () => {
  it('sums minor units', () => {
    expect(sumMinor([1n, 2n, 3n])).toBe(6n)
    expect(sumMinor([])).toBe(0n)
  })
})
