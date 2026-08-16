/**
 * Formatting helpers — money, dates and percentages.
 *
 * Money is stored as integer minor units (`bigint`/number) and is never
 * reconstructed by float division (spec §7, §9). Dates are rendered in the
 * school timezone, never the browser's.
 */

// Currencies with zero decimal places (ISO 4217). Everything else is 2.
const ZERO_DECIMAL_CURRENCIES = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF',
  'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
])

function minorFactor(currency: string): number {
  return ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase()) ? 1 : 100
}

/**
 * Format an integer minor-unit amount as a currency string.
 * e.g. formatMinor(123456, 'USD') -> "USD 1,234.56"
 * e.g. formatMinor(123456, 'JPY') -> "JPY 123,456"
 * Uses integer arithmetic only — no floating point.
 */
export function formatMinor(minor: number | string | null | undefined, currency: string, locale = 'en-US'): string {
  if (minor === null || minor === undefined) return '\u2014'
  const value = typeof minor === 'string' ? Number(minor) : minor
  if (!Number.isFinite(value)) return '\u2014'
  const factor = minorFactor(currency)
  const sign = value < 0 ? '-' : ''
  const abs = Math.round(Math.abs(value))
  const whole = Math.trunc(abs / factor)
  const frac = abs % factor
  const grouped = whole.toLocaleString(locale, { useGrouping: true })
  const fracStr = factor === 1 ? '' : '.' + String(frac).padStart(2, '0')
  return `${sign}${currency.toUpperCase()} ${grouped}${fracStr}`
}

/** Numeric-only minor-units formatter (no currency code) for table columns. */
export function formatMinorNumber(minor: number | string | null | undefined, currency: string, locale = 'en-US'): string {
  return formatMinor(minor, currency, locale).replace(/^[A-Z]{3}\s?/, '')
}

export interface DateTimeLocale {
  timezone: string
  locale: string
}

const DEFAULT_DT: DateTimeLocale = { timezone: 'UTC', locale: 'en-US' }

/** Parse an ISO date/datetime and format it in the given timezone. */
export function formatDate(iso: string | null | undefined, dt: DateTimeLocale = DEFAULT_DT, opts?: Intl.DateTimeFormatOptions): string {
  if (!iso) return '\u2014'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '\u2014'
  return new Intl.DateTimeFormat(dt.locale, {
    timeZone: dt.timezone,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...opts,
  }).format(date)
}

export function formatDateTime(iso: string | null | undefined, dt: DateTimeLocale = DEFAULT_DT): string {
  return formatDate(iso, dt, {
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatTime(isoTime: string | null | undefined, dt: DateTimeLocale = DEFAULT_DT): string {
  if (!isoTime) return '\u2014'
  // "HH:MM:SS" or ISO datetime string.
  const date = isoTime.includes('T') || isoTime.includes(' ') ? new Date(isoTime) : new Date(`1970-01-01T${isoTime}`)
  if (Number.isNaN(date.getTime())) return isoTime
  return new Intl.DateTimeFormat(dt.locale, {
    timeZone: dt.timezone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '\u2014'
  return `${value.toFixed(digits)}%`
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '\u2014'
  return value.toLocaleString('en-US')
}

/** Weekday 1..7 (Mon..Sun) → short label. */
const WEEKDAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const WEEKDAYS_LONG = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

export function weekdayLabel(day: number, long = false): string {
  const list = long ? WEEKDAYS_LONG : WEEKDAYS
  return list[day] ?? String(day)
}

/** Convert minor units to a plain major-unit number for chart axis ticks (display only). */
export function minorToMajor(minor: number | string | null | undefined, currency: string): number {
  if (minor === null || minor === undefined) return 0
  const value = typeof minor === 'string' ? Number(minor) : minor
  return value / minorFactor(currency)
}

export function titleCase(value: string): string {
  if (!value) return value
  return value
    .split(/[_\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

export function fullName(first: string | null | undefined, last: string | null | undefined): string {
  return [first, last].filter(Boolean).join(' ') || '\u2014'
}
