// src/ui/App — the redesigned app shell (owner layout override 2026-07-10, recorded
// in BUILD_LOG; DESIGN.md §6 view CONTENT/behavior specs still hold). A single
// no-scroll grid sized for a ~2000×1300 landscape window:
//
//   ┌─────────────────────────── top bar (title · Settings · Help) ───────────┐
//   │ left sidebar │        stage (3D scene + docked timeline)      │ ladder   │
//   │  (Controls)  │  graph overlay & camera presets live in-scene  │ (right)  │
//   ├──────────────── bottom dock: charts & energy (collapsible) ──────────────┤
//
// Everything renders from the one global clock (DESIGN.md §2). The dock starts
// collapsed and the graph overlay starts off, so the scene + ladder get the height.

import { useEffect, type CSSProperties, type ReactElement } from 'react';
import { useAppStore } from '../state';
import { Scene, type SceneColors } from '../render3d';
import { Charts } from './Charts';
import { Controls } from './Controls';
import { Help } from './Help';
import { Ladder } from './Ladder';
import { Settings } from './Settings';
import { StateGraph } from './StateGraph';
import { TimelineBar } from './TimelineBar';
import { THEME_CSS, usePalette, type Palette } from './theme';
import { useAudio } from './useAudio';
import { useClock } from './useClock';

/** Map the active palette to the subset of colors the 3D scene needs (ui → render3d). */
function sceneColorsOf(palette: Palette): SceneColors {
  return {
    background: palette.sceneBg,
    gridCell: palette.gridCell,
    gridSection: palette.gridSection,
    overlayPanel: palette.name === 'dark' ? 'rgba(30, 41, 59, 0.82)' : 'rgba(255, 255, 255, 0.9)',
    overlayBorder: palette.border,
    overlayText: palette.textPrimary,
    accent: palette.accent,
    accentText: palette.accentText,
  };
}

/** Inject the global stylesheet once and stamp the active theme on <html>. */
function useThemeChrome(): void {
  const theme = useAppStore((state) => state.theme);
  useEffect(() => {
    const id = 'airtime-theme-css';
    if (!document.getElementById(id)) {
      const style = document.createElement('style');
      style.id = id;
      style.textContent = THEME_CSS;
      document.head.appendChild(style);
    }
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
}

/**
 * Global Space = play/pause (owner requirement 2026-07-11). The guard skips typing
 * contexts — a focused <input>, <textarea>, <select>, or any contentEditable element
 * — so Space keeps its normal meaning while editing the pattern or a numeric field.
 * A focused <button> (or role=button) is also skipped so its native Space activation
 * runs once instead of double-toggling (the Space-triggered click fires on keyup,
 * which preventDefault on keydown cannot cancel). Modifier chords and auto-repeat are
 * ignored; when we DO handle it we preventDefault so the page never also scrolls.
 */
function useSpacebarPlayPause(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.code !== 'Space' && event.key !== ' ') {
        return;
      }
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      const interactive =
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        tag === 'BUTTON' ||
        target?.getAttribute('role') === 'button' ||
        (target?.isContentEditable ?? false);
      if (interactive) {
        return;
      }
      event.preventDefault(); // stop page scroll
      useAppStore.getState().togglePlaying();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

/** The thin top bar: product title + the Settings and Help entry points. */
function TopBar(): ReactElement {
  const palette = usePalette();
  return (
    <header
      style={{
        gridColumn: '1 / -1',
        gridRow: 1,
        display: 'flex',
        alignItems: 'center',
        gap: '0.9rem',
      }}
    >
      <h1 style={{ margin: 0, fontSize: '1.15rem', color: palette.textPrimary, letterSpacing: '0.01em' }}>
        Airtime
      </h1>
      <span style={{ fontSize: '0.78rem', color: palette.textMuted }}>
        Siteswap 3D visualizer &amp; kinematics lab
      </span>
      <div style={{ flex: 1 }} />
      <Settings />
      <Help />
    </header>
  );
}

/** The center stage: the 3D scene with the timeline docked to its bottom edge. */
function Stage(): ReactElement {
  const palette = usePalette();
  return (
    <div style={{ gridColumn: 2, gridRow: 2, minWidth: 0, minHeight: 0 }}>
      <div
        style={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          borderRadius: '0.6rem',
          border: `1px solid ${palette.border}`,
          overflow: 'hidden',
          background: palette.sceneBg,
        }}
      >
        {/* Scene area: the 3D view + its in-scene overlays (camera presets top-right
            in Scene; the state-graph toggle top-left + overlay via StateGraph). The
            translucent graph overlay covers only this area, never the timeline. */}
        <div style={{ position: 'relative', display: 'flex', flex: 1, minHeight: 0 }}>
          <Scene sceneColors={sceneColorsOf(palette)} />
          <StateGraph />
        </div>
        <TimelineBar />
      </div>
    </div>
  );
}

/** The right column: the ladder diagram, filling the height that matches the scene. */
function LadderColumn(): ReactElement {
  const palette = usePalette();
  return (
    <div style={{ gridColumn: 3, gridRow: 2, minWidth: 0, minHeight: 0 }}>
      <section
        style={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.4rem',
          padding: '0.6rem 0.7rem',
          borderRadius: '0.6rem',
          border: `1px solid ${palette.border}`,
          background: palette.panel,
          overflow: 'hidden',
        }}
      >
        <h2 style={{ margin: 0, fontSize: '0.8rem', color: palette.textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>
          Ladder diagram
        </h2>
        {/* The ladder box takes all remaining height so the (vertical) SVG fills it. */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem', overflow: 'hidden' }}>
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: 'flex',
              background: palette.chartPlotBg,
              border: `1px solid ${palette.border}`,
              borderRadius: '0.4rem',
              padding: '0.3rem',
            }}
          >
            <Ladder />
          </div>
          <p style={{ margin: 0, color: palette.textMuted, fontSize: '0.72rem', lineHeight: 1.45 }}>
            Time runs top→bottom, one column per hand. Arcs are flights (bow grows with the throw),
            thick segments are carries; each ball keeps the color it has in the 3D scene. The red
            cursor is the shared playhead — scrub the timeline to move it here too.
          </p>
        </div>
      </section>
    </div>
  );
}

export function App(): ReactElement {
  // Mount the single wall-clock loop that drives simTime (DESIGN.md §2) and the
  // WebAudio tick scheduler (a no-op until audio is enabled).
  useClock();
  useAudio();
  useThemeChrome();
  useSpacebarPlayPause();
  const palette = usePalette();

  return (
    <div style={rootGridStyle(palette)}>
      <TopBar />

      {/* Left sidebar: pattern, library, tempo/physics, hands/geometry. */}
      <aside
        style={{
          gridColumn: 1,
          gridRow: 2,
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          paddingRight: '0.15rem',
        }}
      >
        <Controls />
      </aside>

      <Stage />
      <LadderColumn />

      {/* Bottom dock: charts + energy, collapsible (starts collapsed → ~no height). */}
      <div style={{ gridColumn: '1 / -1', gridRow: 3, minWidth: 0 }}>
        <Charts />
      </div>
    </div>
  );
}

function rootGridStyle(palette: Palette): CSSProperties {
  return {
    display: 'grid',
    gridTemplateColumns: '300px minmax(0, 1fr) 440px',
    gridTemplateRows: 'auto minmax(0, 1fr) auto',
    gap: '0.6rem',
    padding: '0.6rem 0.75rem',
    height: '100vh',
    width: '100vw',
    overflow: 'hidden',
    background: palette.appBg,
    color: palette.textPrimary,
    fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  };
}
