// src/ui/theme — the dark-first palette + light variant for the redesigned shell
// (owner override 2026-07-10, recorded in BUILD_LOG). The app is designed dark by
// default; a light/dark toggle lives in the View group of the left sidebar. This
// module is the single source
// of truth for every non-data color: the DOM chrome (inline styles), the SVG views
// (Ladder / TimelineBar / StateGraph), and the canvas charts all read the same
// {@link Palette} object via {@link usePalette}. Data colors (per-ball, per-hand
// palettes in state/ballColors and ui/charts) are independent and read on both.
//
// The theme is a pure VIEW preference: it is NOT part of ShareConfig, so the URL
// codec is unchanged (a shared link does not carry the viewer's theme). It lives
// in the store only so canvas/SVG can read it without prop-drilling.

import { useAppStore, type ThemeName } from '../state';

export type { ThemeName };

/** Every named color the redesigned UI uses (data colors excluded — see above). */
export interface Palette {
  readonly name: ThemeName;
  /** App background (behind the grid). */
  readonly appBg: string;
  /** Card / panel surface. */
  readonly panel: string;
  /** Slightly recessed surface (section groups inside a panel). */
  readonly panelAlt: string;
  /** Hover surface for interactive rows/buttons. */
  readonly panelHover: string;
  /** Input / plot-well background (recessed). */
  readonly inset: string;
  /** Hairline border. */
  readonly border: string;
  /** Stronger border (focus, dividers). */
  readonly borderStrong: string;
  readonly textPrimary: string;
  readonly textSecondary: string;
  readonly textMuted: string;
  readonly accent: string;
  readonly accentHover: string;
  readonly accentText: string;
  readonly green: string;
  readonly amber: string;
  readonly red: string;
  /** 3D scene clear color. */
  readonly sceneBg: string;
  /** three.js ground grid (fine + section lines). */
  readonly gridCell: string;
  readonly gridSection: string;
  /** Translucent backdrop for the graph overlay + modals. */
  readonly overlayBackdrop: string;
  /** Timeline / ladder / chart scrub cursor. */
  readonly playhead: string;
  /** Ladder / timeline lane lines. */
  readonly laneLine: string;
  /** Faint per-beat gridlines. */
  readonly gridLine: string;
  // Canvas charts (read at draw time; canvas cannot use CSS vars).
  readonly chartGrid: string;
  readonly chartZero: string;
  readonly chartPlotBg: string;
  readonly chartLabel: string;
  readonly chartTitle: string;
  // State-graph nodes/edges.
  readonly nodeFill: string;
  readonly nodeStroke: string;
  readonly edgeStroke: string;
  /** Elevated-surface drop shadow. */
  readonly shadow: string;
}

const DARK: Palette = {
  name: 'dark',
  appBg: '#0b1120',
  panel: '#1e293b',
  panelAlt: '#172033',
  panelHover: '#263548',
  inset: '#0f172a',
  border: '#334155',
  borderStrong: '#475569',
  textPrimary: '#f1f5f9',
  textSecondary: '#94a3b8',
  textMuted: '#64748b',
  accent: '#3b82f6',
  accentHover: '#60a5fa',
  accentText: '#ffffff',
  green: '#22c55e',
  amber: '#f59e0b',
  red: '#f87171',
  sceneBg: '#0b1120',
  gridCell: '#24314a',
  gridSection: '#33415a',
  overlayBackdrop: 'rgba(8, 12, 22, 0.74)',
  playhead: '#f87171',
  laneLine: '#334155',
  gridLine: '#1e293b',
  chartGrid: 'rgba(51, 65, 85, 0.55)',
  chartZero: '#475569',
  chartPlotBg: '#0f172a',
  chartLabel: '#94a3b8',
  chartTitle: '#e2e8f0',
  nodeFill: '#1e293b',
  nodeStroke: '#64748b',
  edgeStroke: '#2b3a52',
  shadow: '0 10px 40px rgba(0, 0, 0, 0.55)',
};

const LIGHT: Palette = {
  name: 'light',
  appBg: '#eef1f5',
  panel: '#ffffff',
  panelAlt: '#f4f6f9',
  panelHover: '#eef2f7',
  inset: '#f8fafc',
  border: '#d5dae2',
  borderStrong: '#b3bccb',
  textPrimary: '#1f2530',
  textSecondary: '#5b6472',
  textMuted: '#8a93a2',
  accent: '#2f6fed',
  accentHover: '#2560d8',
  accentText: '#ffffff',
  green: '#3b7d4f',
  amber: '#b7791f',
  red: '#e5484d',
  sceneBg: '#eef1f5',
  gridCell: '#c8cdd6',
  gridSection: '#a2acbd',
  overlayBackdrop: 'rgba(226, 232, 240, 0.82)',
  playhead: '#e5484d',
  laneLine: '#c8cdd6',
  gridLine: '#eceef2',
  chartGrid: '#eceef2',
  chartZero: '#b3b9c4',
  chartPlotBg: '#fbfcfe',
  chartLabel: '#8a93a2',
  chartTitle: '#3b4252',
  nodeFill: '#ffffff',
  nodeStroke: '#aab2c0',
  edgeStroke: '#e2e6ec',
  shadow: '0 10px 40px rgba(20, 24, 31, 0.22)',
};

export const PALETTES: Record<ThemeName, Palette> = { dark: DARK, light: LIGHT };

/** The active palette (a stable module reference per theme — safe per frame). */
export function usePalette(): Palette {
  return useAppStore((state) => PALETTES[state.theme]);
}

/**
 * The minimal global stylesheet: a box-sizing/margin reset, the body background +
 * font, native-control theming (`color-scheme` + `accent-color`), and scrollbars.
 * Everything else is inline styles reading {@link Palette}. Two CSS variables
 * (app background + accent) are switched by the `data-theme` attribute the theme
 * effect stamps on <html>; the JS palette carries the rest.
 */
export const THEME_CSS = `
:root {
  --at-app-bg: ${DARK.appBg};
  --at-accent: ${DARK.accent};
  --at-scrollbar: ${DARK.borderStrong};
  color-scheme: dark;
}
:root[data-theme="light"] {
  --at-app-bg: ${LIGHT.appBg};
  --at-accent: ${LIGHT.accent};
  --at-scrollbar: ${LIGHT.borderStrong};
  color-scheme: light;
}
*, *::before, *::after { box-sizing: border-box; }
html, body, #root { margin: 0; padding: 0; height: 100%; width: 100%; }
body {
  overflow: hidden;
  background: var(--at-app-bg);
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  -webkit-font-smoothing: antialiased;
}
input[type="range"] { accent-color: var(--at-accent); }
input[type="checkbox"] { accent-color: var(--at-accent); }
::-webkit-scrollbar { width: 9px; height: 9px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--at-scrollbar); border-radius: 5px; }
@media (prefers-reduced-motion: reduce) {
  * { transition-duration: 0.001ms !important; animation-duration: 0.001ms !important; }
}
`;
