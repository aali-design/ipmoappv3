/**
 * Scholarion design tokens — the single source of truth for visual style.
 *
 * Components must consume these tokens (via the `@design` barrel and the
 * accompanying `tokens.css` custom properties) and never hard-code ad-hoc
 * hex values, spacing, radii or font sizes.
 */

export const colors = {
  // Brand
  brand: {
    50: '#eef4fb',
    100: '#dbe8f6',
    200: '#bdd3ee',
    300: '#94b6e2',
    400: '#6793d1',
    500: '#4a77c0',
    600: '#3a5fa8',
    700: '#324d89',
    800: '#2d4271',
    900: '#2a3a5f',
  },
  // Neutrals
  neutral: {
    0: '#ffffff',
    50: '#f7f8fa',
    100: '#eef0f4',
    200: '#dfe3ea',
    300: '#c6ccd8',
    400: '#a2aabd',
    500: '#7d879c',
    600: '#5f687d',
    700: '#4b5265',
    800: '#363c4c',
    900: '#232734',
    950: '#14161f',
  },
  // Semantic
  success: {
    50: '#e8f8ef',
    100: '#c8efd9',
    500: '#1e9e57',
    600: '#17814a',
    700: '#14693e',
  },
  warning: {
    50: '#fdf4e7',
    100: '#fbe6c4',
    500: '#d97706',
    600: '#b25f05',
    700: '#924a04',
  },
  danger: {
    50: '#fdeef0',
    100: '#fad6db',
    500: '#d64545',
    600: '#b33434',
    700: '#8f2929',
  },
  info: {
    50: '#eaf4fb',
    100: '#d3e8f6',
    500: '#1f7fc4',
    600: '#1a67a3',
  },
} as const

export type ColorToken = keyof typeof colors

export const spacing = {
  0: '0',
  0.5: '0.125rem',
  1: '0.25rem',
  1.5: '0.375rem',
  2: '0.5rem',
  2.5: '0.625rem',
  3: '0.75rem',
  4: '1rem',
  5: '1.25rem',
  6: '1.5rem',
  8: '2rem',
  10: '2.5rem',
  12: '3rem',
  16: '4rem',
  20: '5rem',
  24: '6rem',
} as const

export type SpacingToken = keyof typeof spacing

export const radii = {
  none: '0',
  sm: '0.25rem',
  md: '0.5rem',
  lg: '0.75rem',
  xl: '1rem',
  full: '9999px',
} as const

export type RadiusToken = keyof typeof radii

export const typography = {
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  fontFamilyMono: "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace",
  // Font sizes (px)
  xs: '0.75rem',
  sm: '0.8125rem',
  md: '0.875rem',
  lg: '1rem',
  xl: '1.125rem',
  '2xl': '1.375rem',
  '3xl': '1.75rem',
  // Line heights
  leadingTight: '1.25',
  leadingNormal: '1.5',
  leadingRelaxed: '1.625',
  // Weights
  weightRegular: '400',
  weightMedium: '500',
  weightSemibold: '600',
  weightBold: '700',
} as const

export type TypographyToken = keyof typeof typography

export const breakpoints = {
  tablet: '768px',
  desktop: '1024px',
  wide: '1280px',
} as const

export const zIndices = {
  dropdown: 1000,
  sticky: 1020,
  overlay: 2000,
  modal: 3000,
  toast: 4000,
} as const

export const motion = {
  fast: '120ms',
  normal: '180ms',
  slow: '280ms',
  ease: 'cubic-bezier(0.4, 0, 0.2, 1)',
} as const

export const focusRing = `0 0 0 3px ${colors.brand[100]}`

/** Palette used by charts / badges keyed by a stable semantic slot name. */
export const chartSeries = [
  colors.brand[500],
  colors.brand[300],
  colors.success[500],
  colors.warning[500],
  colors.danger[500],
  colors.info[500],
  colors.neutral[500],
] as const

export type ChartSeries = (typeof chartSeries)[number]

export const tokens = {
  colors,
  spacing,
  radii,
  typography,
  breakpoints,
  zIndices,
  motion,
  focusRing,
  chartSeries,
} as const

export default tokens