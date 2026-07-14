// src/ui/App — the redesigned app shell (owner layout override 2026-07-10; Settings
// drawer removed + panels made resizable 2026-07-11, recorded in BUILD_LOG;
// DESIGN.md §6 view CONTENT/behavior specs still hold). A single no-scroll grid
// sized for a ~2000×1300 landscape window:
//
//   ┌─────────────────────────────── top bar (title · Help) ──────────────────┐
//   │ sidebar │┃│      stage (3D scene + docked timeline)     │┃│ ladder       │
//   │(Controls││┃│  graph overlay & camera presets in-scene   │┃│ + Save/Share │
//   │ + View) │┃│                                             │┃│ + Audio      │
//   ├──────────────── bottom dock: charts & energy (collapsible) ──────────────┤
//
// The ┃ columns are draggable splitters (ui/panels): the sidebar + ladder columns
// resize and collapse to thin strips; the dock resizes vertically. Sizes + collapse
// flags persist in localStorage only — never the store or the URL codec. Everything
// renders from the one global clock (DESIGN.md §2). The dock starts collapsed and
// the graph overlay starts off, so the scene + ladder get the height.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import { useAppStore } from '../state';
import { Scene, type SceneColors } from '../render3d';
import { Charts } from './Charts';
import { Controls } from './Controls';
import { Explorer } from './Explorer';
import { FeedbackButtons } from './Feedback';
import { Help } from './Help';
import { Ladder } from './Ladder';
import {
  COLLAPSED_STRIP,
  CollapseButton,
  CollapsedStrip,
  DOCK_MAX,
  DOCK_MIN,
  GUTTER,
  LADDER_MAX,
  LADDER_MIN,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  STAGE_MIN,
  Splitter,
  useLayout,
  type LayoutController,
} from './panels';
import { SharePanel } from './SharePanel';
import { StateGraph } from './StateGraph';
import { TimelineBar } from './TimelineBar';
import { THEME_CSS, usePalette, type Palette } from './theme';
import { useAudio } from './useAudio';
import { useClock } from './useClock';
import { useIsNarrow } from './useIsNarrow';
import { Button } from './widgets';
import { validateNotation } from '../core/siteswap';
import type { DockMode } from '../state';

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
    handCup: palette.textSecondary,
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

/** The thin top bar: product title + the top-right cluster (feedback links + Help).
 *  `compact` (narrow shell) hides the subtitle to reclaim width on a phone. */
function TopBar({ compact = false }: { readonly compact?: boolean } = {}): ReactElement {
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
      {compact ? null : (
        <span style={{ fontSize: '0.78rem', color: palette.textMuted }}>
          Siteswap 3D visualizer &amp; kinematics lab
        </span>
      )}
      <div style={{ flex: 1 }} />
      {/* Top-right cluster: feedback links (Report a bug / Suggest a feature) then Help. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <FeedbackButtons />
        <Help />
      </div>
    </header>
  );
}

/** The stage interior — the 3D scene (+ in-scene overlays) with the timeline docked
 *  to its bottom edge — inside a rounded, bordered frame that fills its parent's
 *  height. Extracted from {@link Stage} so the narrow (mobile) shell can pin the same
 *  content atop its column without the desktop grid-placement wrapper. */
/** Whether the primary pointer is coarse (touch), read once and guarded for jsdom/SSR
 *  exactly like {@link useIsNarrow}: a missing matchMedia reports `false`, so tests and
 *  non-DOM renders keep the mouse-sized gizmo targets. Coarse capability does not change
 *  at runtime, so a one-shot read (no subscription) is enough. */
function readCoarsePointer(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(pointer: coarse)').matches;
}

function StageContent({ mobile = false }: { readonly mobile?: boolean } = {}): ReactElement {
  const palette = usePalette();
  const coarsePointer = useMemo(readCoarsePointer, []);
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        // Full-bleed scene on mobile: no rounded frame so the scene fills the screen.
        borderRadius: mobile ? 0 : '0.6rem',
        border: mobile ? 'none' : `1px solid ${palette.border}`,
        overflow: 'hidden',
        background: palette.sceneBg,
      }}
    >
      {/* Scene area: the 3D view + its in-scene overlays (camera presets top-right
          in Scene; the state-graph toggle top-left + overlay via StateGraph). The
          translucent graph overlay covers only this area, never the timeline. */}
      <div style={{ position: 'relative', display: 'flex', flex: 1, minHeight: 0 }}>
        <Scene sceneColors={sceneColorsOf(palette)} coarsePointer={coarsePointer} touchScroll={mobile} />
        <StateGraph mobile={mobile} />
      </div>
      <TimelineBar compact={mobile} />
    </div>
  );
}

/** The center stage (desktop grid cell): the 3D scene with the timeline docked to its
 *  bottom edge. The DOM/styles it renders are unchanged from before the StageContent
 *  extraction, so the desktop layout is byte-for-byte identical. */
function Stage(): ReactElement {
  return (
    <div style={{ gridColumn: 3, gridRow: 2, minWidth: 0, minHeight: 0 }}>
      <StageContent />
    </div>
  );
}

/**
 * The right column: the ladder diagram (fills the height that matches the scene)
 * with Save/Share & audio docked beneath it (relocated from the deleted Settings
 * drawer, 2026-07-11). A chevron collapses the whole column to a thin strip.
 */
function RightColumn({ onCollapse }: { onCollapse(): void }): ReactElement {
  const palette = usePalette();
  return (
    <div
      style={{
        gridColumn: 5,
        gridRow: 2,
        minWidth: 0,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: '0.55rem',
        overflow: 'hidden',
      }}
    >
      <section
        style={{
          flex: 1,
          minHeight: 0,
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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
          <h2 style={{ margin: 0, fontSize: '0.8rem', color: palette.textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>
            Ladder diagram
          </h2>
          <CollapseButton side="right" label="ladder column" onCollapse={onCollapse} />
        </div>
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
      {/* Save/Share & audio, beneath the ladder (owner 2026-07-11: no Settings menu). */}
      <div style={{ flexShrink: 0, overflowY: 'auto', minHeight: 0 }}>
        <SharePanel />
      </div>
    </div>
  );
}

/** Left sidebar: a pinned collapse header over the scrollable Controls (which now
 *  also carries the View group). Inner scroll is the last-resort overflow path
 *  (owner 2026-07-11) — the app shell itself never scrolls. */
function Sidebar({ onCollapse }: { onCollapse(): void }): ReactElement {
  const palette = usePalette();
  return (
    <aside
      style={{ gridColumn: 1, gridRow: 2, minHeight: 0, display: 'flex', flexDirection: 'column' }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.5rem',
          padding: '0 0.15rem 0.4rem 0.1rem',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: palette.textMuted }}>
          Controls
        </span>
        <CollapseButton side="left" label="controls sidebar" onCollapse={onCollapse} />
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', paddingRight: '0.15rem' }}>
        <Controls />
      </div>
    </aside>
  );
}

/** The tri-state selector in the dock header (owner round-2 #1; ruling 2026-07-11):
 *  the bottom panel shows nothing, the charts & energy dock, or the siteswap
 *  explorer. A segmented control (three buttons); the active mode is the accent
 *  fill. Always visible — even when 'none' — so the panel is reachable again. */
function DockModeSwitch(): ReactElement {
  const palette = usePalette();
  const dockMode = useAppStore((state) => state.dockMode);
  const setDockMode = useAppStore((state) => state.setDockMode);
  const options: readonly { readonly value: DockMode; readonly label: string }[] = [
    { value: 'none', label: 'None' },
    { value: 'charts', label: 'Charts & energy' },
    { value: 'explorer', label: 'Siteswap explorer' },
  ];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
      <span
        style={{
          fontSize: '0.68rem',
          fontWeight: 700,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: palette.textMuted,
        }}
      >
        Bottom panel
      </span>
      <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
        {options.map((option) => {
          const active = option.value === dockMode;
          return (
            <Button
              key={option.value}
              onClick={() => setDockMode(option.value)}
              ariaLabel={`Bottom panel: ${option.label}`}
              ariaPressed={active}
              variant={active ? 'primary' : 'default'}
            >
              {option.label}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

/** The bottom dock: a slim always-present mode switch (tri-state) over the active
 *  body (nothing / charts & energy / siteswap explorer). The top-edge splitter and
 *  the natural-vs-fixed height behavior are preserved for BOTH non-empty modes;
 *  before any drag the dock is natural height (reproduces the pre-splitter layout),
 *  once dragged it takes a fixed height and scrolls inside (DESIGN.md §6). */
function BottomDock({ layout }: { layout: LayoutController }): ReactElement {
  const palette = usePalette();
  const dockMode = useAppStore((state) => state.dockMode);
  const expanded = dockMode !== 'none';
  const dockRef = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState(240);

  // Track the dock body's natural height so a first drag starts from where it sits.
  useLayoutEffect(() => {
    const element = dockRef.current;
    if (!element) {
      return;
    }
    const read = (): void => setMeasured(element.offsetHeight);
    read();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(read);
      observer.observe(element);
      return () => observer.disconnect();
    }
    return undefined;
  }, [dockMode]);

  const fixedHeight = expanded && layout.dockHeight != null ? layout.dockHeight : null;
  return (
    <div
      style={{
        gridColumn: '1 / -1',
        gridRow: 3,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        height: fixedHeight != null ? `${fixedHeight}px` : 'auto',
      }}
    >
      {expanded ? (
        <Splitter
          orientation="horizontal"
          // Clamp to [DOCK_MIN, DOCK_MAX]: before any drag the value is the dock's
          // natural height, which can exceed DOCK_MAX and would push aria-valuenow
          // past aria-valuemax (an invalid slider). The drag baseline stays in range.
          value={Math.max(DOCK_MIN, Math.min(DOCK_MAX, layout.dockHeight ?? measured))}
          min={DOCK_MIN}
          max={DOCK_MAX}
          sign={-1}
          ariaLabel="Resize bottom dock"
          onChange={layout.setDockHeight}
        />
      ) : null}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: expanded ? '0 0.15rem 0.4rem' : '0.1rem 0.15rem',
          flexShrink: 0,
        }}
      >
        <DockModeSwitch />
        <div style={{ flex: 1 }} />
      </div>
      {expanded ? (
        <div
          ref={dockRef}
          style={{ flex: 1, minHeight: 0, overflowY: fixedHeight != null ? 'auto' : 'visible' }}
        >
          {/* Explorer caps its results box while the dock is at natural (undragged)
              height so a large domain can't crush the stage; a dragged (fixed) dock
              drops the cap and the results flex to fill it (see Explorer). */}
          {dockMode === 'charts' ? <Charts /> : <Explorer capNaturalHeight={fixedHeight == null} />}
        </div>
      ) : (
        <p style={{ margin: '0 0.15rem 0.2rem', fontSize: '0.74rem', color: palette.textMuted }}>
          Pick a bottom panel to show per-hand kinematics &amp; energy charts, or explore siteswaps
          by ball count and period.
        </p>
      )}
    </div>
  );
}

// --- Narrow (portrait, scene-first, tabbed) shell ----------------------------
// Owner target (round 9): on a phone the 3D scene + transport + pattern input are
// ALWAYS visible; Ladder / Charts / Explorer / Share are opt-in tabs. This shell is
// only ever mounted when useIsNarrow() is true (matchMedia ≤ 760 px), so it never
// affects the desktop grid — which stays byte-for-byte identical.

/** The mobile bottom tabs. 'controls' is the default so the strip's pattern box has
 *  its full editor (library, validation, physics…) one tap away. */
type NarrowTab = 'controls' | 'ladder' | 'charts' | 'explorer' | 'share';

const NARROW_TABS: readonly { readonly value: NarrowTab; readonly label: string }[] = [
  { value: 'controls', label: 'Controls' },
  { value: 'ladder', label: 'Ladder' },
  { value: 'charts', label: 'Charts' },
  { value: 'explorer', label: 'Explorer' },
  { value: 'share', label: 'Share' },
];

/**
 * The always-visible siteswap entry for the mobile strip: a compact store-bound
 * pattern box + Go, mirroring the desktop Controls draft model (type edits a local
 * draft; Enter or Go applies via setPattern → navigateToPattern; Esc reverts). It is
 * deliberately minimal — the full validation lines, sync notices and library live in
 * the Controls tab — so the strip stays one row tall. Kept self-contained so the
 * desktop Controls component is untouched.
 */
function CompactPatternField(): ReactElement {
  const palette = usePalette();
  const pattern = useAppStore((state) => state.pattern);
  const setPattern = useAppStore((state) => state.setPattern);
  const [draft, setDraft] = useState(pattern);
  useEffect(() => {
    setDraft(pattern);
  }, [pattern]);

  const valid = validateNotation(draft).ok;
  const dirty = draft !== pattern;
  const applyDraft = (): void => {
    if (dirty) {
      setPattern(draft);
    }
  };

  return (
    <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'stretch', flex: 1, minWidth: 0 }}>
      <input
        type="text"
        value={draft}
        aria-label="Pattern (siteswap)"
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            applyDraft();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            setDraft(pattern);
          }
        }}
        style={{
          flex: 1,
          minWidth: 0,
          font: '700 1.05rem ui-monospace, SFMono-Regular, Menlo, monospace',
          padding: '0.4rem 0.5rem',
          borderRadius: '0.45rem',
          border: `1px solid ${!valid ? palette.red : dirty ? palette.accent : palette.border}`,
          background: palette.inset,
          color: palette.textPrimary,
        }}
      />
      <Button
        variant={dirty ? 'primary' : 'default'}
        onClick={applyDraft}
        ariaLabel="Apply pattern"
        title="Apply pattern (Enter)"
      >
        Go
      </Button>
    </div>
  );
}

/** The mobile bottom tab bar: a segmented control selecting which opt-in panel shows
 *  below it. Generalizes the DockModeSwitch idiom over the Button widget; wraps rather
 *  than scrolls so every tab stays visible (and reachable) at 360–414 px. */
function NarrowTabBar({
  active,
  onSelect,
}: {
  readonly active: NarrowTab;
  onSelect(tab: NarrowTab): void;
}): ReactElement {
  return (
    <div
      role="group"
      aria-label="Panels"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '0.3rem',
        flexShrink: 0,
        padding: '0.1rem 0',
      }}
    >
      {NARROW_TABS.map((tab) => {
        const selected = tab.value === active;
        return (
          <Button
            key={tab.value}
            onClick={() => onSelect(tab.value)}
            ariaLabel={`Panel: ${tab.label}`}
            ariaPressed={selected}
            variant={selected ? 'primary' : 'default'}
          >
            {tab.label}
          </Button>
        );
      })}
    </div>
  );
}

/** Render the active tab's existing panel component. Ladder is given a filled,
 *  bordered box (like the desktop right column) so its height-driven SVG has a
 *  definite height; the others render naturally inside the scroll container. */
function NarrowTabPanel({ tab }: { readonly tab: NarrowTab }): ReactElement {
  const palette = usePalette();
  if (tab === 'ladder') {
    return (
      <div
        style={{
          flex: 1,
          minHeight: '60vh',
          display: 'flex',
          background: palette.chartPlotBg,
          border: `1px solid ${palette.border}`,
          borderRadius: '0.4rem',
          padding: '0.3rem',
        }}
      >
        <Ladder />
      </div>
    );
  }
  if (tab === 'charts') {
    return <Charts />;
  }
  if (tab === 'explorer') {
    return <Explorer />;
  }
  if (tab === 'share') {
    return <SharePanel />;
  }
  return <Controls />;
}

/**
 * The mobile shell (owner round 9): the PAGE scrolls, not an inner panel. A HERO
 * section — top bar over the full-bleed scene with its short docked timeline — is
 * sized to exactly one viewport (minHeight 100dvh, box-sizing border-box), so the
 * scene fills most of the screen and the timeline lands at the bottom. Swiping
 * scrolls the hero off the top to reveal the BELOW-THE-FOLD settings: the compact
 * pattern field, the tab bar, and the selected panel, all in normal flow. No
 * splitters or collapsed strips here. (Play/pause lives in the docked timeline
 * inside the hero, so the pattern strip needs no transport of its own.)
 */
function NarrowApp(): ReactElement {
  const palette = usePalette();
  const [tab, setTab] = useState<NarrowTab>('controls');
  return (
    <div style={narrowRootStyle(palette)}>
      {/* HERO: exactly one viewport tall (border-box + padding), scene-first. */}
      <div
        style={{
          minHeight: '100dvh',
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: '0.4rem',
          paddingTop: 'calc(0.4rem + env(safe-area-inset-top))',
          paddingBottom: 'calc(0.4rem + env(safe-area-inset-bottom))',
        }}
      >
        <TopBar compact />
        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          <StageContent mobile />
        </div>
      </div>

      {/* BELOW-THE-FOLD: the settings/options, revealed by swiping the hero up. */}
      <div
        style={{
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: '0.5rem',
          padding: '0.5rem 0 calc(0.6rem + env(safe-area-inset-bottom))',
        }}
      >
        <CompactPatternField />
        <NarrowTabBar active={tab} onSelect={setTab} />
        <NarrowTabPanel tab={tab} />
      </div>
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
  const layout = useLayout();
  const narrow = useIsNarrow();

  // Phone-narrow viewports get the portrait, scene-first, tabbed shell; every wider
  // viewport (and jsdom, where matchMedia is undefined) gets the UNCHANGED desktop
  // grid below. The two are mutually exclusive so no desktop-only concern (splitters,
  // collapsed strips, dock) renders on a phone and vice-versa.
  if (narrow) {
    return <NarrowApp />;
  }

  return (
    <div style={rootGridStyle(palette, layout)}>
      <TopBar />

      {/* Left column: the controls sidebar (pattern, physics, hands, view) or, when
          collapsed, a thin strip with a chevron to reopen it. */}
      {layout.leftCollapsed ? (
        <div style={{ gridColumn: 1, gridRow: 2, minHeight: 0 }}>
          <CollapsedStrip side="left" label="controls" onExpand={layout.toggleLeftCollapsed} />
        </div>
      ) : (
        <Sidebar onCollapse={layout.toggleLeftCollapsed} />
      )}

      {/* Left splitter (disabled while the sidebar is collapsed). */}
      <div style={{ gridColumn: 2, gridRow: 2, minHeight: 0 }}>
        <Splitter
          orientation="vertical"
          value={layout.sidebarWidth}
          min={SIDEBAR_MIN}
          max={SIDEBAR_MAX}
          sign={1}
          ariaLabel="Resize controls sidebar"
          disabled={layout.leftCollapsed}
          onChange={layout.setSidebarWidth}
        />
      </div>

      <Stage />

      {/* Right splitter (disabled while the ladder column is collapsed). */}
      <div style={{ gridColumn: 4, gridRow: 2, minHeight: 0 }}>
        <Splitter
          orientation="vertical"
          value={layout.ladderWidth}
          min={LADDER_MIN}
          max={LADDER_MAX}
          sign={-1}
          ariaLabel="Resize ladder column"
          disabled={layout.ladderCollapsed}
          onChange={layout.setLadderWidth}
        />
      </div>

      {/* Right column: ladder + Save/Share, or a thin strip when collapsed. */}
      {layout.ladderCollapsed ? (
        <div style={{ gridColumn: 5, gridRow: 2, minHeight: 0 }}>
          <CollapsedStrip side="right" label="ladder" onExpand={layout.toggleLadderCollapsed} />
        </div>
      ) : (
        <RightColumn onCollapse={layout.toggleLadderCollapsed} />
      )}

      <BottomDock layout={layout} />
    </div>
  );
}

/** The mobile shell's outer container: the PAGE's vertical scroll container (owner
 *  round 9). It fills the visible viewport (dvh) and scrolls its stacked sections —
 *  the hero (scene-first, one viewport tall) and the below-the-fold settings — as a
 *  plain block. Vertical safe-area insets are handled inside the sections below so the
 *  hero stays exactly one viewport tall; only the horizontal insets sit here. */
function narrowRootStyle(palette: Palette): CSSProperties {
  return {
    height: '100dvh',
    overflowY: 'auto',
    overflowX: 'hidden',
    WebkitOverflowScrolling: 'touch',
    paddingLeft: 'env(safe-area-inset-left)',
    paddingRight: 'env(safe-area-inset-right)',
    background: palette.appBg,
    color: palette.textPrimary,
    fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  };
}

function rootGridStyle(palette: Palette, layout: LayoutController): CSSProperties {
  const leftTrack = layout.leftCollapsed ? COLLAPSED_STRIP : layout.sidebarWidth;
  const rightTrack = layout.ladderCollapsed ? COLLAPSED_STRIP : layout.ladderWidth;
  return {
    display: 'grid',
    // sidebar | splitter | stage | splitter | ladder. The splitter tracks ARE the
    // gutters (columnGap 0); the stage keeps a hard minimum so no panel crushes it.
    gridTemplateColumns: `${leftTrack}px ${GUTTER}px minmax(${STAGE_MIN}px, 1fr) ${GUTTER}px ${rightTrack}px`,
    gridTemplateRows: 'auto minmax(0, 1fr) auto',
    gap: '0.6rem 0',
    // Fold in iOS safe-area insets (env() is 0 on desktop/non-notch — a no-op there).
    padding:
      'calc(0.6rem + env(safe-area-inset-top)) calc(0.75rem + env(safe-area-inset-right)) calc(0.6rem + env(safe-area-inset-bottom)) calc(0.75rem + env(safe-area-inset-left))',
    // dvh tracks the visible viewport so the bottom dock isn't hidden under mobile
    // browser chrome; width 100% (not 100vw) avoids the scrollbar-overflow foot-gun.
    height: '100dvh',
    width: '100%',
    overflow: 'hidden',
    background: palette.appBg,
    color: palette.textPrimary,
    fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  };
}
