// Theme tokens ported from the web app's globals.css (OKLCH → sRGB hex).
// Source of truth: pf-app/src/app/globals.css + pf-app/mobile/design/tokens.css.
//
// Semantics (changed 2026-05-29 to match the web redesign):
//   primary  = amber  (#f5a623)
//   positive = teal   (chart2)  ← gains, income, assets
//   negative = coral  (destructive) ← losses, expenses, liabilities
// (NOT the old indigo/green/red.)
//
// `sidebar*` tokens describe the bottom tab bar, which is ALWAYS dark in both
// light and dark mode (mirrors the web sidebar). Both palettes carry the same
// sidebar values so the tab bar chrome is identical regardless of OS theme.

export const lightColors = {
  background: "#fbfaf7",
  foreground: "#23262d",
  card: "#ffffff",
  cardForeground: "#23262d",
  elevated: "#ffffff", // popover / raised surface
  primary: "#f5a623",
  primaryForeground: "#241a06", // dark text on amber
  secondary: "#f0f1f3",
  secondaryForeground: "#3a3d44",
  muted: "#f2f3f5",
  mutedForeground: "#6f747c",
  accent: "#f7e6c8",
  accentForeground: "#4a3a16",
  destructive: "#db4f3f",
  destructiveForeground: "#ffffff",
  border: "#e5e7ea",
  input: "#e5e7ea",
  ring: "#f5a623",
  // Chart palette (amber / teal / coral / blue / violet)
  chart1: "#f5a623",
  chart2: "#1fb393",
  chart3: "#db4f3f",
  chart4: "#5f8fc0",
  chart5: "#8e6fb8",
  // Semantic money colors
  pos: "#1fb393", // teal — positive / inflow / asset
  neg: "#db4f3f", // coral — negative / outflow / liability
  // Always-dark nav chrome (mirrors the web sidebar in both themes)
  sidebar: "#0b0d10",
  sidebarForeground: "#e8eaed",
  sidebarPrimary: "#f5a623",
  sidebarMutedForeground: "#9aa3ad",
  sidebarBorder: "#1e242b",
};

export const darkColors: typeof lightColors = {
  background: "#0b0d10",
  foreground: "#e8eaed",
  card: "#101317",
  cardForeground: "#e8eaed",
  elevated: "#161a1f", // popover
  primary: "#f5a623",
  primaryForeground: "#241a06",
  secondary: "#161a1f",
  secondaryForeground: "#cfd3d8",
  muted: "#161a1f",
  mutedForeground: "#9aa3ad",
  accent: "#1e242b",
  accentForeground: "#e8eaed",
  destructive: "#e5624b",
  destructiveForeground: "#ffffff",
  border: "#1e242b",
  input: "#1e242b",
  ring: "#f5a623",
  chart1: "#f5a623",
  chart2: "#4fc8a6",
  chart3: "#e5624b",
  chart4: "#74a0c8",
  chart5: "#9b82c2",
  pos: "#4fc8a6",
  neg: "#e5624b",
  sidebar: "#0b0d10",
  sidebarForeground: "#e8eaed",
  sidebarPrimary: "#f5a623",
  sidebarMutedForeground: "#9aa3ad",
  sidebarBorder: "#1e242b",
};

export type ThemeColors = typeof lightColors;
