// src/ui/Ladder — the ladder diagram (DESIGN.md §6), the engine's debug view.
//
// Time runs left→right; one horizontal lane per hand. A flight is an arc that
// leaves its throwing hand's lane and lands on the catching hand's lane (bow
// height grows with the throw value). A carry is a segment along a lane from a
// catch to the next throw (held 2s make a long multi-beat carry). Throw/catch
// dots mark the events, and a single vertical cursor marks the shared simTime.
// The window scrolls with the playhead. SVG (not canvas) for crisp text/vectors
// and simple declarative React re-render — no chart library (DESIGN.md §6).

import type { ReactElement } from 'react';
import { useAppStore } from '../state';
import { firstBeatAtOrAfter, windowSpans, type Simulation } from '../state/simulation';

// Logical SVG coordinate space (scaled to the container width via viewBox).
const W = 1000;
const LANE_HEIGHT = 72;
const PLOT_LEFT = 104;
const PLOT_RIGHT = W - 20;
const PLOT_TOP = 58;
const PLOT_W = PLOT_RIGHT - PLOT_LEFT;
const AXIS_ROW = 40;

// Per-ball readability palette (a debug aid; the per-orbit coloring toggle that
// mirrors the 3D scene is Phase 4). Consistent hue per physical ball id.
const BALL_PALETTE = [
  '#2f6fed',
  '#e8710a',
  '#12a150',
  '#d4306c',
  '#8b5cf6',
  '#0aa5c4',
  '#b58900',
  '#dc2626',
];

function ballColor(ballId: number): string {
  const n = BALL_PALETTE.length;
  const index = ((ballId % n) + n) % n;
  return BALL_PALETTE[index] ?? '#666';
}

interface Frame {
  readonly windowStart: number;
  readonly windowEnd: number;
  readonly timelineWindow: number;
  readonly plotBottom: number;
  readonly height: number;
  readonly handCount: number;
  xOf(time: number): number;
  laneY(hand: number): number;
}

function makeFrame(simTime: number, handCount: number, timelineWindow: number): Frame {
  const { pastSpan, futureSpan } = windowSpans(timelineWindow);
  const windowStart = simTime - pastSpan;
  const windowEnd = simTime + futureSpan;
  const plotBottom = PLOT_TOP + handCount * LANE_HEIGHT;
  return {
    windowStart,
    windowEnd,
    timelineWindow,
    plotBottom,
    height: plotBottom + AXIS_ROW,
    handCount,
    xOf: (time) => PLOT_LEFT + ((time - windowStart) / timelineWindow) * PLOT_W,
    laneY: (hand) => PLOT_TOP + (hand + 0.5) * LANE_HEIGHT,
  };
}

function LaneBackground({ frame }: { frame: Frame }): ReactElement {
  const lanes: ReactElement[] = [];
  for (let hand = 0; hand < frame.handCount; hand += 1) {
    const y = frame.laneY(hand);
    lanes.push(
      <g key={hand}>
        <line x1={PLOT_LEFT} y1={y} x2={PLOT_RIGHT} y2={y} stroke="#c8cdd6" strokeWidth={1} />
        <text x={PLOT_LEFT - 12} y={y + 4} textAnchor="end" fontSize={15} fill="#3b4252">
          Hand {hand}
        </text>
      </g>,
    );
  }
  return <>{lanes}</>;
}

function BeatGrid({ sim, frame }: { sim: Simulation; frame: Frame }): ReactElement {
  const marks: ReactElement[] = [];
  const startBeat = firstBeatAtOrAfter(sim.timeline, Math.max(frame.windowStart, 0));
  for (let beat = startBeat; beat < sim.beatCount; beat += 1) {
    const time = sim.timeline.beatTime(beat);
    if (time > frame.windowEnd) {
      break;
    }
    const x = frame.xOf(time);
    marks.push(
      <g key={beat}>
        <line x1={x} y1={PLOT_TOP} x2={x} y2={frame.plotBottom} stroke="#eceef2" strokeWidth={1} />
        <text x={x} y={frame.plotBottom + 22} textAnchor="middle" fontSize={13} fill="#8a93a2">
          {beat}
        </text>
      </g>,
    );
  }
  return <>{marks}</>;
}

function Carries({ sim, frame }: { sim: Simulation; frame: Frame }): ReactElement {
  const segments: ReactElement[] = [];
  for (const carry of sim.timeline.carries) {
    if (carry.startBeat < 0) {
      continue;
    }
    if (carry.endTime < frame.windowStart || carry.startTime > frame.windowEnd) {
      continue;
    }
    const y = frame.laneY(carry.hand);
    segments.push(
      <line
        key={`carry-${carry.ballId}-${carry.startBeat}`}
        x1={frame.xOf(carry.startTime)}
        y1={y}
        x2={frame.xOf(carry.endTime)}
        y2={y}
        stroke={ballColor(carry.ballId)}
        strokeWidth={carry.held ? 11 : 7}
        strokeLinecap="round"
        opacity={carry.held ? 0.9 : 0.75}
      />,
    );
  }
  return <>{segments}</>;
}

function Flights({ sim, frame }: { sim: Simulation; frame: Frame }): ReactElement {
  const arcs: ReactElement[] = [];
  const dots: ReactElement[] = [];
  for (const flight of sim.timeline.flights) {
    if (flight.throwBeat < 0) {
      continue;
    }
    if (flight.arrivalTime < frame.windowStart || flight.throwTime > frame.windowEnd) {
      continue;
    }
    const color = ballColor(flight.ballId);
    const x0 = frame.xOf(flight.throwTime);
    const y0 = frame.laneY(flight.throwHand);
    const x1 = frame.xOf(flight.arrivalTime);
    const y1 = frame.laneY(flight.landingHand);
    const cx = frame.xOf((flight.throwTime + flight.arrivalTime) / 2);
    // Bow height grows with the throw value: a 5 arcs high, a 1 barely clears.
    const controlY = Math.max(4, Math.min(y0, y1) - (12 + flight.value * 8));
    arcs.push(
      <path
        key={`arc-${flight.ballId}-${flight.throwBeat}`}
        d={`M ${x0} ${y0} Q ${cx} ${controlY} ${x1} ${y1}`}
        fill="none"
        stroke={color}
        strokeWidth={2}
        opacity={0.9}
      />,
    );
    // Throw = filled dot; catch = open ring (so the direction of travel reads).
    dots.push(
      <circle
        key={`throw-${flight.ballId}-${flight.throwBeat}`}
        cx={x0}
        cy={y0}
        r={5}
        fill={color}
      />,
      <circle
        key={`catch-${flight.ballId}-${flight.throwBeat}`}
        cx={x1}
        cy={y1}
        r={5}
        fill="#ffffff"
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

function Idles({ sim, frame }: { sim: Simulation; frame: Frame }): ReactElement {
  const marks: ReactElement[] = [];
  for (const event of sim.timeline.events) {
    if (event.kind !== 'idle' || event.beat < 0) {
      continue;
    }
    if (event.time < frame.windowStart || event.time > frame.windowEnd) {
      continue;
    }
    const x = frame.xOf(event.time);
    const y = frame.laneY(event.hand);
    marks.push(
      <g key={`idle-${event.beat}`} stroke="#b3b9c4" strokeWidth={1.5}>
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
}: {
  sim: Simulation;
  frame: Frame;
  simTime: number;
}): ReactElement {
  const x = frame.xOf(simTime);
  // Current beat = the latest beat whose start is at or before now.
  const atOrAfter = firstBeatAtOrAfter(sim.timeline, simTime);
  const currentBeat =
    atOrAfter < sim.beatCount && sim.timeline.beatTime(atOrAfter) <= simTime + 1e-9
      ? atOrAfter
      : Math.max(0, atOrAfter - 1);
  return (
    <g>
      <line
        x1={x}
        y1={PLOT_TOP - 10}
        x2={x}
        y2={frame.plotBottom + 4}
        stroke="#e5484d"
        strokeWidth={2}
      />
      <text x={x} y={PLOT_TOP - 16} textAnchor="middle" fontSize={13} fill="#e5484d">
        t = {simTime.toFixed(2)} s · beat {currentBeat}
      </text>
    </g>
  );
}

/** The ladder diagram, rendered from the shared simTime and derived simulation. */
export function Ladder(): ReactElement {
  const sim = useAppStore((state) => state.sim);
  const simTime = useAppStore((state) => state.simTime);
  const handCount = useAppStore((state) => state.handCount);
  const timelineWindow = useAppStore((state) => state.timelineWindow);
  const frame = makeFrame(simTime, handCount, timelineWindow);

  return (
    <svg
      role="img"
      aria-label="Ladder diagram: time horizontal, one lane per hand"
      viewBox={`0 0 ${W} ${frame.height}`}
      width="100%"
      preserveAspectRatio="xMidYMid meet"
      style={{ display: 'block', maxWidth: '100%', height: 'auto', background: '#ffffff' }}
    >
      <defs>
        <clipPath id="ladder-plot-clip">
          <rect x={PLOT_LEFT} y={0} width={PLOT_W} height={frame.height} />
        </clipPath>
      </defs>

      {/* Static frame (unclipped): lanes, labels, plot border. */}
      <rect
        x={PLOT_LEFT}
        y={PLOT_TOP}
        width={PLOT_W}
        height={frame.plotBottom - PLOT_TOP}
        fill="#fbfcfe"
        stroke="#d5dae2"
        strokeWidth={1}
      />
      <LaneBackground frame={frame} />

      {/* Scrolling content (clipped to the plot band). */}
      <g clipPath="url(#ladder-plot-clip)">
        <BeatGrid sim={sim} frame={frame} />
        <Carries sim={sim} frame={frame} />
        <Flights sim={sim} frame={frame} />
        <Idles sim={sim} frame={frame} />
        <Cursor sim={sim} frame={frame} simTime={simTime} />
      </g>

      {/* Axis caption. */}
      <text x={PLOT_LEFT} y={frame.height - 8} fontSize={13} fill="#8a93a2">
        time → (beat index below the axis; window = {frame.timelineWindow.toFixed(1)} s)
      </text>
    </svg>
  );
}
