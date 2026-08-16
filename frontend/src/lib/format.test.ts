import { describe, expect, it } from 'vitest'
import {
  formatDate,
  formatMinor,
  formatMinorNumber,
  formatNumber,
  formatPercent,
  fullName,
  minorToMajor,
  titleCase,
  weekdayLabel,
} from './format'

const UTC: { timezone: string; locale: string } = { timezone: 'UTC', locale: 'en-US' }

describe('formatMinor', () => {
  it('formats a two-decimal currency with grouping', () => {
    expect(formatMinor(123456, 'USD')).toBe('USD 1,234.56')
    expect(formatMinor(5, 'USD')).toBe('USD 0.05')
  })

  it('formats a zero-decimal currency without a fraction', () => {
    expect(formatMinor(123456, 'JPY')).toBe('JPY 123,456')
  })

  it('handles negative amounts with a leading sign', () => {
    expect(formatMinor(-1234, 'USD')).toBe('-USD 12.34')
  })

  it('renders an em dash for null/undefined/non-finite', () => {
    expect(formatMinor(null, 'USD')).toBe('\u2014')
    expect(formatMinor(undefined, 'USD')).toBe('\u2014')
    expect(formatMinor('nope', 'USD')).toBe('\u2014')
  })
})

describe('formatMinorNumber', () => {
  it('strips the currency code', () => {
    expect(formatMinorNumber(123456, 'USD')).toBe('1,234.56')
  })
})

describe('formatDate', () => {
  it('formats an ISO date in the school timezone', () => {
    expect(formatDate('2024-01-15', UTC)).toBe('Jan 15, 2024')
  })

  it('renders an em dash for missing or invalid input', () => {
    expect(formatDate(null, UTC)).toBe('\u2014')
    expect(formatDate('not-a-date', UTC)).toBe('\u2014')
  })
})

describe('weekdayLabel', () => {
  it('maps 1..7 to short labels', () => {
    expect(weekdayLabel(1)).toBe('Mon')
    expect(weekdayLabel(7)).toBe('Sun')
  })

  it('supports long labels', () => {
    expect(weekdayLabel(1, true)).toBe('Monday')
  })

  it('falls back to the raw value out of range', () => {
    expect(weekdayLabel(8)).toBe('8')
    expect(weekdayLabel(9)).toBe('9')
  })
})

describe('titleCase', () => {
  it('capitalizes underscore- and space-separated words', () => {
    expect(titleCase('late_fee')).toBe('Late Fee')
    expect(titleCase('partial payment')).toBe('Partial Payment')
  })
})

describe('fullName', () => {
  it('joins first and last names', () => {
    expect(fullName('Ada', 'Lovelace')).toBe('Ada Lovelace')
  })

  it('falls back to an em dash when empty', () => {
    expect(fullName(null, null)).toBe('\u2014')
    expect(fullName('Ada', undefined)).toBe('Ada')
  })
})

describe('formatPercent', () => {
  it('formats a percentage to the given precision', () => {
    expect(formatPercent(12.5, 1)).toBe('12.5%')
    expect(formatPercent(50)).toBe('50.0%')
  })

  it('renders an em dash for null/undefined', () => {
    expect(formatPercent(null)).toBe('\u2014')
  })
})

describe('formatNumber', () => {
  it('groups thousands', () => {
    expect(formatNumber(1234567)).toBe('1,234,567')
  })
})

describe('minorToMajor', () => {
  it('converts minor units to major units', () => {
    expect(minorToMajor(123456, 'USD')).toBe(1234.56)
    expect(minorToMajor(123456, 'JPY')).toBe(123456)
  })

  it('returns 0 for null/undefined', () => {
    expect(minorToMajor(null, 'USD')).toBe(0)
  })
})
