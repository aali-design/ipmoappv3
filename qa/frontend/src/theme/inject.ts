import { tokens } from "./tokens";

/**
 * Inject the design tokens as CSS custom properties on :root.
 * This guarantees the TS token module is the single source of truth —
 * CSS classes reference `var(--color-*)`, `var(--space-*)`, etc.
 */
export function injectDesignTokens(): void {
  const root = document.documentElement;
  const set = (name: string, value: string) =>
    root.style.setProperty(`--${name}`, value);

  for (const [k, v] of Object.entries(tokens.colors)) {
    set(`color-${k}`, v);
  }
  for (const [k, v] of Object.entries(tokens.spacing)) {
    set(`space-${k}`, v);
  }
  for (const [k, v] of Object.entries(tokens.radii)) {
    set(`radius-${k}`, v);
  }
  for (const [k, v] of Object.entries(tokens.fontSizes)) {
    set(`font-${k}`, v);
  }
  for (const [k, v] of Object.entries(tokens.fontWeights)) {
    set(`weight-${k}`, v);
  }
  for (const [k, v] of Object.entries(tokens.lineHeights)) {
    set(`leading-${k}`, v);
  }
  set("font-sans", tokens.fontFamily.sans);
  set("font-mono", tokens.fontFamily.mono);
  for (const [k, v] of Object.entries(tokens.shadows)) {
    set(`shadow-${k}`, v);
  }
  for (const [k, v] of Object.entries(tokens.transition)) {
    set(`transition-${k}`, v);
  }
}
