/**
 * Shared rounding helpers — the ONLY place half-up rounding is defined.
 * Spec §6/§7: rounding is half-up to 2 decimals at each stored step, and
 * percent discounts round half-up to the minor unit. Every call site must use
 * these helpers, never a local reimplementation.
 */

/** Half-up division of two non-negative bigints. */
export function divRoundHalfUpBigInt(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error('divRoundHalfUp: denominator must be > 0')
  if (numerator < 0n) throw new Error('divRoundHalfUp: numerator must be >= 0')
  const q = numerator / denominator
  const r = numerator % denominator
  return q + (2n * r >= denominator ? 1n : 0n)
}

/** Half-up division of two non-negative numbers, returning a number. */
export function divRoundHalfUp(numerator: number, denominator: number): number {
  if (denominator <= 0) throw new Error('divRoundHalfUp: denominator must be > 0')
  return Math.floor((numerator * 2 + denominator) / (2 * denominator))
}

/** Round a number half-up to `decimals` places. */
export function roundHalfUp(value: number, decimals = 2): number {
  const factor = 10 ** decimals
  return Math.round((value + Number.EPSILON) * factor) / factor
}
