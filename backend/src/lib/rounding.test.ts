import { describe, expect, it } from 'vitest'
import { divRoundHalfUp, divRoundHalfUpBigInt, roundHalfUp } from './rounding.js'

describe('rounding — divRoundHalfUpBigInt', () => {
  it('rounds half-up', () => {
    expect(divRoundHalfUpBigInt(5n, 2n)).toBe(3n) // 2.5 → 3
    expect(divRoundHalfUpBigInt(4n, 2n)).toBe(2n)
    expect(divRoundHalfUpBigInt(1n, 3n)).toBe(0n)
    expect(divRoundHalfUpBigInt(2n, 3n)).toBe(1n) // 0.667 → 1
    expect(divRoundHalfUpBigInt(1n, 2n)).toBe(1n) // 0.5 → 1
    expect(divRoundHalfUpBigInt(499500n, 10000n)).toBe(50n) // 49.95 → 50
  })

  it('rejects a zero denominator', () => {
    expect(() => divRoundHalfUpBigInt(1n, 0n)).toThrow()
  })
})

describe('rounding — divRoundHalfUp (number)', () => {
  it('rounds half-up', () => {
    expect(divRoundHalfUp(5, 2)).toBe(3)
    expect(divRoundHalfUp(1, 3)).toBe(0)
    expect(divRoundHalfUp(2, 3)).toBe(1)
    expect(divRoundHalfUp(1, 2)).toBe(1)
  })
})

describe('rounding — roundHalfUp to decimals', () => {
  it('rounds to 2 decimals half-up', () => {
    expect(roundHalfUp(1.234, 2)).toBe(1.23)
    expect(roundHalfUp(1.235, 2)).toBe(1.24)
    expect(roundHalfUp(95.652, 2)).toBe(95.65)
    expect(roundHalfUp(83.333, 2)).toBe(83.33)
  })
})
