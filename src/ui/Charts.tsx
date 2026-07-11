// src/ui/Charts — the per-hand kinematics charts + energy DOCK (DESIGN.md §6;
// redesign 2026-07-10, owner requirement 6). A collapsible bottom dock: a slim
// tab bar when collapsed (≈ no height, no per-frame sampling), the three charts
// (|v|, |a|, |j|) laid out side-by-side across the wide dock plus the per-hand
// energy table when expanded. Starts COLLAPSED (DEFAULT_CHARTS_VISIBLE = false).
//
// Every hand is overlaid (a color per hand + a shared legend). The per-axis toggle
// (Magnitude / X / Y / Z) switches all three from vector magnitude to a single
// component. The x-axis is the SAME window as the timeline bar / ladder and a
// shared cursor marks simTime across all three (DESIGN.md §2: one clock).
//
// Hot path: the charts redraw every frame while playing. handState is sampled per
// hand over the window into Float32Arrays allocated ONCE and overwritten in place.
// When the dock is collapsed the body unmounts, so nothing is sampled or drawn.
// Canvas cannot read CSS variables, so the theme colors are read from the palette
// and passed into the draw.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
} from 'react';
import { HAND_COUNT_MAX, useAppStore, type ChartAxisMode } from '../state';
import { CURSOR_FRACTION } from '../state/simulation';
import { EnergyPanel } from './EnergyPanel';
import { usePalette, type Palette } from './theme';
import { Button } from './widgets';
import {
  CHART_MIN_HEIGHT,
  chartCanvasHeight,
  foldSampleRange,
  formatTick,
  gridSampleTime,
  gridStep,
  handColor,
  isFiniteSample,
  niceScale,
  quantityMeta,
  SAMPLE_COUNT,
  scalarFromState,
  type ChartQuantity,
} from './charts';

// Chart canvas CSS geometry (logical px; the backing store scales by dpr). The
// canvas HEIGHT is responsive: it follows the dock's height splitter (measured by
// a ResizeObserver in ChartsBody) with CHART_MIN_HEIGHT as the floor.
const MARGIN_LEFT = 46;
const MARGIN_RIGHT = 10;
const MARGIN_TOP = 20;
const MARGIN_BOTTOM = 16;

/** The subset of the palette the canvas draw needs. */
interface ChartColors {
  readonly grid: string;
  readonly zero: string;
  readonly cursor: string;
  readonly label: string;
  readonly title: string;
  readonly plotBg: string;
}

function chartColorsOf(palette: Palette): ChartColors {
  return {
    grid: palette.chartGrid,
    zero: palette.chartZero,
    cursor: palette.playhead,
    label: palette.chartLabel,
    title: palette.chartTitle,
    plotBg: palette.chartPlotBg,
  };
}

/** A 2D context, or null when the platform lacks canvas 2D (jsdom / no-canvas). */
function get2dContext(canvas: HTMLCanvasElement | null): CanvasRenderingContext2D | null {
  if (!canvas || typeof canvas.getContext !== 'function') {
    return null;
  }
  try {
    return canvas.getContext('2d');
  } catch {
    return null;
  }
}

/** Draw one quantity's chart: axes, nice y-ticks, overlaid per-hand traces, cursor. */
function drawQuantity(
  canvas: HTMLCanvasElement | null,
  quantity: ChartQuantity,
  buffer: Float32Array,
  timeBuffer: Float32Array,
  hands: number,
  windowStart: number,
  timelineWindow: number,
  simTime: number,
  mode: ChartAxisMode,
  colors: ChartColors,
  hiddenHands: ReadonlySet<number>,
  cssHeight: number,
): void {
  const ctx = get2dContext(canvas);
  if (!ctx || !canvas) {
    return;
  }
  const cssWidth = canvas.clientWidth;
  if (cssWidth <= 0 || cssHeight <= 0) {
    return;
  }
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  const needW = Math.round(cssWidth * dpr);
  const needH = Math.round(cssHeight * dpr);
  if (canvas.width !== needW || canvas.height !== needH) {
    canvas.width = needW;
    canvas.height = needH;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const plotLeft = MARGIN_LEFT;
  const plotRight = cssWidth - MARGIN_RIGHT;
  const plotTop = MARGIN_TOP;
  const plotBottom = cssHeight - MARGIN_BOTTOM;
  const plotWidth = plotRight - plotLeft;
  const plotHeight = plotBottom - plotTop;

  // Plot background.
  ctx.fillStyle = colors.plotBg;
  ctx.fillRect(plotLeft, plotTop, plotWidth, plotHeight);

  // Range folds only the SHOWN hands, so hiding the tallest trace rescales the axis.
  const acc = { min: Infinity, max: -Infinity };
  for (let hand = 0; hand < hands; hand++) {
    if (hiddenHands.has(hand)) {
      continue;
    }
    foldSampleRange(buffer, hand * SAMPLE_COUNT, SAMPLE_COUNT, acc);
  }
  const rawMin = Number.isFinite(acc.min) ? acc.min : 0;
  const rawMax = Number.isFinite(acc.max) ? acc.max : 0;
  const dataMin = mode === 'magnitude' ? 0 : Math.min(0, rawMin);
  const dataMax = mode === 'magnitude' ? Math.max(0, rawMax) : Math.max(0, rawMax);
  const scale = niceScale(dataMin, dataMax, 5);
  const span = scale.max - scale.min || 1;
  const yOf = (value: number): number => plotBottom - ((value - scale.min) / span) * plotHeight;
  const xOf = (time: number): number =>
    plotLeft + ((time - windowStart) / timelineWindow) * plotWidth;

  // Y gridlines + labels.
  ctx.font = '11px system-ui, -apple-system, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'right';
  for (const tick of scale.ticks) {
    if (tick < scale.min - 1e-9 || tick > scale.max + 1e-9) {
      continue;
    }
    const y = yOf(tick);
    ctx.strokeStyle = tick === 0 ? colors.zero : colors.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(plotLeft, y);
    ctx.lineTo(plotRight, y);
    ctx.stroke();
    ctx.fillStyle = colors.label;
    ctx.fillText(formatTick(tick, scale.step), plotLeft - 5, y);
  }

  // Per-hand traces (straight polylines; break on any non-finite sample).
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  for (let hand = 0; hand < hands; hand++) {
    if (hiddenHands.has(hand)) {
      continue;
    }
    const base = hand * SAMPLE_COUNT;
    ctx.strokeStyle = handColor(hand);
    ctx.beginPath();
    let penDown = false;
    for (let i = 0; i < SAMPLE_COUNT; i++) {
      const value = buffer[base + i] ?? NaN;
      if (!isFiniteSample(value)) {
        penDown = false;
        continue;
      }
      const x = xOf(timeBuffer[i] ?? windowStart);
      const y = yOf(value);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        penDown = false;
        continue;
      }
      if (penDown) {
        ctx.lineTo(x, y);
      } else {
        ctx.moveTo(x, y);
        penDown = true;
      }
    }
    ctx.stroke();
  }

  // Shared simTime cursor (anchored at CURSOR_FRACTION of the window).
  const cursorX = xOf(simTime);
  ctx.strokeStyle = colors.cursor;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cursorX, plotTop);
  ctx.lineTo(cursorX, plotBottom);
  ctx.stroke();

  // Title (top-left) with unit; window-edge time labels (bottom corners).
  const meta = quantityMeta(quantity, mode);
  ctx.fillStyle = colors.title;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = '600 11px system-ui, -apple-system, sans-serif';
  ctx.fillText(`${meta.title} (${meta.unit})`, plotLeft, plotTop - 6);

  ctx.font = '10px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = colors.label;
  ctx.textBaseline = 'top';
  ctx.fillText(`${Math.max(0, windowStart).toFixed(2)} s`, plotLeft + 1, plotBottom + 3);
  ctx.textAlign = 'right';
  ctx.fillText(`${(windowStart + timelineWindow).toFixed(2)} s`, plotRight, plotBottom + 3);
}

/** The three canvases + the per-frame sampling/draw effect (mounted only when shown). */
function ChartsBody({ hiddenHands }: { readonly hiddenHands: ReadonlySet<number> }): ReactElement {
  const palette = usePalette();
  const sim = useAppStore((state) => state.sim);
  const simTime = useAppStore((state) => state.simTime);
  const handCount = useAppStore((state) => state.handCount);
  const timelineWindow = useAppStore((state) => state.timelineWindow);
  const chartAxisMode = useAppStore((state) => state.chartAxisMode);

  const velocityRef = useRef<HTMLCanvasElement>(null);
  const accelerationRef = useRef<HTMLCanvasElement>(null);
  const jerkRef = useRef<HTMLCanvasElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Responsive canvas height: the dock's height splitter (App.tsx BottomDock)
  // imposes this container's height (the row stretches it, see the layout in
  // <Charts/>); a ResizeObserver measures it ON RESIZE ONLY — never per frame —
  // and the canvases render at that height with CHART_MIN_HEIGHT as the floor.
  // The equality guard stops the observe→setState→layout loop at its fixed point.
  const [canvasHeight, setCanvasHeight] = useState(CHART_MIN_HEIGHT);
  useEffect(() => {
    const element = bodyRef.current;
    if (!element || typeof ResizeObserver === 'undefined') {
      return; // jsdom / no observer: stay at the CHART_MIN_HEIGHT default
    }
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.height ?? element.clientHeight;
      setCanvasHeight((previous) => {
        const next = chartCanvasHeight(measured);
        return next === previous ? previous : next;
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const buffers = useMemo(
    () => ({
      time: new Float32Array(SAMPLE_COUNT),
      velocity: new Float32Array(HAND_COUNT_MAX * SAMPLE_COUNT),
      acceleration: new Float32Array(HAND_COUNT_MAX * SAMPLE_COUNT),
      jerk: new Float32Array(HAND_COUNT_MAX * SAMPLE_COUNT),
    }),
    [],
  );

  useEffect(() => {
    const colors = chartColorsOf(palette);
    const windowStart = simTime - timelineWindow * CURSOR_FRACTION;
    const kinematics = sim.kinematics;
    const hands = Math.min(handCount, HAND_COUNT_MAX);

    // Sample on the ABSOLUTE lattice (gridSampleTime), not the sliding window, so a
    // sample's time — and its value — is invariant to the playhead. The trace then
    // scrolls without re-phasing, which kills the jerk shimmer (owner requirement 4).
    const step = gridStep(timelineWindow, SAMPLE_COUNT);
    for (let i = 0; i < SAMPLE_COUNT; i++) {
      buffers.time[i] = gridSampleTime(i, windowStart, step);
    }
    for (let hand = 0; hand < hands; hand++) {
      if (hiddenHands.has(hand)) {
        continue; // hidden series: skip the per-sample handState work entirely
      }
      const base = hand * SAMPLE_COUNT;
      for (let i = 0; i < SAMPLE_COUNT; i++) {
        const state = kinematics.handState(hand, buffers.time[i] ?? windowStart);
        buffers.velocity[base + i] = scalarFromState(state, 'velocity', chartAxisMode);
        buffers.acceleration[base + i] = scalarFromState(state, 'acceleration', chartAxisMode);
        buffers.jerk[base + i] = scalarFromState(state, 'jerk', chartAxisMode);
      }
    }

    const args = [
      hands,
      windowStart,
      timelineWindow,
      simTime,
      chartAxisMode,
      colors,
      hiddenHands,
      canvasHeight,
    ] as const;
    drawQuantity(velocityRef.current, 'velocity', buffers.velocity, buffers.time, ...args);
    drawQuantity(accelerationRef.current, 'acceleration', buffers.acceleration, buffers.time, ...args);
    drawQuantity(jerkRef.current, 'jerk', buffers.jerk, buffers.time, ...args);
  }, [sim, simTime, handCount, timelineWindow, chartAxisMode, buffers, palette, hiddenHands, canvasHeight]);

  const canvasSizedStyle = { ...canvasStyle, height: `${canvasHeight}px` };
  return (
    <div ref={bodyRef} style={{ display: 'flex', flex: '3 1 0%', minWidth: 0, gap: '0.5rem' }}>
      <canvas ref={velocityRef} aria-label="Hand speed chart" style={canvasSizedStyle} />
      <canvas ref={accelerationRef} aria-label="Hand acceleration chart" style={canvasSizedStyle} />
      <canvas ref={jerkRef} aria-label="Hand jerk chart" style={canvasSizedStyle} />
    </div>
  );
}

const AXIS_OPTIONS: readonly { readonly value: ChartAxisMode; readonly label: string }[] = [
  { value: 'magnitude', label: 'Magnitude' },
  { value: 'x', label: 'X' },
  { value: 'y', label: 'Y' },
  { value: 'z', label: 'Z' },
];

/**
 * The color legend: a toggle button per active hand (shared across all three charts).
 *
 * Clicking a hand toggles its series on/off in the charts (owner requirement 2):
 * when off the label fades and the swatch goes HOLLOW (a colored border, transparent
 * fill). The toggle state is component-local (never persisted to the store or URL) —
 * a transient view of the charts, not a shared setting. Hovering (or keyboard-focusing)
 * an item highlights the corresponding hand's cup in the 3D scene via the store's
 * `hoveredHandIndex` (owner requirement 3), cleared on leave/blur.
 */
function Legend({
  handCount,
  hiddenHands,
  onToggle,
}: {
  readonly handCount: number;
  readonly hiddenHands: ReadonlySet<number>;
  readonly onToggle: (hand: number) => void;
}): ReactElement {
  const palette = usePalette();
  const setHoveredHandIndex = useAppStore((state) => state.setHoveredHandIndex);
  // If the dock/legend unmounts mid-hover (e.g. the operator collapses the charts
  // while a legend item is highlighted), the pointer never fires its leave/blur — so
  // clear the scene highlight on unmount, else a cup stays lit with nothing hovering it.
  useEffect(() => () => setHoveredHandIndex(null), [setHoveredHandIndex]);
  const items: ReactElement[] = [];
  for (let hand = 0; hand < handCount; hand++) {
    const color = handColor(hand);
    const shown = !hiddenHands.has(hand);
    items.push(
      <button
        key={hand}
        type="button"
        aria-pressed={shown}
        aria-label={`Hand ${hand} series: ${shown ? 'shown' : 'hidden'} (click to toggle, hover to highlight in scene)`}
        onClick={() => onToggle(hand)}
        onMouseEnter={() => setHoveredHandIndex(hand)}
        onMouseLeave={() => setHoveredHandIndex(null)}
        onFocus={() => setHoveredHandIndex(hand)}
        onBlur={() => setHoveredHandIndex(null)}
        style={{
          ...legendItemStyle,
          color: shown ? palette.textSecondary : palette.textMuted,
          opacity: shown ? 1 : 0.6,
        }}
      >
        <span
          style={{
            ...legendSwatchStyle,
            background: shown ? color : 'transparent',
            border: `1.5px solid ${color}`,
          }}
        />
        Hand {hand}
      </button>,
    );
  }
  return (
    <div
      role="group"
      aria-label="Chart legend"
      style={{ ...legendRowStyle, color: palette.textSecondary }}
    >
      {items}
    </div>
  );
}

/**
 * The collapsible charts + energy DOCK. The toggle collapses the whole dock to a
 * slim tab bar; when collapsed the body unmounts, so no per-frame sampling runs.
 * The header never subscribes to simTime, so it never re-renders per frame.
 */
export function Charts(): ReactElement {
  const palette = usePalette();
  const chartsVisible = useAppStore((state) => state.chartsVisible);
  const chartAxisMode = useAppStore((state) => state.chartAxisMode);
  const handCount = useAppStore((state) => state.handCount);
  const toggleCharts = useAppStore((state) => state.toggleCharts);
  const setChartAxisMode = useAppStore((state) => state.setChartAxisMode);
  const setHoveredHandIndex = useAppStore((state) => state.setHoveredHandIndex);

  // Which hand series are toggled OFF in the charts (owner requirement 2). Kept
  // component-local: it is a transient view of the charts, not a shared setting, so
  // it is deliberately NOT persisted to the store or the URL codec.
  const [hiddenHands, setHiddenHands] = useState<ReadonlySet<number>>(() => new Set<number>());
  const toggleHand = useCallback((hand: number) => {
    setHiddenHands((prev) => {
      const next = new Set(prev);
      if (next.has(hand)) {
        next.delete(hand);
      } else {
        next.add(hand);
      }
      return next;
    });
  }, []);

  return (
    <section
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
        padding: chartsVisible ? '0.5rem 0.7rem 0.6rem' : '0.3rem 0.7rem',
        background: palette.panel,
        borderRadius: '0.55rem',
        border: `1px solid ${palette.border}`,
        width: '100%',
        // Fill the dock wrapper so the height splitter reaches the charts: once the
        // dock is dragged the wrapper's height is definite and 100% fills it; before
        // any drag the wrapper is auto-height, a percentage against auto resolves to
        // auto (CSS), and the section stays natural — the pre-splitter layout.
        // Global border-box (ui/theme) keeps the padding inside the 100%.
        height: '100%',
      }}
      aria-label="Charts and energy panel"
      // Clear the scene highlight when the pointer leaves the whole dock, in case it
      // slips off a legend item onto a gap rather than firing the item's leave.
      onMouseLeave={() => setHoveredHandIndex(null)}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem 1rem', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: '0.85rem', color: palette.textPrimary, fontWeight: 700 }}>
          Charts &amp; energy
        </h2>
        {chartsVisible ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <span style={{ fontWeight: 600, fontSize: '0.78rem', color: palette.textSecondary }}>
                Component
              </span>
              <div style={{ display: 'flex', gap: '0.3rem' }}>
                {AXIS_OPTIONS.map((option) => {
                  const active = option.value === chartAxisMode;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-label={`Chart component: ${option.label}`}
                      aria-pressed={active}
                      onClick={() => setChartAxisMode(option.value)}
                      style={axisButtonStyle(palette, active)}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <Legend handCount={handCount} hiddenHands={hiddenHands} onToggle={toggleHand} />
          </>
        ) : (
          <span style={{ fontSize: '0.76rem', color: palette.textMuted }}>
            per-hand |v| · |a| · |j| and the energy table
          </span>
        )}
        <div style={{ flex: 1 }} />
        <Button
          onClick={toggleCharts}
          ariaLabel="Toggle charts and energy panel"
          ariaPressed={chartsVisible}
          variant={chartsVisible ? 'default' : 'primary'}
        >
          {chartsVisible ? 'Hide charts ▾' : 'Show charts ▴'}
        </Button>
      </div>

      {chartsVisible ? (
        // flex '1 1 auto' + minHeight 0: the row takes the section's leftover height
        // when the dock height is fixed (content-sized before any drag, since basis
        // auto never collapses in an auto-height column). alignItems stretch hands
        // that height to the ChartsBody container, where the ResizeObserver reads it.
        // NO flexWrap here: in a wrapped container a line's cross-size never drops
        // below its items' content height, so the canvases would RATCHET the measured
        // height (grow-only; verified headless). Single-line stretch tracks the row
        // height both ways; wrap was vestigial anyway (both children have basis 0%).
        <div
          style={{
            display: 'flex',
            gap: '0.8rem',
            alignItems: 'stretch',
            flex: '1 1 auto',
            minHeight: 0,
          }}
        >
          <ChartsBody hiddenHands={hiddenHands} />
          {/* 60/40 split (owner requirement 1): charts get flex-grow 3, energy 2, both
              on a 0% basis so the ratio holds at every width. minWidth 0 keeps the
              energy panel SHRINKABLE — a real/max-content basis here would let the
              (non-wrapping) table starve the chart canvases at very wide viewports
              (the owner-reported collapse; verified fixed at ~2000px and ≥2400px). */}
          <div style={{ flex: '2 1 0%', minWidth: 0 }}>
            <EnergyPanel />
          </div>
        </div>
      ) : null}
    </section>
  );
}

// --- Inline styling ----------------------------------------------------------

// Height is applied dynamically in ChartsBody (splitter-responsive, floor
// CHART_MIN_HEIGHT); everything else about the canvas geometry is static.
const canvasStyle: CSSProperties = {
  display: 'block',
  flex: 1,
  minWidth: 0,
  width: '100%',
};

const legendRowStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.3rem 0.7rem',
  alignItems: 'center',
  fontSize: '0.76rem',
};

const legendItemStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.3rem',
  // Reset native <button> chrome so the toggle reads as a plain legend entry.
  background: 'transparent',
  border: 'none',
  padding: 0,
  margin: 0,
  font: 'inherit',
  lineHeight: 1.2,
  cursor: 'pointer',
};

const legendSwatchStyle: CSSProperties = {
  display: 'inline-block',
  width: '0.7rem',
  height: '0.7rem',
  borderRadius: '0.15rem',
};

function axisButtonStyle(palette: Palette, active: boolean): CSSProperties {
  return {
    padding: '0.28rem 0.55rem',
    borderRadius: '0.4rem',
    border: `1px solid ${active ? palette.accent : palette.border}`,
    background: active ? palette.accent : palette.panelAlt,
    fontWeight: 600,
    fontSize: '0.76rem',
    color: active ? palette.accentText : palette.textSecondary,
    cursor: 'pointer',
  };
}
