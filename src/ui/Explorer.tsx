// src/ui/Explorer — the siteswap explorer dock (owner round-2 #1; orchestrator
// ruling 2026-07-11). One of the bottom dock's tri-state bodies (see App's
// BottomDock): enumerate every valid vanilla siteswap of a chosen (ball count,
// period, max throw) via the pure core generator (core/stategraph
// `enumerateSiteswaps`), with filters (no 0s / no 2s / prime only), a truncation-
// honest result count, and a scrollable grid of clickable patterns. Clicking a
// pattern routes through the store's `navigateToPattern` — the SAME path the
// pattern box uses — so the live transition/splice machinery does its thing
// (same b ⇒ smooth state-graph transition; different b ⇒ hard reset + notice).
//
// The generator is pure and fast (< ~16 ms for the whole capped domain, measured
// on this Jetson), so enumeration runs in a plain useMemo over the query params —
// never in a render hot path, no debounce needed. The query params are
// component-local (not the URL codec) for now; this is a reversible decision
// (BUILD_LOG). The default ball count seeds from the running pattern.

import { useMemo, useState, type CSSProperties, type ReactElement } from 'react';
import {
  canonicalRotation,
  enumerateSiteswaps,
  EXPLORER_MAX_RESULTS,
  EXPLORER_MAX_THROW,
  EXPLORER_PERIOD_MAX,
} from '../core/stategraph';
import { formatPattern } from '../core/siteswap';
import { useAppStore } from '../state';
import { usePalette, type Palette } from './theme';
import { CheckToggle, Stepper } from './widgets';

/** Ball-count range the explorer exposes (juggling-practical; ≤ maxThrow to yield any). */
const BALL_COUNT_MIN = 1;
const BALL_COUNT_MAX = 9;

/** Canonical text of the running pattern, for highlighting its entry in the grid. */
function useCurrentCanonicalText(): string {
  const values = useAppStore((state) => state.sim.values);
  return useMemo(
    () => (values.length > 0 ? formatPattern(canonicalRotation(values)) : ''),
    [values],
  );
}

/** One clickable result chip; a button so it is keyboard-operable (Enter/Space). */
function PatternChip({
  text,
  period,
  prime,
  maxThrow,
  current,
  palette,
  onPick,
}: {
  readonly text: string;
  readonly period: number;
  readonly prime: boolean;
  readonly maxThrow: number;
  readonly current: boolean;
  readonly palette: Palette;
  onPick(): void;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-label={`Juggle ${text}`}
      aria-current={current ? 'true' : undefined}
      title={`${text} — period ${period}, max throw ${maxThrow}, ${prime ? 'prime' : 'non-prime'}`}
      style={chipStyle(palette, current)}
    >
      <span style={{ fontVariantNumeric: 'tabular-nums', letterSpacing: '0.02em' }}>{text}</span>
      {prime ? <span aria-hidden style={primeDotStyle(palette, current)} /> : null}
    </button>
  );
}

/**
 * The siteswap explorer panel (a bottom-dock body; see App's BottomDock).
 *
 * `capNaturalHeight` is set while the dock is at its natural (undragged) height:
 * a large domain (e.g. period 9 / max throw 12 → hundreds of chips) would grow the
 * dock's auto height without bound and crush the 3D stage row. When capped, the
 * results grid takes a bounded max-height and scrolls internally (controls stay
 * pinned); once the user drags the dock splitter the dock gets a fixed height, the
 * cap is dropped, and the results flex to fill it — so the splitter still overrides.
 */
export function Explorer({ capNaturalHeight = false }: { readonly capNaturalHeight?: boolean } = {}): ReactElement {
  const palette = usePalette();
  const navigateToPattern = useAppStore((state) => state.navigateToPattern);
  const currentText = useCurrentCanonicalText();

  // Component-local query (NOT the URL codec — reversible, BUILD_LOG). The ball
  // count seeds from the running pattern's b; maxThrow seeds a couple above it.
  const [ballCount, setBallCount] = useState(() => {
    const b = Math.round(useAppStore.getState().sim.ballCount);
    return Math.min(BALL_COUNT_MAX, Math.max(BALL_COUNT_MIN, Number.isFinite(b) ? b : 3));
  });
  const [period, setPeriod] = useState(3);
  const [maxThrow, setMaxThrow] = useState(() =>
    Math.min(EXPLORER_MAX_THROW, Math.max(ballCount, ballCount + 2)),
  );
  const [excludeZeros, setExcludeZeros] = useState(false);
  const [excludeTwos, setExcludeTwos] = useState(false);
  const [primeOnly, setPrimeOnly] = useState(false);

  // Raising b past maxThrow would yield nothing (max ≥ mean = b); keep maxThrow ≥ b.
  const changeBallCount = (next: number): void => {
    setBallCount(next);
    setMaxThrow((current) => Math.max(current, next));
  };

  const result = useMemo(
    () =>
      enumerateSiteswaps({
        ballCount,
        period,
        maxThrow,
        excludeZeros,
        excludeTwos,
        primeOnly,
      }),
    [ballCount, period, maxThrow, excludeZeros, excludeTwos, primeOnly],
  );

  const countLabel =
    result.total === 0
      ? 'no patterns'
      : `${result.total}${result.truncated ? '+' : ''} pattern${result.total === 1 ? '' : 's'}`;

  return (
    <section aria-label="Siteswap explorer" style={rootStyle(palette)}>
      <div style={controlsRowStyle}>
        <Stepper
          label="Balls"
          value={ballCount}
          min={BALL_COUNT_MIN}
          max={BALL_COUNT_MAX}
          onChange={changeBallCount}
        />
        <Stepper label="Period" value={period} min={1} max={EXPLORER_PERIOD_MAX} onChange={setPeriod} />
        <Stepper
          label="Max throw"
          value={maxThrow}
          min={ballCount}
          max={EXPLORER_MAX_THROW}
          onChange={setMaxThrow}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <span style={{ fontWeight: 600, fontSize: '0.8rem', color: palette.textSecondary }}>
            Filters
          </span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.15rem 0.9rem' }}>
            <CheckToggle label="No 0s" checked={excludeZeros} onChange={() => setExcludeZeros((v) => !v)} />
            <CheckToggle label="No 2s" checked={excludeTwos} onChange={() => setExcludeTwos((v) => !v)} />
            <CheckToggle label="Prime only" checked={primeOnly} onChange={() => setPrimeOnly((v) => !v)} />
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.1rem' }}>
          <span style={{ fontWeight: 700, fontSize: '0.85rem', color: palette.textPrimary }}>
            {countLabel}
          </span>
          <span style={{ fontSize: '0.72rem', color: palette.textMuted }}>
            {ballCount} ball{ballCount === 1 ? '' : 's'} · period {period}
          </span>
          {result.truncated ? (
            <span style={{ fontSize: '0.72rem', color: palette.accent }}>
              capped at {EXPLORER_MAX_RESULTS} — narrow the search
            </span>
          ) : null}
        </div>
      </div>

      <div aria-label="Siteswap results" style={resultsStyle(palette, capNaturalHeight)}>
        {result.patterns.length === 0 ? (
          <p style={{ margin: 0, color: palette.textMuted, fontSize: '0.8rem' }}>
            No valid siteswaps for {ballCount} ball{ballCount === 1 ? '' : 's'}, period {period}, max
            throw {maxThrow}
            {excludeZeros || excludeTwos || primeOnly ? ' with these filters' : ''}. Try a larger max
            throw or a different period.
          </p>
        ) : (
          <div style={gridStyle}>
            {result.patterns.map((pattern) => (
              <PatternChip
                key={pattern.text}
                text={pattern.text}
                period={period}
                prime={pattern.prime}
                maxThrow={pattern.maxThrow}
                current={pattern.text === currentText}
                palette={palette}
                onPick={() => navigateToPattern(pattern.text)}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

// --- Styles -----------------------------------------------------------------

function rootStyle(palette: Palette): CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
    padding: '0.5rem 0.7rem 0.6rem',
    background: palette.panel,
    borderRadius: '0.55rem',
    border: `1px solid ${palette.border}`,
    width: '100%',
    height: '100%',
    minHeight: 0,
  };
}

const controlsRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: '0.6rem 1.1rem',
  flexWrap: 'wrap',
};

/**
 * `capNaturalHeight` bounds the results box so the undragged dock can't grow without
 * limit on a large domain (crushing the 3D stage). The box already scrolls
 * (`overflowY: auto`); the cap just gives that scroll something to bite on. The clamp
 * keeps a small domain unaffected (content shorter than the cap never scrolls) and
 * tops out at ~22rem so the default 2000×1300 layout is unchanged. Uncapped (dock
 * dragged to a fixed height) the box flexes to fill, so the splitter still overrides.
 */
function resultsStyle(palette: Palette, capNaturalHeight: boolean): CSSProperties {
  return {
    flex: '1 1 auto',
    minHeight: 0,
    ...(capNaturalHeight ? { maxHeight: 'clamp(12rem, 30vh, 22rem)' } : null),
    overflowY: 'auto',
    background: palette.chartPlotBg,
    border: `1px solid ${palette.border}`,
    borderRadius: '0.4rem',
    padding: '0.4rem',
  };
}

const gridStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.35rem',
  alignContent: 'flex-start',
};

function chipStyle(palette: Palette, current: boolean): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.25rem',
    padding: '0.28rem 0.55rem',
    borderRadius: '0.4rem',
    border: `1px solid ${current ? palette.accent : palette.border}`,
    background: current ? palette.accent : palette.panelAlt,
    color: current ? palette.accentText : palette.textPrimary,
    fontWeight: 600,
    fontSize: '0.85rem',
    cursor: 'pointer',
    lineHeight: 1.1,
  };
}

function primeDotStyle(palette: Palette, current: boolean): CSSProperties {
  return {
    width: '0.32rem',
    height: '0.32rem',
    borderRadius: '50%',
    background: current ? palette.accentText : palette.accent,
    opacity: current ? 0.85 : 0.9,
  };
}
