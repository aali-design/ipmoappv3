// ---------------------------------------------------------------------------
// Design tokens — the single source of truth for every visual value.
// Components MUST import from the barrel (`@/theme`) and never hard-code
// hex values, spacing, or radii inline. SVG charts may consume these tokens
// directly as props.
// ---------------------------------------------------------------------------

export const colors = {
  // Canvas
  bg: "#0b0f14",
  bgElevated: "#0f141b",
  surface: "#131a22",
  surfaceRaised: "#1a222d",
  surfaceOverlay: "#1f2937",

  // Borders
  border: "#232d3a",
  borderStrong: "#33415580",

  // Text
  text: "#e6edf3",
  textSecondary: "#9aa7b4",
  textMuted: "#64748b",
  textInverse: "#0b0f14",
  white: "#ffffff",
  overlay: "rgba(0, 0, 0, 0.6)",

  // Accent
  accent: "#3b82f6",
  accentHover: "#2563eb",
  accentMuted: "#1e3a5f",
  accentText: "#93c5fd",
  focusRing: "#60a5fa",

  // Semantic
  success: "#22c55e",
  successMuted: "#143323",
  successText: "#86efac",
  warning: "#f59e0b",
  warningMuted: "#3a2b10",
  warningText: "#fcd34d",
  danger: "#ef4444",
  dangerMuted: "#3a1519",
  dangerText: "#fca5a5",
  info: "#38bdf8",
  infoMuted: "#0c2f42",
  infoText: "#7dd3fc",
  neutral: "#64748b",
  neutralMuted: "#1a222d",
  neutralText: "#cbd5e1",
} as const;

export const spacing = {
  "0": "0",
  px: "1px",
  "0.5": "2px",
  "1": "4px",
  "1.5": "6px",
  "2": "8px",
  "2.5": "10px",
  "3": "12px",
  "3.5": "14px",
  "4": "16px",
  "5": "20px",
  "6": "24px",
  "7": "28px",
  "8": "32px",
  "9": "36px",
  "10": "40px",
  "12": "48px",
  "14": "56px",
  "16": "64px",
  "20": "80px",
  "24": "96px",
} as const;

export const radii = {
  none: "0",
  sm: "2px",
  md: "4px",
  lg: "6px",
  xl: "8px",
  full: "9999px",
} as const;

export const fontSizes = {
  xs: "11px",
  sm: "12px",
  base: "13px",
  md: "14px",
  lg: "16px",
  xl: "18px",
  "2xl": "22px",
  "3xl": "28px",
} as const;

export const fontWeights = {
  regular: "400",
  medium: "500",
  semibold: "600",
  bold: "700",
} as const;

export const lineHeights = {
  tight: "1.2",
  snug: "1.35",
  normal: "1.5",
} as const;

export const fontFamily = {
  sans: "'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif",
  mono: "'JetBrains Mono', 'SFMono-Regular', 'Menlo', 'Consolas', monospace",
} as const;

export const shadows = {
  sm: "0 1px 2px rgba(0,0,0,0.4)",
  md: "0 4px 12px rgba(0,0,0,0.45)",
  lg: "0 12px 32px rgba(0,0,0,0.55)",
} as const;

export const zIndex = {
  base: "1",
  sticky: "10",
  drawer: "40",
  overlay: "50",
  modal: "60",
  toast: "70",
} as const;

export const breakpoints = {
  sm: "640px",
  md: "768px",
  lg: "1024px",
  xl: "1440px",
} as const;

export const transition = {
  fast: "120ms ease",
  base: "180ms ease",
  slow: "260ms ease",
} as const;

// Chart-specific palette (sequence colors for series / donut segments).
export const chart = {
  series: [
    "#3b82f6",
    "#22c55e",
    "#f59e0b",
    "#ef4444",
    "#38bdf8",
    "#a78bfa",
    "#f472b6",
    "#2dd4bf",
  ] as string[],
  pass: "#22c55e",
  fail: "#ef4444",
  blocked: "#f59e0b",
  skipped: "#64748b",
  untested: "#33415580",
  retest: "#38bdf8",
} as const;

export type ColorToken = keyof typeof colors;
export type SpacingToken = keyof typeof spacing;
export type RadiusToken = keyof typeof radii;

export const tokens = {
  colors,
  spacing,
  radii,
  fontSizes,
  fontWeights,
  lineHeights,
  fontFamily,
  shadows,
  zIndex,
  breakpoints,
  transition,
  chart,
} as const;

export type Tokens = typeof tokens;
