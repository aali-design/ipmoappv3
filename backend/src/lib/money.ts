import { divRoundHalfUpBigInt } from './rounding.js'

/**
 * Money is integer minor units (bigint) everywhere (spec §7). No floats.
 * A percent value (numeric(7,2), e.g. 12.50) is parsed to basis points
 * (12.50 -> 1250) so `percentOfMinor(amount, bp)` stays exact.
 */

export type MinorUnits = bigint

/** Parse a numeric string/number like "12.50" or 12.5 into integer basis points. */
export function percentToBasisPoints(value: string | number): bigint {
  const s = String(value).trim()
  if (s === '') return 0n
  const neg = s.startsWith('-')
  const body = neg ? s.slice(1) : s
  const [intPart, fracPartRaw] = body.split('.')
  const frac = (fracPartRaw ?? '').padEnd(2, '0').slice(0, 2)
  const bp = BigInt((intPart || '0') + frac.padStart(2, '0'))
  return neg ? -bp : bp
}

/** Apply a percent (in basis points) to an amount, rounding half-up to the minor unit. */
export function applyPercentMinor(amount: MinorUnits, basisPoints: bigint): MinorUnits {
  return divRoundHalfUpBigInt(amount * basisPoints, 10000n)
}

/** Apply a fixed discount value (already in minor units). */
export function applyFixedMinor(amount: MinorUnits, valueMinor: MinorUnits): MinorUnits {
  return valueMinor > amount ? amount : valueMinor
}

/** Sum an array of bigints. */
export function sumMinor(values: readonly MinorUnits[]): MinorUnits {
  return values.reduce((acc, v) => acc + v, 0n)
}
