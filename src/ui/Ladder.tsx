// src/ui/Ladder — the ladder diagram (DESIGN.md §6), the engine's debug view.
//
// ORIENTATION (owner override 2026-07-11, decided by the orchestrator): the ladder
// is VERTICAL. TIME flows TOP→BOTTOM; there is one COLUMN per hand (header label at
// the top of each column). A flight is an arc that leaves its throwing hand's column
// and lands on the catching hand's column (the bow grows sideways with the throw
// value). A carry is a vertical segment down a column from a catch to the next throw
// (held 2s make a long multi-beat carry). Throw/catch dots mark the events, and a
// single HORIZONTAL cursor line marks the shared simTime at CURSOR_FRACTION of the
// plot height (the window scrolls with the playhead, same `timelineWindow` as the
// timeline bar). The SVG fills the right column's height.
//
// To flip back to horizontal, swap the two axis maps in `makeFrame` (time↔one axis,
// hand↔the other) and the header/gutter placement; everything else is expressed via
// `yOf(time)` / `laneX(hand)` so the geometry follows.
//
// SVG (not canvas) for crisp text/vectors and simple declarative React re-render —
// no chart library (DESIGN.md §6). Ball-colored arcs/carries keep the exact
// `resolveBallColor` stroke (the ladder ↔ 3D color-agreement test reads the `stroke`
// attribute directly); only the frame/lane/grid colors are theme-aware (dark-first).

import type { ReactElement } from 'react';
import { useAppStore } from '../state';
import { resolveBallColor } from '../state/ballColors';
import { firstBeatAtOrAfter, windowSpans, type Simulation } from '../state/simulation';
import { usePalette, type Palette } from './theme';

// Logical SVG coordinate space (scaled to fit the container via viewBox). Time is
// the VERTICAL axis; hands are the horizontal COLUMNS.
const AXIS_COL = 56; // left gutter for beat-index labels
const LANE_WIDTH = 118; // width of one hand column
const HEADER_H = 30; // top strip for the column (hand) labels
const PLOT_TOP = HEADER_H;
const PLOT_H = 760; // tall plot so height is the limiting dimension → fills height
const PLOT_BOTTOM = PLOT_TOP + PLOT_H;
const PLOT_LEFT = AXIS_COL;
const RIGHT_MARGIN = 16;
const BOTTOM_MARGIN = 22;

/** `(ballId) => cssColor`, threaded from the store's coloring settings. */
type BallColorOf = (ballId: number) => string;

interface Frame {
  readonly windowStart: number;
  readonly windowEnd: number;
  readonly timelineWindow: number;
  readonly plotRight: number;
  readonly width: number;
  readonly height: number;
  readonly handCount: number;
  /** y (vertical) for a sim time — earlier at the top, later at the bottom. */
  yOf(time: number): number;
  /** x (column center) for a hand. */
  laneX(hand: number): number;
}

function makeFrame(simTime: number, handCount: number, timelineWindow: number): Frame {
  const { pastSpan, futureSpan } = windowSpans(timelineWindow);
  const windowStart = simTime - pastSpan;
  const windowEnd = simTime + futureSpan;
  const plotRight = PLOT_LEFT + handCount * LANE_WIDTH;
  return {
    windowStart,
    windowEnd,
    timelineWindow,
    plotRight,
    width: plotRight + RIGHT_MARGIN,
    height: PLOT_BOTTOM + BOTTOM_MARGIN,
    handCount,
    yOf: (time) => PLOT_TOP + ((time - windowStart) / timelineWindow) * PLOT_H,
    laneX: (hand) => PLOT_LEFT + (hand + 0.5) * LANE_WIDTH,
  };
}

/** Full words for a few hands; compact HN tags once the columns get crowded. */
function handLabel(hand: number, handCount: number): string {
  return handCount > 4 ? `H${hand}` : `Hand ${hand}`;
}

function LaneBackground({ frame, palette }: { frame: Frame; palette: Palette }): ReactElement {
  const lanes: ReactElement[] = [];
  for (let hand = 0; hand < frame.handCount; hand += 1) {
    const x = frame.laneX(hand);
    lanes.push(
      <g key={hand}>
        <line x1={x} y1={PLOT_TOP} x2={x} y2={PLOT_BOTTOM} stroke={palette.laneLine} strokeWidth={1} />
        <text x={x} y={PLOT_TOP - 11} textAnchor="middle" fontSize={15} fontWeight={600} fill={palette.textSecondary}>
          {handLabel(hand, frame.handCount)}
        </text>
      </g>,
    );
  }
  return <>{lanes}</>;
}

function BeatGrid({ sim, frame, palette }: { sim: Simulation; frame: Frame; palette: Palette }): ReactElement {
  const marks: ReactElement[] = [];
  const startBeat = firstBeatAtOrAfter(sim.timeline, Math.max(frame.windowStart, 0));
  for (let beat = startBeat; beat < sim.beatCount; beat += 1) {
    const time = sim.timeline.beatTime(beat);
    if (time > frame.windowEnd) {
      break;
    }
    const y = frame.yOf(time);
    marks.push(
      <g key={beat}>
        <line x1={PLOT_LEFT} y1={y} x2={frame.plotRight} y2={y} stroke={palette.gridLine} strokeWidth={1} />
        <text x={PLOT_LEFT - 8} y={y + 4} textAnchor="end" fontSize={13} fill={palette.textMuted}>
          {beat}
        </text>
      </g>,
    );
  }
  return <>{marks}</>;
}

function Carries({
  sim,
  frame,
  colorOf,
}: {
  sim: Simulation;
  frame: Frame;
  colorOf: BallColorOf;
}): ReactElement {
  const segments: ReactElement[] = [];
  for (const carry of sim.timeline.carries) {
    if (carry.startBeat < 0) {
      continue;
    }
    if (carry.endTime < frame.windowStart || carry.startTime > frame.windowEnd) {
      continue;
    }
    const x = frame.laneX(carry.hand);
    segments.push(
      <line
        key={`carry-${carry.ballId}-${carry.startBeat}`}
        data-ball-id={carry.ballId}
        x1={x}
        y1={frame.yOf(carry.startTime)}
        x2={x}
        y2={frame.yOf(carry.endTime)}
        stroke={colorOf(carry.ballId)}
        strokeWidth={carry.held ? 11 : 7}
        strokeLinecap="round"
        opacity={carry.held ? 0.9 : 0.75}
      />,
    );
  }
  return <>{segments}</>;
}

function Flights({
  sim,
  frame,
  colorOf,
  palette,
}: {
  sim: Simulation;
  frame: Frame;
  colorOf: BallColorOf;
  palette: Palette;
}): ReactElement {
  const arcs: ReactElement[] = [];
  const dots: ReactElement[] = [];
  for (const flight of sim.timeline.flights) {
    if (flight.throwBeat < 0) {
      continue;
    }
    if (flight.arrivalTime < frame.windowStart || flight.throwTime > frame.windowEnd) {
      continue;
    }
    const color = colorOf(flight.ballId);
    const x0 = frame.laneX(flight.throwHand);
    const y0 = frame.yOf(flight.throwTime);
    const x1 = frame.laneX(flight.landingHand);
    const y1 = frame.yOf(flight.arrivalTime);
    const midY = frame.yOf((flight.throwTime + flight.arrivalTime) / 2);
    // Bow sideways (the non-time axis), growing with the throw value. Cross throws
    // bow toward the landing side; self-throws bow into the plot (away from an edge
    // column) so the loop stays visible. Clamp so the control point stays on-canvas.
    const bow = 14 + flight.value * 8;
    const direction =
      flight.landingHand === flight.throwHand
        ? flight.throwHand === frame.handCount - 1 && frame.handCount > 1
          ? -1
          : 1
        : flight.landingHand > flight.throwHand
          ? 1
          : -1;
    const controlX = Math.max(8, Math.min(frame.width - 8, (x0 + x1) / 2 + direction * bow));
    arcs.push(
      <path
        key={`arc-${flight.ballId}-${flight.throwBeat}`}
        data-ball-id={flight.ballId}
        d={`M ${x0} ${y0} Q ${controlX} ${midY} ${x1} ${y1}`}
        fill="none"
        stroke={color}
        strokeWidth={2}
        opacity={0.9}
      />,
    );
    dots.push(
      <circle key={`throw-${flight.ballId}-${flight.throwBeat}`} cx={x0} cy={y0} r={5} fill={color} />,
      <circle
        key={`catch-${flight.ballId}-${flight.throwBeat}`}
        cx={x1}
        cy={y1}
        r={5}
        fill={palette.chartPlotBg}
        stroke={color}
        strokeWidth={2}
      />,
    );
  }
  return (
    <>
      {arcs}
      {dots}
    </>
  );
}

function Idles({ sim, frame, palette }: { sim: Simulation; frame: Frame; palette: Palette }): ReactElement {
  const marks: ReactElement[] = [];
  for (const event of sim.timeline.events) {
    if (event.kind !== 'idle' || event.beat < 0) {
      continue;
    }
    if (event.time < frame.windowStart || event.time > frame.windowEnd) {
      continue;
    }
    const x = frame.laneX(event.hand);
    const y = frame.yOf(event.time);
    marks.push(
      <g key={`idle-${event.beat}`} stroke={palette.textMuted} strokeWidth={1.5}>
        <line x1={x - 4} y1={y - 4} x2={x + 4} y2={y + 4} />
        <line x1={x - 4} y1={y + 4} x2={x + 4} y2={y - 4} />
      </g>,
    );
  }
  return <>{marks}</>;
}

function Cursor({
  sim,
  frame,
  simTime,
  palette,
}: {
  sim: Simulation;
  frame: Frame;
  simTime: number;
  palette: Palette;
}): ReactElement {
  const y = frame.yOf(simTime);
  const atOrAfter = firstBeatAtOrAfter(sim.timeline, simTime);
  const currentBeat =
    atOrAfter < sim.beatCount && sim.timeline.beatTime(atOrAfter) <= simTime + 1e-9
      ? atOrAfter
      : Math.max(0, atOrAfter - 1);
  return (
    <g>
      <line
        x1={PLOT_LEFT - 6}
        y1={y}
        x2={frame.plotRight + 4}
        y2={y}
        stroke={palette.playhead}
        strokeWidth={2}
      />
      <text x={PLOT_LEFT + 2} y={y - 6} fontSize={13} fill={palette.playhead}>
        t = {simTime.toFixed(2)} s · beat {currentBeat}
      </text>
    </g>
  );
}

/** The ladder diagram, rendered from the shared simTime and derived simulation. */
export function Ladder(): ReactElement {
  const palette = usePalette();
  const sim = useAppStore((state) => state.sim);
  const simTime = useAppStore((state) => state.simTime);
  const handCount = useAppStore((state) => state.handCount);
  const timelineWindow = useAppStore((state) => state.timelineWindow);
  const orbitColoring = useAppStore((state) => state.orbitColoring);
  const singleBallColor = useAppStore((state) => state.ballColor);
  const colorOf: BallColorOf = (ballId) => resolveBallColor(orbitColoring, singleBallColor, ballId);
  const frame = makeFrame(simTime, handCount, timelineWindow);

  return (
    <svg
      role="img"
      aria-label="Ladder diagram: time vertical (top→bottom), one column per hand"
      viewBox={`0 0 ${frame.width} ${frame.height}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ display: 'block', width: '100%', height: '100%' }}
    >
      <defs>
        {/* Clip the scrolling content to the time band so nothing paints before the
            window start (above) or after the window end (below). */}
        <clipPath id="ladder-plot-clip">
          <rect x={0} y={PLOT_TOP} width={frame.width} height={PLOT_H} />
        </clipPath>
      </defs>

      {/* Static frame (unclipped): plot well, columns, hand labels. */}
      <rect
        x={PLOT_LEFT}
        y={PLOT_TOP}
        width={frame.plotRight - PLOT_LEFT}
        height={PLOT_H}
        fill={palette.chartPlotBg}
        stroke={palette.border}
        strokeWidth={1}
      />
      <LaneBackground frame={frame} palette={palette} />
      <text x={AXIS_COL / 2} y={PLOT_TOP - 11} textAnchor="middle" fontSize={12} fill={palette.textMuted}>
        t ↓
      </text>

      {/* Scrolling content (clipped to the time band). */}
      <g clipPath="url(#ladder-plot-clip)">
        <BeatGrid sim={sim} frame={frame} palette={palette} />
        <Carries sim={sim} frame={frame} colorOf={colorOf} />
        <Flights sim={sim} frame={frame} colorOf={colorOf} palette={palette} />
        <Idles sim={sim} frame={frame} palette={palette} />
        <Cursor sim={sim} frame={frame} simTime={simTime} palette={palette} />
      </g>

      {/* Axis caption. */}
      <text x={PLOT_LEFT} y={frame.height - 7} fontSize={12} fill={palette.textMuted}>
        beat index at left · window = {frame.timelineWindow.toFixed(1)} s
      </text>
    </svg>
  );
}
