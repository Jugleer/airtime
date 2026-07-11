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
//
// Owner view fixes (2026-07-11):
//   • Handles — the playhead (scrub) carries an ORANGE square grip at the TOP edge
//     and the trail handle a BLUE round grip at the BOTTOM edge. The grips are
//     vertically separated so both stay grabbable when the two coincide: a press in
//     the top strip scrubs the playhead, a press lower down drags the trail. The
//     playhead is drawn in palette.amber (the owner's "orange"); the shared cursor
//     elsewhere stays palette.playhead — this divergence is scoped to the bar so the
//     two draggable handles read as clearly distinct (flip amber→playhead to undo).
//   • Clipping — mini-ladder ticks/rings are dropped per endpoint via
//     `flightMarksInWindow` and the scrolling content is clipped to the plot band,
//     so nothing renders before the track start or lingers past its end.
//   • Annotations — compact per-hand lane labels (H0, H1 … — 0-indexed to match the
//     ladder's "Hand 0/1" and the charts legend) plus a subtle one-line legend.

import {
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from 'react';
import { useAppStore } from '../state';
import { firstBeatAtOrAfter, windowSpans } from '../state/simulation';
import { Transport } from './Transport';
import { usePalette } from './theme';
import {
  clampSimTime,
  flightMarksInWindow,
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
// The playhead's square grip occupies roughly y ∈ [6, 16]; the trail handle's hit
// area starts just below it so the top strip belongs to the playhead (grips stay
// grabbable when the two handles coincide — vertical separation, DESIGN.md §6).
const TRAIL_HIT_TOP = 18;

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
  const palette = usePalette();
  const sim = useAppStore((state) => state.sim);
  const simTime = useAppStore((state) => state.simTime);
  const handCount = useAppStore((state) => state.handCount);
  const beatPeriod = useAppStore((state) => state.beatPeriod);
  const timelineWindow = useAppStore((state) => state.timelineWindow);
  const trailLength = useAppStore((state) => state.trailLength);

  const TICK_COLOR = palette.textMuted;
  const LANE_COLOR = palette.laneLine;
  // The scrub playhead is the owner's "orange" (palette.amber), distinct from the
  // blue trail handle; the shared cursor in the ladder/charts stays palette.playhead.
  const PLAYHEAD_COLOR = palette.amber;

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
      <line key={`beat-${beat}`} x1={x} y1={BAND_TOP} x2={x} y2={BAND_BOTTOM} stroke={palette.gridLine} strokeWidth={1} />,
    );
  }

  // Stack co-located multiplex marks with a small vertical step so overlapping throws
  // / catches at one hand-beat stay individually visible (ruling 6).
  const STACK_STEP = 3;
  const flightList = sim.timeline.flights;
  const throwSlot = new Map<(typeof flightList)[number], number>();
  const catchSlot = new Map<(typeof flightList)[number], number>();
  const throwSeen = new Map<string, number>();
  const catchSeen = new Map<string, number>();
  for (const f of flightList) {
    const tk = `${f.throwBeat}:${f.throwHand}`;
    const ck = `${f.landingBeat}:${f.landingHand}`;
    const ti = throwSeen.get(tk) ?? 0;
    const ci = catchSeen.get(ck) ?? 0;
    throwSlot.set(f, ti);
    catchSlot.set(f, ci);
    throwSeen.set(tk, ti + 1);
    catchSeen.set(ck, ci + 1);
  }

  const eventTicks: ReactElement[] = [];
  for (const flight of flightList) {
    if (flight.throwBeat < 0) {
      continue;
    }
    // Clip per endpoint: only draw the throw tick / catch ring whose OWN time is
    // inside the window, so nothing renders before the track start or past its end.
    const marks = flightMarksInWindow(flight.throwTime, flight.arrivalTime, windowStart, windowEnd);
    if (marks.showThrow) {
      const tx = xOfTime(flight.throwTime, geometry);
      const ty = laneY(flight.throwHand) + (throwSlot.get(flight) ?? 0) * STACK_STEP;
      // Throw = short filled tick.
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
    }
    if (marks.showCatch) {
      const cx = xOfTime(flight.arrivalTime, geometry);
      const cy = laneY(flight.landingHand) + (catchSlot.get(flight) ?? 0) * STACK_STEP;
      // Catch = small hollow ring (direction reads throw → catch).
      eventTicks.push(
        <circle
          key={`c-${flight.ballId}-${flight.throwBeat}`}
          cx={cx}
          cy={cy}
          r={2.6}
          fill={palette.inset}
          stroke={TICK_COLOR}
          strokeWidth={1.4}
        />,
      );
    }
  }

  const laneLines: ReactElement[] = [];
  const laneLabels: ReactElement[] = [];
  for (let hand = 0; hand < handCount; hand += 1) {
    const y = laneY(hand);
    laneLines.push(
      <line key={`lane-${hand}`} x1={PLOT_L} y1={y} x2={PLOT_R} y2={y} stroke={LANE_COLOR} strokeWidth={1} />,
    );
    // Compact lane tag at the bar's left edge (H0, H1 … — 0-indexed to match the
    // ladder's "Hand 0/1" and the charts legend; note the choice in the header).
    laneLabels.push(
      <text
        key={`lanelabel-${hand}`}
        x={PLOT_L + 5}
        y={y - 6}
        fontSize={10}
        fontWeight={700}
        fill={palette.textSecondary}
      >
        H{hand}
      </text>,
    );
  }

  const readoutStyle: CSSProperties = { color: palette.textMuted, fontVariantNumeric: 'tabular-nums' };

  // Unobtrusive legend for the mini-ladder marks (glyph shape mirrors the mark).
  const legendItems: readonly { readonly glyph: string; readonly color: string; readonly label: string }[] = [
    { glyph: '│', color: TICK_COLOR, label: 'throw' },
    { glyph: '○', color: TICK_COLOR, label: 'catch' },
    { glyph: '▪', color: PLAYHEAD_COLOR, label: 'playhead' },
    { glyph: '●', color: palette.accent, label: 'trail' },
  ];

  return (
    <section
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.4rem',
        padding: '0.5rem 0.65rem 0.55rem',
        background: palette.panelAlt,
        borderTop: `1px solid ${palette.border}`,
        width: '100%',
      }}
      aria-label="Timeline bar"
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.5rem 1rem',
          alignItems: 'center',
          fontSize: '0.78rem',
          color: palette.textSecondary,
        }}
      >
        <Transport />
        <span style={readoutStyle}>pattern repeats every {repeatSeconds.toFixed(2)} s</span>
        <span style={readoutStyle}>window {timelineWindow.toFixed(1)} s</span>
        <span style={readoutStyle}>
          trail {trailLength.toFixed(2)} s{handle.pinned ? ' (pinned)' : ''}
        </span>
        <div style={{ flex: 1 }} />
        <span style={{ ...readoutStyle, color: PLAYHEAD_COLOR, fontWeight: 700 }}>
          t = {simTime.toFixed(2)} s
        </span>
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
        <defs>
          {/* Clip the scrolling content to the plot band so no tick/ring/band ever
              paints before the track start or past its end (DESIGN.md §6 bug fix). */}
          <clipPath id="timeline-plot-clip">
            <rect x={PLOT_L} y={0} width={PLOT_W} height={H} />
          </clipPath>
        </defs>

        {/* Plot background (opaque, so clicks anywhere begin a playhead scrub). */}
        <rect
          x={PLOT_L}
          y={BAND_TOP - 6}
          width={PLOT_W}
          height={BAND_BOTTOM - BAND_TOP + 12}
          fill={palette.inset}
          stroke={palette.border}
          strokeWidth={1}
        />

        {/* Scrolling content (clipped to the plot band). */}
        <g clipPath="url(#timeline-plot-clip)">
          {beatMarks}
          {laneLines}
          {eventTicks}

          {/* Trailing-window band: from the trail handle (or left edge) to the playhead. */}
          <rect
            x={handle.x}
            y={BAND_TOP}
            width={Math.max(0, playheadX - handle.x)}
            height={BAND_H}
            fill={palette.accent}
            opacity={0.18}
          />
        </g>

        {/* Lane tags (unclipped, always readable at the left edge). */}
        {laneLabels}

        {/* Trail handle (blue): edge bar + a ROUND grip at the BOTTOM; the hit area
            sits below the playhead's top grip so both stay grabbable when coincident. */}
        <g ref={handleRef} style={{ cursor: 'ew-resize' }}>
          {/* Invisible hit area over the lower band (leaves the top strip for the
              playhead grip, so a press up top scrubs and a press here drags trail). */}
          <rect
            x={handle.x - 9}
            y={TRAIL_HIT_TOP}
            width={18}
            height={PLAYHEAD_BOTTOM + 4 - TRAIL_HIT_TOP}
            fill="transparent"
          />
          <rect x={handle.x - 2} y={BAND_TOP - 2} width={4} height={BAND_H + 6} rx={2} fill={palette.accent} opacity={0.9} />
          <circle data-role="trail-grip" cx={handle.x} cy={PLAYHEAD_BOTTOM} r={4.5} fill={palette.accent} />
        </g>

        {/* Playhead (scrub, orange) + SQUARE grip at the TOP. Purely visual and
            pointer-transparent: a press anywhere on the bar already begins a playhead
            scrub, and letting pointer events pass through means the trail handle's
            lower hit area still wins at the bottom when the two handles coincide. */}
        <line
          x1={playheadX}
          y1={PLAYHEAD_TOP}
          x2={playheadX}
          y2={PLAYHEAD_BOTTOM}
          stroke={PLAYHEAD_COLOR}
          strokeWidth={2}
          style={{ pointerEvents: 'none' }}
        />
        <rect
          data-role="playhead-grip"
          x={playheadX - 4}
          y={PLAYHEAD_TOP - 2}
          width={8}
          height={10}
          rx={2}
          fill={PLAYHEAD_COLOR}
          style={{ pointerEvents: 'none' }}
        />

        {/* Window-edge time labels. */}
        <text x={PLOT_L + 2} y={H - 6} fontSize={12} fill={palette.textMuted}>
          {Math.max(0, windowStart).toFixed(2)} s
        </text>
        <text x={PLOT_R - 2} y={H - 6} fontSize={12} fill={palette.textMuted} textAnchor="end">
          {windowEnd.toFixed(2)} s
        </text>
      </svg>

      {/* Subtle one-line legend for the mini-ladder marks (kept muted; the bar is small). */}
      <div
        aria-label="Timeline legend"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.15rem 0.8rem',
          alignItems: 'center',
          paddingLeft: '0.15rem',
          fontSize: '0.66rem',
          color: palette.textMuted,
        }}
      >
        {legendItems.map((item) => (
          <span key={item.label} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.28rem' }}>
            <span aria-hidden style={{ color: item.color, fontWeight: 700, lineHeight: 1 }}>
              {item.glyph}
            </span>
            {item.label}
          </span>
        ))}
      </div>
    </section>
  );
}
