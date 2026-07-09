// src/ui/Charts — the per-hand kinematics charts panel (DESIGN.md §6).
//
// Three stacked canvas charts — hand speed |v|, acceleration |a|, jerk |j| — with
// every hand overlaid (a color per hand + a shared legend), so you can compare
// hands directly: the dwell-clamp on a 1-throw shows as one hand's tall spike
// against the others. The per-axis toggle (Magnitude / X / Y / Z) switches all
// three from vector magnitude to a single component. The x-axis is the SAME window
// as the timeline bar / ladder and a shared red cursor marks simTime across all
// three (DESIGN.md §2: one clock).
//
// Layout choice (overlaid, not per-hand rows): at n_h up to 8, three tall charts
// with 8 overlaid traces stay readable and compact, and overlaying is what makes
// the per-hand comparison legible. Rendering is hand-rolled canvas 2D (no chart
// library, DESIGN.md §6), HiDPI-aware (devicePixelRatio), y-axis auto-scaled with
// nice ticks (src/ui/charts). Discontinuities are honest: the quintic jerk STEPS
// at events and the cubic carry's acceleration JUMPS — drawn as the near-vertical
// segment between the straddling samples, never smoothed; non-finite samples break
// the polyline so no NaN reaches the path.
//
// Hot path: the charts redraw every frame while playing (the window scrolls).
// handState is sampled per hand over the window into Float32Arrays allocated ONCE
// (sized for the max hand count × the fixed sample count) and overwritten in place
// — no per-frame array allocation in the sampling loop beyond core's handState.
// When the panel is hidden the body unmounts, so nothing is sampled or drawn.

import {
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type ReactElement,
} from 'react';
import { HAND_COUNT_MAX, useAppStore, type ChartAxisMode } from '../state';
import { CURSOR_FRACTION } from '../state/simulation';
import { EnergyPanel } from './EnergyPanel';
import {
  foldSampleRange,
  formatTick,
  handColor,
  isFiniteSample,
  niceScale,
  quantityMeta,
  SAMPLE_COUNT,
  scalarFromState,
  windowSampleTime,
  type ChartQuantity,
} from './charts';

// Chart canvas CSS geometry (logical px; the backing store scales by dpr).
const CHART_HEIGHT = 132;
const MARGIN_LEFT = 48;
const MARGIN_RIGHT = 10;
const MARGIN_TOP = 18;
const MARGIN_BOTTOM = 16;

const GRID_COLOR = '#eceef2';
const ZERO_COLOR = '#b3b9c4';
const CURSOR_COLOR = '#e5484d';
const LABEL_COLOR = '#8a93a2';
const TITLE_COLOR = '#3b4252';
const PLOT_BG = '#fbfcfe';

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
): void {
  const ctx = get2dContext(canvas);
  if (!ctx || !canvas) {
    return;
  }
  const cssWidth = canvas.clientWidth;
  const cssHeight = CHART_HEIGHT;
  if (cssWidth <= 0) {
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
  ctx.fillStyle = PLOT_BG;
  ctx.fillRect(plotLeft, plotTop, plotWidth, plotHeight);

  // Y-axis range: fold the finite samples; magnitude sits on a 0 floor, component
  // mode includes 0 so the sign (and the zero line) reads.
  const acc = { min: Infinity, max: -Infinity };
  for (let hand = 0; hand < hands; hand++) {
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
    ctx.strokeStyle = tick === 0 ? ZERO_COLOR : GRID_COLOR;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(plotLeft, y);
    ctx.lineTo(plotRight, y);
    ctx.stroke();
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(formatTick(tick, scale.step), plotLeft - 5, y);
  }

  // Per-hand traces (straight polylines; break on any non-finite sample).
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  for (let hand = 0; hand < hands; hand++) {
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
  ctx.strokeStyle = CURSOR_COLOR;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cursorX, plotTop);
  ctx.lineTo(cursorX, plotBottom);
  ctx.stroke();

  // Title (top-left) with unit; window-edge time labels (bottom corners).
  const meta = quantityMeta(quantity, mode);
  ctx.fillStyle = TITLE_COLOR;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = '600 11px system-ui, -apple-system, sans-serif';
  ctx.fillText(`${meta.title} (${meta.unit})`, plotLeft, plotTop - 6);

  ctx.font = '10px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = LABEL_COLOR;
  ctx.textBaseline = 'top';
  ctx.fillText(`${Math.max(0, windowStart).toFixed(2)} s`, plotLeft + 1, plotBottom + 3);
  ctx.textAlign = 'right';
  ctx.fillText(`${(windowStart + timelineWindow).toFixed(2)} s`, plotRight, plotBottom + 3);
}

/** The three canvases + the per-frame sampling/draw effect (mounted only when shown). */
function ChartsBody(): ReactElement {
  const sim = useAppStore((state) => state.sim);
  const simTime = useAppStore((state) => state.simTime);
  const handCount = useAppStore((state) => state.handCount);
  const timelineWindow = useAppStore((state) => state.timelineWindow);
  const chartAxisMode = useAppStore((state) => state.chartAxisMode);

  const velocityRef = useRef<HTMLCanvasElement>(null);
  const accelerationRef = useRef<HTMLCanvasElement>(null);
  const jerkRef = useRef<HTMLCanvasElement>(null);

  // Buffers allocated ONCE (max hands × fixed sample count), reused every frame.
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
    // Inline the past-span (avoid a per-frame windowSpans object): this effect
    // runs every frame while playing (Phase 9 hot-path pass).
    const windowStart = simTime - timelineWindow * CURSOR_FRACTION;
    const kinematics = sim.kinematics;
    const hands = Math.min(handCount, HAND_COUNT_MAX);

    // Sample times across the window (shared x-axis).
    for (let i = 0; i < SAMPLE_COUNT; i++) {
      buffers.time[i] = windowSampleTime(i, SAMPLE_COUNT, windowStart, timelineWindow);
    }
    // One handState evaluation per (hand, sample) fills all three quantity buffers.
    for (let hand = 0; hand < hands; hand++) {
      const base = hand * SAMPLE_COUNT;
      for (let i = 0; i < SAMPLE_COUNT; i++) {
        const state = kinematics.handState(hand, buffers.time[i] ?? windowStart);
        buffers.velocity[base + i] = scalarFromState(state, 'velocity', chartAxisMode);
        buffers.acceleration[base + i] = scalarFromState(state, 'acceleration', chartAxisMode);
        buffers.jerk[base + i] = scalarFromState(state, 'jerk', chartAxisMode);
      }
    }

    drawQuantity(
      velocityRef.current,
      'velocity',
      buffers.velocity,
      buffers.time,
      hands,
      windowStart,
      timelineWindow,
      simTime,
      chartAxisMode,
    );
    drawQuantity(
      accelerationRef.current,
      'acceleration',
      buffers.acceleration,
      buffers.time,
      hands,
      windowStart,
      timelineWindow,
      simTime,
      chartAxisMode,
    );
    drawQuantity(
      jerkRef.current,
      'jerk',
      buffers.jerk,
      buffers.time,
      hands,
      windowStart,
      timelineWindow,
      simTime,
      chartAxisMode,
    );
  }, [sim, simTime, handCount, timelineWindow, chartAxisMode, buffers]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <canvas ref={velocityRef} aria-label="Hand speed chart" style={canvasStyle} />
      <canvas ref={accelerationRef} aria-label="Hand acceleration chart" style={canvasStyle} />
      <canvas ref={jerkRef} aria-label="Hand jerk chart" style={canvasStyle} />
    </div>
  );
}

const AXIS_OPTIONS: readonly { readonly value: ChartAxisMode; readonly label: string }[] = [
  { value: 'magnitude', label: 'Magnitude' },
  { value: 'x', label: 'X' },
  { value: 'y', label: 'Y' },
  { value: 'z', label: 'Z' },
];

/** The color legend: a swatch + label per active hand (shared across charts). */
function Legend({ handCount }: { readonly handCount: number }): ReactElement {
  const items: ReactElement[] = [];
  for (let hand = 0; hand < handCount; hand++) {
    items.push(
      <span key={hand} style={legendItemStyle}>
        <span style={{ ...legendSwatchStyle, background: handColor(hand) }} />
        Hand {hand}
      </span>,
    );
  }
  return (
    <div role="group" aria-label="Chart legend" style={legendRowStyle}>
      {items}
    </div>
  );
}

/**
 * The collapsible charts + energy panel. The "Charts" toggle hides the whole
 * section; when hidden, {@link ChartsBody} (and the energy panel) unmount, so no
 * per-frame sampling happens. The header (title, toggle, axis mode, legend) does
 * NOT subscribe to simTime, so it never re-renders per frame — only the body does.
 */
export function Charts(): ReactElement {
  const chartsVisible = useAppStore((state) => state.chartsVisible);
  const chartAxisMode = useAppStore((state) => state.chartAxisMode);
  const handCount = useAppStore((state) => state.handCount);
  const toggleCharts = useAppStore((state) => state.toggleCharts);
  const setChartAxisMode = useAppStore((state) => state.setChartAxisMode);

  return (
    <section style={sectionStyle} aria-label="Charts and energy panel">
      <div style={headerRowStyle}>
        <h2 style={{ margin: 0, fontSize: '1rem', color: TITLE_COLOR }}>Charts &amp; energy</h2>
        <button
          type="button"
          onClick={toggleCharts}
          aria-pressed={chartsVisible}
          aria-label="Toggle charts and energy panel"
          style={toggleButtonStyle}
        >
          {chartsVisible ? 'Hide charts' : 'Show charts'}
        </button>
      </div>

      {chartsVisible ? (
        <>
          <div style={controlRowStyle}>
            <span style={{ fontWeight: 600, fontSize: '0.85rem', color: TITLE_COLOR }}>
              Component
            </span>
            <div style={{ display: 'flex', gap: '0.35rem' }}>
              {AXIS_OPTIONS.map((option) => {
                const active = option.value === chartAxisMode;
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-label={`Chart component: ${option.label}`}
                    aria-pressed={active}
                    onClick={() => setChartAxisMode(option.value)}
                    style={{ ...axisButtonStyle, ...(active ? axisButtonActiveStyle : null) }}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            <Legend handCount={handCount} />
          </div>

          <ChartsBody />
          <EnergyPanelDivider />
          <EnergyPanel />
        </>
      ) : null}
    </section>
  );
}

/** A thin labeled divider between the charts and the energy table. */
function EnergyPanelDivider(): ReactElement {
  return (
    <div style={dividerRowStyle}>
      <span style={{ fontWeight: 600, fontSize: '0.85rem', color: TITLE_COLOR }}>
        Energy (per hand, one period)
      </span>
      <span style={{ flex: 1, height: 1, background: '#e2e6ec' }} />
    </div>
  );
}

// --- Inline styling (matches the light shell of the Phase 3–6 UI) ------------

const sectionStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.6rem',
  padding: '0.75rem',
  background: '#ffffff',
  borderRadius: '0.6rem',
  border: '1px solid #dfe3ea',
  width: '100%',
};

const headerRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.5rem',
};

const controlRowStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: '0.6rem 1rem',
};

const dividerRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.6rem',
  marginTop: '0.2rem',
};

const canvasStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  height: `${CHART_HEIGHT}px`,
  background: '#ffffff',
};

const legendRowStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.35rem 0.75rem',
  alignItems: 'center',
  fontSize: '0.8rem',
  color: '#5b6472',
};

const legendItemStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.3rem',
};

const legendSwatchStyle: CSSProperties = {
  display: 'inline-block',
  width: '0.7rem',
  height: '0.7rem',
  borderRadius: '0.15rem',
};

const toggleButtonStyle: CSSProperties = {
  padding: '0.35rem 0.8rem',
  borderRadius: '0.4rem',
  border: '1px solid #c8cdd6',
  background: '#ffffff',
  fontWeight: 600,
  fontSize: '0.85rem',
  cursor: 'pointer',
};

const axisButtonStyle: CSSProperties = {
  padding: '0.3rem 0.6rem',
  borderRadius: '0.4rem',
  border: '1px solid #c8cdd6',
  background: '#ffffff',
  fontWeight: 600,
  fontSize: '0.8rem',
  color: '#3b4252',
  cursor: 'pointer',
};

const axisButtonActiveStyle: CSSProperties = {
  background: '#2f6fed',
  borderColor: '#2f6fed',
  color: '#ffffff',
};
