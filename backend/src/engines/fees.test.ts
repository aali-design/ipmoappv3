import { describe, expect, it } from 'vitest'
import {
  computeLines,
  discountForLine,
  discountValue,
  totals,
} from './fees.js'
import type { DiscountDef } from './fees.js'

describe('fees engine — discount value parsing', () => {
  it('parses percent values into basis points', () => {
    expect(discountValue({ kind: 'percent', value: '10.00' })).toEqual({ valueBp: 1000n, valueMinor: 0n })
    expect(discountValue({ kind: 'percent', value: 5 })).toEqual({ valueBp: 500n, valueMinor: 0n })
  })

  it('parses fixed values into minor units', () => {
    expect(discountValue({ kind: 'fixed', value: '500.00' })).toEqual({ valueBp: 0n, valueMinor: 50000n })
  })
})

describe('fees engine — percent discount rounding (half-up)', () => {
  it('rounds a 5% discount half-up to the minor unit', () => {
    // 5% of 999 minor units = 49.95 → 50
    const discounts: DiscountDef[] = [
      { kind: 'percent', valueBp: 500n, valueMinor: 0n, appliesToCategory: null },
    ]
    expect(discountForLine('tuition', 999n, discounts)).toBe(50n)
    expect(discountForLine('tuition', 10000n, discounts)).toBe(500n)
  })
})

describe('fees engine — discount ordering', () => {
  it('applies fixed before percent', () => {
    const discounts: DiscountDef[] = [
      { kind: 'percent', valueBp: 1000n, valueMinor: 0n, appliesToCategory: null },
      { kind: 'fixed', valueBp: 0n, valueMinor: 5000n, appliesToCategory: null },
    ]
    // fixed first: 100000 - 5000 = 95000; then 10% of 95000 = 9500 → total 14500
    expect(discountForLine('tuition', 100000n, discounts)).toBe(14500n)
  })
})

describe('fees engine — line computation and totals', () => {
  it('computes per-line discounts and totals', () => {
    const lines = [
      { category: 'tuition', description: 'Tuition', unitAmountMinor: 50000n, quantity: 1 },
      { category: 'transport', description: 'Bus', unitAmountMinor: 10000n, quantity: 1 },
    ]
    const discounts: DiscountDef[] = [
      { kind: 'percent', valueBp: 1000n, valueMinor: 0n, appliesToCategory: null },
    ]
    const computed = computeLines(lines, discounts)
    expect(computed[0].grossMinor).toBe(50000n)
    expect(computed[0].discountMinor).toBe(5000n)
    expect(computed[0].lineTotalMinor).toBe(45000n)

    const t = totals(computed)
    expect(t.subtotalMinor).toBe(60000n)
    expect(t.discountMinor).toBe(6000n)
    expect(t.totalMinor).toBe(54000n)
  })

  it('respects monthly quantities', () => {
    const lines = [
      { category: 'tuition', description: 'Tuition', unitAmountMinor: 10000n, quantity: 3 },
    ]
    const computed = computeLines(lines, [])
    expect(computed[0].grossMinor).toBe(30000n)
  })
})
