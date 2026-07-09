// src/ui/TimelineBar — the timeline bar (DESIGN.md §6): a fixed, configurable
// window (default 3 s) with a mini-ladder tick background, a scrub playhead, and a
// detachable trail-length handle. Scrubbing sets the one global clock directly
// (DESIGN.md §2), so it moves the 3D scene, the ladder, and the tracers together.
//
// Scroll policy (documented in src/state/simulation): the playhead is anchored a
// fixed fraction of the window from the left while playing/paused; during an
// active scrub the window freezes so the playhead tracks the pointer instead of
// the content sliding under it. Mouse + touch via Pointer Events; the clock is
// paused for the duration of a gesture and resumes (if it was playing) on release,
// continuing from the scrubbed time.
//
// SVG with preserveAspectRatio="none" so the horizontal pixel↔time map is linear
// (the geometry math lives in ./timelineBar). Re-renders per frame like the ladder
// (it subscribes to simTime); the 3D hot path stays allocation-free in <Tracers>.

import {
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from 'react';
import { useAppStore } from '../state';
import { firstBeatAtOrAfter, windowSpans } from '../state/simulation';
import {
  clampSimTime,
  timeFromPointer,
  trailHandlePlacement,
  xOfTime,
  type BarGeometry,
} from './timelineBar';

// Logical SVG coordinate space (stretched to the container via a "none" viewBox).
const W = 1000;
const H = 96;
const PLOT_L = 10;
const PLOT_R = 990;
const PLOT_W = PLOT_R - PLOT_L;
const BAND_TOP = 20;
const BAND_BOTTOM = 66;
const BAND_H = BAND_BOTTOM - BAND_TOP;
const PLAYHEAD_TOP = 8;
const PLAYHEAD_BOTTOM = BAND_BOTTOM + 8;

const TICK_COLOR = '#8a93a2';
const LANE_COLOR = '#e2e6ec';

interface DragSession {
  readonly mode: 'playhead' | 'trail';
  readonly wasPlaying: boolean;
  /** Frozen window start for the gesture (the anchored view at grab time). */
  readonly originStart: number;
}

function makeGeometry(windowStart: number, timelineWindow: number): BarGeometry {
  return { svgWidth: W, plotLeft: PLOT_L, plotWidth: PLOT_W, windowStart, timelineWindow };
}

export function TimelineBar(): ReactElement {
  const sim = useAppStore((state) => state.sim);
  const simTime = useAppStore((state) => state.simTime);
  const handCount = useAppStore((state) => state.handCount);
  const beatPeriod = useAppStore((state) => state.beatPeriod);
  const timelineWindow = useAppStore((state) => state.timelineWindow);
  const trailLength = useAppStore((state) => state.trailLength);

  const svgRef = useRef<SVGSVGElement>(null);
  const handleRef = useRef<SVGGElement>(null);
  const dragRef = useRef<DragSession | null>(null);
  // Re-render trigger + frozen window while scrubbing (window static during drag).
  const [scrubStart, setScrubStart] = useState<number | null>(null);

  const { pastSpan } = windowSpans(timelineWindow);
  const windowStart = scrubStart ?? simTime - pastSpan;
  const windowEnd = windowStart + timelineWindow;
  const geometry = makeGeometry(windowStart, timelineWindow);

  const playheadX = xOfTime(simTime, geometry);
  const handle = trailHandlePlacement(simTime, trailLength, geometry);
  const repeatSeconds = sim.spatialPeriodBeats * beatPeriod;

  // --- Pointer handling (scrub playhead + drag trail handle) -----------------

  const applyDrag = (clientX: number): void => {
    const drag = dragRef.current;
    const svg = svgRef.current;
    if (!drag || !svg) {
      return;
    }
    const geo = makeGeometry(drag.originStart, timelineWindow);
    const time = timeFromPointer(clientX, svg.getBoundingClientRect(), geo);
    const store = useAppStore.getState();
    if (drag.mode === 'playhead') {
      store.setSimTime(time); // clamps t ≥ 0 and extends the horizon if needed
    } else {
      // The clock is paused for the gesture, so simTime is stable here.
      store.setTrailLength(clampSimTime(store.simTime - time));
    }
  };

  const beginDrag = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const svg = svgRef.current;
    if (!svg) {
      return;
    }
    const store = useAppStore.getState();
    const onHandle = handleRef.current?.contains(event.target as Node) ?? false;
    const session: DragSession = {
      mode: onHandle ? 'trail' : 'playhead',
      wasPlaying: store.playing,
      originStart: store.simTime - pastSpan,
    };
    dragRef.current = session;
    if (store.playing) {
      store.setPlaying(false); // freeze the clock so the gesture fully controls it
    }
    setScrubStart(session.originStart);
    if (typeof svg.setPointerCapture === 'function') {
      try {
        svg.setPointerCapture(event.pointerId);
      } catch {
        // jsdom / unsupported: pointer capture is a nicety, not required.
      }
    }
    applyDrag(event.clientX);
    event.preventDefault();
  };

  const moveDrag = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (dragRef.current) {
      applyDrag(event.clientX);
      event.preventDefault();
    }
  };

  const endDrag = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const drag = dragRef.current;
    if (!drag) {
      return;
    }
    const svg = svgRef.current;
    if (svg && typeof svg.releasePointerCapture === 'function') {
      try {
        svg.releasePointerCapture(event.pointerId);
      } catch {
        // ignore
      }
    }
    if (drag.wasPlaying) {
      useAppStore.getState().setPlaying(true); // resume from the scrubbed time
    }
    dragRef.current = null;
    setScrubStart(null);
  };

  // --- Mini-ladder background (per-hand throw/catch ticks + beat grid) --------

  const laneY = (hand: number): number => BAND_TOP + ((hand + 0.5) * BAND_H) / Math.max(1, handCount);

  const beatMarks: ReactElement[] = [];
  const startBeat = firstBeatAtOrAfter(sim.timeline, Math.max(windowStart, 0));
  for (let beat = startBeat; beat < sim.beatCount; beat += 1) {
    const time = sim.timeline.beatTime(beat);
    if (time > windowEnd) {
      break;
    }
    const x = xOfTime(time, geometry);
    beatMarks.push(
      <line key={`beat-${beat}`} x1={x} y1={BAND_TOP} x2={x} y2={BAND_BOTTOM} stroke="#f0f2f5" strokeWidth={1} />,
    );
  }

  const eventTicks: ReactElement[] = [];
  for (const flight of sim.timeline.flights) {
    if (flight.throwBeat < 0) {
      continue;
    }
    if (flight.arrivalTime < windowStart || flight.throwTime > windowEnd) {
      continue;
    }
    const tx = xOfTime(flight.throwTime, geometry);
    const ty = laneY(flight.throwHand);
    // Throw = short filled tick; catch = small hollow ring (direction reads).
    eventTicks.push(
      <line
        key={`t-${flight.ballId}-${flight.throwBeat}`}
        x1={tx}
        y1={ty - 5}
        x2={tx}
        y2={ty + 5}
        stroke={TICK_COLOR}
        strokeWidth={2}
      />,
    );
    const cx = xOfTime(flight.arrivalTime, geometry);
    const cy = laneY(flight.landingHand);
    eventTicks.push(
      <circle
        key={`c-${flight.ballId}-${flight.throwBeat}`}
        cx={cx}
        cy={cy}
        r={2.6}
        fill="#ffffff"
        stroke={TICK_COLOR}
        strokeWidth={1.4}
      />,
    );
  }

  const laneLines: ReactElement[] = [];
  for (let hand = 0; hand < handCount; hand += 1) {
    const y = laneY(hand);
    laneLines.push(
      <line key={`lane-${hand}`} x1={PLOT_L} y1={y} x2={PLOT_R} y2={y} stroke={LANE_COLOR} strokeWidth={1} />,
    );
  }

  return (
    <section style={sectionStyle} aria-label="Timeline bar">
      <div style={readoutRowStyle}>
        <span style={{ fontWeight: 600 }}>Timeline</span>
        <span style={readoutStyle}>pattern repeats every {repeatSeconds.toFixed(2)} s</span>
        <span style={readoutStyle}>window {timelineWindow.toFixed(1)} s</span>
        <span style={readoutStyle}>
          trail {trailLength.toFixed(2)} s{handle.pinned ? ' (pinned to edge)' : ''}
        </span>
        <span style={{ ...readoutStyle, color: '#e5484d' }}>t = {simTime.toFixed(2)} s</span>
      </div>

      <svg
        ref={svgRef}
        role="img"
        aria-label="Timeline bar: scrub playhead and detachable trail handle over a mini-ladder"
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        preserveAspectRatio="none"
        onPointerDown={beginDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{ display: 'block', width: '100%', touchAction: 'none', cursor: 'ew-resize' }}
      >
        {/* Plot background (opaque, so clicks anywhere begin a playhead scrub). */}
        <rect
          x={PLOT_L}
          y={BAND_TOP - 6}
          width={PLOT_W}
          height={BAND_BOTTOM - BAND_TOP + 12}
          fill="#fbfcfe"
          stroke="#d5dae2"
          strokeWidth={1}
        />

        {beatMarks}
        {laneLines}
        {eventTicks}

        {/* Trailing-window band: from the trail handle (or left edge) to the playhead. */}
        <rect
          x={handle.x}
          y={BAND_TOP}
          width={Math.max(0, playheadX - handle.x)}
          height={BAND_H}
          fill="#2f6fed"
          opacity={0.1}
        />

        {/* Trail handle (draggable; pins to the left edge when the trail is long). */}
        <g ref={handleRef} style={{ cursor: 'ew-resize' }}>
          {/* Wide invisible hit area for easy grabbing. */}
          <rect x={handle.x - 8} y={PLAYHEAD_TOP} width={16} height={PLAYHEAD_BOTTOM - PLAYHEAD_TOP} fill="transparent" />
          <rect x={handle.x - 2} y={BAND_TOP - 4} width={4} height={BAND_H + 8} rx={2} fill="#2f6fed" opacity={0.85} />
          <circle cx={handle.x} cy={BAND_TOP - 8} r={4} fill="#2f6fed" />
        </g>

        {/* Playhead (scrub) + top grip. */}
        <line x1={playheadX} y1={PLAYHEAD_TOP} x2={playheadX} y2={PLAYHEAD_BOTTOM} stroke="#e5484d" strokeWidth={2} />
        <rect x={playheadX - 4} y={PLAYHEAD_TOP - 2} width={8} height={9} rx={2} fill="#e5484d" />

        {/* Window-edge time labels. */}
        <text x={PLOT_L + 2} y={H - 6} fontSize={12} fill="#8a93a2">
          {Math.max(0, windowStart).toFixed(2)} s
        </text>
        <text x={PLOT_R - 2} y={H - 6} fontSize={12} fill="#8a93a2" textAnchor="end">
          {windowEnd.toFixed(2)} s
        </text>
      </svg>
    </section>
  );
}

// --- Inline styling (matches the light shell of the Phase 3/4 UI) ------------

const sectionStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.4rem',
  padding: '0.75rem',
  background: '#ffffff',
  borderRadius: '0.6rem',
  border: '1px solid #dfe3ea',
  width: '100%',
};

const readoutRowStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.4rem 1rem',
  alignItems: 'baseline',
  fontSize: '0.85rem',
  color: '#3b4252',
};

const readoutStyle: CSSProperties = {
  color: '#5b6472',
  fontVariantNumeric: 'tabular-nums',
};
