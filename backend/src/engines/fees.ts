import { applyPercentMinor, percentToBasisPoints } from '../lib/money.js'

/**
 * FEES ENGINE (spec §7) — pure money math. All amounts are integer minor units
 * (bigint); percent discounts round half-up to the minor unit.
 */

export interface DiscountDef {
  kind: 'percent' | 'fixed'
  /** percent: basis points; fixed: minor units */
  valueBp: bigint
  valueMinor: bigint
  appliesToCategory: string | null
}

export interface FeeLineInput {
  category: string
  description: string
  unitAmountMinor: bigint
  quantity: number
}

export interface ComputedLine {
  category: string
  description: string
  quantity: number
  unitAmountMinor: bigint
  grossMinor: bigint
  discountMinor: bigint
  lineTotalMinor: bigint
}

/** Parse a discount's numeric(7,2) `value` into basis points / minor units. */
export function discountValue(def: { kind: 'percent' | 'fixed'; value: string | number }): {
  valueBp: bigint
  valueMinor: bigint
} {
  const bp = percentToBasisPoints(def.value)
  if (def.kind === 'percent') return { valueBp: bp, valueMinor: 0n }
  return { valueBp: 0n, valueMinor: bp }
}

/** Sort discounts: fixed before percent, category-scoped before global. */
function rank(def: DiscountDef): number {
  const kindRank = def.kind === 'fixed' ? 0 : 1
  const scopeRank = def.appliesToCategory ? 0 : 1
  return kindRank * 2 + scopeRank
}

/** Apply a discount to a remaining amount, returning the discount minor units. */
function applyOne(def: DiscountDef, remaining: bigint): bigint {
  if (remaining <= 0n) return 0n
  if (def.kind === 'fixed') {
    return def.valueMinor > remaining ? remaining : def.valueMinor
  }
  return applyPercentMinor(remaining, def.valueBp)
}

/** Total discount for a line of a given category. */
export function discountForLine(
  lineCategory: string,
  grossMinor: bigint,
  discounts: DiscountDef[],
): bigint {
  const applicable = discounts
    .filter((d) => d.appliesToCategory === null || d.appliesToCategory === lineCategory)
    .sort((a, b) => rank(a) - rank(b))
  let remaining = grossMinor
  let total = 0n
  for (const d of applicable) {
    const dVal = applyOne(d, remaining)
    remaining -= dVal
    total += dVal
  }
  return total
}

export function computeLines(
  lines: FeeLineInput[],
  discounts: DiscountDef[],
): ComputedLine[] {
  return lines.map((l) => {
    const grossMinor = l.unitAmountMinor * BigInt(Math.max(0, l.quantity))
    const discountMinor = discountForLine(l.category, grossMinor, discounts)
    return {
      category: l.category,
      description: l.description,
      quantity: Math.max(0, l.quantity),
      unitAmountMinor: l.unitAmountMinor,
      grossMinor,
      discountMinor,
      lineTotalMinor: grossMinor - discountMinor,
    }
  })
}

export function totals(computed: ComputedLine[]): {
  subtotalMinor: bigint
  discountMinor: bigint
  totalMinor: bigint
} {
  let subtotal = 0n
  let discount = 0n
  for (const l of computed) {
    subtotal += l.grossMinor
    discount += l.discountMinor
  }
  return { subtotalMinor: subtotal, discountMinor: discount, totalMinor: subtotal - discount }
}
