// src/ui/StateGraph — the state-graph OVERLAY (DESIGN.md §5; redesign 2026-07-10,
// owner requirement 7). The graph is now a translucent overlay over the 3D scene,
// default OFF, toggled by a labeled button in the scene's TOP-LEFT corner (the
// camera presets sit top-right). When open, a semi-transparent dark backdrop
// covers the scene with the concentric-ring SVG centered; the scene stays visible
// behind it. Node clicks navigate (BFS splice — past bit-identical); the marker,
// the transition status line, the N stepper and the hard-reset button live with
// the overlay.
//
// Layout is UNCHANGED from the prior panel (concentric excitation rings, ground at
// center, deterministic — DESIGN.md §5): only the container (panel → overlay) and
// the palette (light → theme-aware) changed. Performance is unchanged too — the
// graph/layout/cycle are memoized per (b, N, pattern); only the marker + status
// line subscribe to simTime.

import { memo, useMemo, type CSSProperties, type ReactElement } from 'react';
import {
  buildStateGraph,
  GRAPH_WARN_N,
  layoutStateGraph,
  maxThrowOf,
  patternCycle,
  stateToBits,
  type GraphLayout,
  type PatternCycle,
  type StateGraph as CoreStateGraph,
} from '../core/stategraph';
import { GRAPH_N_MAX, GRAPH_N_MIN, useAppStore } from '../state';
import { currentBeatIndex, transitionStatusOf } from '../state/simulation';
import { usePalette, type Palette } from './theme';
import { Button } from './widgets';

const CYCLE_COLOR = '#3b82f6';
const MARKER_COLOR = '#f59e0b';

// SVG geometry (viewBox units) — unchanged from the prior layout.
const VIEW_SIZE = 480;
const MARGIN_PLAIN = 30;
const MARGIN_LABELED = 60;
const MAX_NODE_RADIUS = 8;
const MIN_NODE_RADIUS = 1.6;
const TAU = Math.PI * 2;
const LABEL_NODE_LIMIT = 42;

interface GraphGeometry {
  readonly width: number;
  readonly height: number;
  readonly nodeRadius: number;
  readonly markerRadius: number;
  toX(x: number): number;
  toY(y: number): number;
}

function geometryOf(layout: GraphLayout): GraphGeometry {
  const margin = layout.nodes.length <= LABEL_NODE_LIMIT ? MARGIN_LABELED : MARGIN_PLAIN;
  const span = VIEW_SIZE - 2 * margin;
  const rings = new Map<number, { count: number; radius: number }>();
  for (const node of layout.nodes) {
    const ring = rings.get(node.level);
    if (ring === undefined) {
      rings.set(node.level, { count: 1, radius: node.radius });
    } else {
      ring.count += 1;
    }
  }
  let minArcGap = Infinity;
  for (const { count, radius } of rings.values()) {
    if (count > 1 && radius > 0) {
      minArcGap = Math.min(minArcGap, (TAU * radius * span) / count);
    }
  }
  const nodeRadius = Number.isFinite(minArcGap)
    ? Math.min(MAX_NODE_RADIUS, Math.max(MIN_NODE_RADIUS, minArcGap * 0.42))
    : MAX_NODE_RADIUS;
  return {
    width: VIEW_SIZE,
    height: VIEW_SIZE,
    nodeRadius,
    markerRadius: Math.max(1.2, nodeRadius * 0.56),
    toX: (x) => margin + x * span,
    toY: (y) => margin + y * span,
  };
}

/** The static graph picture: all edges, cycle highlight, clickable nodes. */
const GraphPicture = memo(function GraphPicture({
  graph,
  layout,
  cycle,
  geometry,
  palette,
  onNodeClick,
}: {
  readonly graph: CoreStateGraph;
  readonly layout: GraphLayout;
  readonly cycle: PatternCycle;
  readonly geometry: GraphGeometry;
  readonly palette: Palette;
  onNodeClick(bits: number): void;
}): ReactElement {
  const { toX, toY, nodeRadius } = geometry;
  const cycleEdgeKeys = new Set(cycle.edges.map((edge) => `${edge.from}:${edge.to}`));
  const centerX = toX(0.5);
  const centerY = toY(0.5);

  const baseEdges: ReactElement[] = [];
  const cycleEdges: ReactElement[] = [];
  for (const node of layout.nodes) {
    const from = layout.coordOf.get(node.bits);
    if (!from) {
      continue;
    }
    for (const edge of graph.edgesFrom(node.bits)) {
      const key = `${node.bits}:${edge.to}`;
      const onCycle = cycleEdgeKeys.has(key);
      if (edge.to === node.bits) {
        if (onCycle) {
          const loopRadius = Math.max(3, nodeRadius * 0.7);
          const loopDistance = nodeRadius + loopRadius - 1;
          cycleEdges.push(
            <circle
              key={`loop-${key}`}
              cx={toX(from.x) + Math.cos(node.angle) * loopDistance}
              cy={toY(from.y) + Math.sin(node.angle) * loopDistance}
              r={loopRadius}
              fill="none"
              stroke={CYCLE_COLOR}
              strokeWidth={1.8}
            />,
          );
        }
        continue;
      }
      const to = layout.coordOf.get(edge.to);
      if (!to) {
        continue;
      }
      const x1 = toX(from.x);
      const y1 = toY(from.y);
      const x2 = toX(to.x);
      const y2 = toY(to.y);
      if (onCycle) {
        const midX = (x1 + x2) / 2;
        const midY = (y1 + y2) / 2;
        const chordLength = Math.hypot(x2 - x1, y2 - y1);
        let dirX = midX - centerX;
        let dirY = midY - centerY;
        const dirLength = Math.hypot(dirX, dirY);
        if (dirLength > 1e-6) {
          dirX /= dirLength;
          dirY /= dirLength;
        } else {
          dirX = -(y2 - y1) / (chordLength || 1);
          dirY = (x2 - x1) / (chordLength || 1);
        }
        const bow = Math.min(26, chordLength * 0.22);
        cycleEdges.push(
          <path
            key={`edge-${key}`}
            d={`M ${x1} ${y1} Q ${midX + dirX * bow} ${midY + dirY * bow} ${x2} ${y2}`}
            fill="none"
            stroke={CYCLE_COLOR}
            strokeWidth={1.8}
            markerEnd="url(#stategraph-arrow)"
          />,
        );
      } else {
        baseEdges.push(
          <line
            key={`edge-${key}`}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={palette.edgeStroke}
            strokeWidth={1}
          />,
        );
      }
    }
  }

  const showLabels = layout.nodes.length <= LABEL_NODE_LIMIT;
  const nodes: ReactElement[] = layout.nodes.map((node) => {
    const onCycle = cycle.nodeSet.has(node.bits);
    const labelAngle = cycleEdgeKeys.has(`${node.bits}:${node.bits}`)
      ? node.angle + Math.PI
      : node.angle;
    const labelCos = Math.cos(labelAngle);
    const labelDistance = nodeRadius + 7;
    const labelAnchor = labelCos > 0.35 ? 'start' : labelCos < -0.35 ? 'end' : 'middle';
    return (
      <g key={`node-${node.bits}`}>
        <circle
          role="button"
          aria-label={`State ${node.label}`}
          cx={toX(node.x)}
          cy={toY(node.y)}
          r={nodeRadius}
          fill={onCycle ? CYCLE_COLOR : palette.nodeFill}
          stroke={onCycle ? CYCLE_COLOR : palette.nodeStroke}
          strokeWidth={1.2}
          style={{ cursor: 'pointer' }}
          onClick={() => onNodeClick(node.bits)}
        >
          <title>{`state ${node.label} (level ${node.level})`}</title>
        </circle>
        {showLabels ? (
          <text
            x={toX(node.x) + labelCos * labelDistance}
            y={toY(node.y) + Math.sin(labelAngle) * labelDistance + 3}
            textAnchor={labelAnchor}
            fontSize={8}
            fill={palette.textSecondary}
            style={{ pointerEvents: 'none', fontFamily: 'ui-monospace, monospace' }}
          >
            {node.label}
          </text>
        ) : null}
      </g>
    );
  });

  return (
    <>
      <defs>
        <marker
          id="stategraph-arrow"
          viewBox="0 0 8 8"
          refX={8 + nodeRadius / 1.8}
          refY={4}
          markerWidth={7}
          markerHeight={7}
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 8 4 L 0 8 z" fill={CYCLE_COLOR} />
        </marker>
      </defs>
      <g>{baseEdges}</g>
      <g>{cycleEdges}</g>
      <g>{nodes}</g>
    </>
  );
});

/** The current-state marker (the "little ball", DESIGN.md §5): hops each beat. */
function CurrentStateMarker({
  layout,
  geometry,
  maxHeight,
}: {
  readonly layout: GraphLayout;
  readonly geometry: GraphGeometry;
  readonly maxHeight: number;
}): ReactElement | null {
  const sim = useAppStore((state) => state.sim);
  const simTime = useAppStore((state) => state.simTime);
  const beat = currentBeatIndex(sim.timeline, simTime);
  const bits = stateToBits(sim.timeline.landingScheduleAt(beat, maxHeight));
  const coord = layout.coordOf.get(bits);
  if (!coord) {
    return null;
  }
  return (
    <circle
      aria-label="Current state marker"
      cx={geometry.toX(coord.x)}
      cy={geometry.toY(coord.y)}
      r={geometry.markerRadius}
      fill={MARKER_COLOR}
      stroke="#ffffff"
      strokeWidth={1.2}
      style={{ pointerEvents: 'none' }}
    />
  );
}

/** The transition status line: "transitioning to 531 (2 beats)" or the pattern. */
function StatusLine(): ReactElement {
  const palette = usePalette();
  const sim = useAppStore((state) => state.sim);
  const simTime = useAppStore((state) => state.simTime);
  const transition = useAppStore((state) => state.transition);
  const status = transitionStatusOf(sim, transition, simTime);
  if (status) {
    const beats = status.beatsRemaining === 1 ? 'beat' : 'beats';
    return (
      <p role="status" style={{ ...statusStyle(palette), color: MARKER_COLOR, fontWeight: 700 }}>
        transitioning to {status.targetText} ({status.beatsRemaining} {beats})
      </p>
    );
  }
  return (
    <p role="status" style={statusStyle(palette)}>
      on pattern {sim.patternText}
    </p>
  );
}

/** The graph body: derived graph/layout/cycle + the SVG (mounted only when shown). */
function StateGraphBody(): ReactElement {
  const palette = usePalette();
  const sim = useAppStore((state) => state.sim);
  const graphMaxHeight = useAppStore((state) => state.graphMaxHeight);
  const navigateToState = useAppStore((state) => state.navigateToState);

  const ballCount = sim.ballCount;
  const values = sim.values;
  const patternMax = maxThrowOf(values);
  const unavailable = patternMax > GRAPH_N_MAX;

  const derived = useMemo(() => {
    if (unavailable || !Number.isInteger(ballCount)) {
      return null;
    }
    const graph = buildStateGraph(ballCount, graphMaxHeight);
    const layout = layoutStateGraph(graph);
    return { graph, layout, geometry: geometryOf(layout) };
  }, [ballCount, graphMaxHeight, unavailable]);

  const cycle = useMemo(
    () => (derived ? patternCycle(values, graphMaxHeight) : null),
    [derived, values, graphMaxHeight],
  );

  if (unavailable) {
    return (
      <p role="note" style={{ ...statusStyle(palette), color: palette.amber }}>
        State graph unavailable for this pattern (max throw {patternMax} &gt; {GRAPH_N_MAX}). The
        simulation still runs; type a pattern with throws ≤ {GRAPH_N_MAX} to navigate the graph.
      </p>
    );
  }
  if (!derived || !cycle) {
    return (
      <p role="note" style={{ ...statusStyle(palette), color: palette.amber }}>
        State graph needs a valid pattern with an integer ball count.
      </p>
    );
  }

  const { graph, layout, geometry } = derived;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', alignItems: 'center', minHeight: 0 }}>
      <StatusLine />
      <svg
        viewBox={`0 0 ${geometry.width} ${geometry.height}`}
        role="img"
        aria-label={`State graph for ${ballCount} balls, max throw ${graphMaxHeight}`}
        style={{ display: 'block', width: 'auto', height: '100%', maxHeight: '58vh', maxWidth: '100%' }}
      >
        <GraphPicture
          graph={graph}
          layout={layout}
          cycle={cycle}
          geometry={geometry}
          palette={palette}
          onNodeClick={navigateToState}
        />
        <CurrentStateMarker layout={layout} geometry={geometry} maxHeight={graphMaxHeight} />
      </svg>
      <p style={{ ...statusStyle(palette), fontSize: '0.72rem', textAlign: 'center' }}>
        {graph.nodes.length} states (b = {ballCount}, N = {graphMaxHeight}) in excitation rings
        (ground at centre). Click a state to transition to it.
      </p>
    </div>
  );
}

/** A ±stepper for N (mirrors the widgets stepper, local to the overlay). */
function NStepper(): ReactElement {
  const palette = usePalette();
  const graphMaxHeight = useAppStore((state) => state.graphMaxHeight);
  const setGraphMaxHeight = useAppStore((state) => state.setGraphMaxHeight);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', color: palette.textSecondary }}>
      <span style={{ fontWeight: 600 }}>Max throw N</span>
      <button
        type="button"
        aria-label="Max throw N decrease"
        disabled={graphMaxHeight <= GRAPH_N_MIN}
        onClick={() => setGraphMaxHeight(graphMaxHeight - 1)}
        style={stepperButtonStyle(palette, graphMaxHeight <= GRAPH_N_MIN)}
      >
        −
      </button>
      <span aria-label="Max throw N" style={{ minWidth: '1.3rem', textAlign: 'center', fontWeight: 700, color: palette.textPrimary }}>
        {graphMaxHeight}
      </span>
      <button
        type="button"
        aria-label="Max throw N increase"
        disabled={graphMaxHeight >= GRAPH_N_MAX}
        onClick={() => setGraphMaxHeight(graphMaxHeight + 1)}
        style={stepperButtonStyle(palette, graphMaxHeight >= GRAPH_N_MAX)}
      >
        +
      </button>
    </div>
  );
}

/**
 * The state-graph overlay + its top-left scene toggle (DESIGN.md §5, §6). The
 * toggle is always present; the overlay renders over the scene only when
 * `graphVisible`. When hidden the body unmounts (nothing derived/drawn).
 */
export function StateGraph(): ReactElement {
  const palette = usePalette();
  const graphVisible = useAppStore((state) => state.graphVisible);
  const graphMaxHeight = useAppStore((state) => state.graphMaxHeight);
  const graphNotice = useAppStore((state) => state.graphNotice);
  const toggleGraph = useAppStore((state) => state.toggleGraph);
  const hardReset = useAppStore((state) => state.hardReset);

  return (
    <>
      {/* Scene TOP-LEFT toggle (camera presets sit top-right). */}
      <button
        type="button"
        onClick={toggleGraph}
        aria-label="Toggle state graph panel"
        aria-pressed={graphVisible}
        style={toggleButtonStyle(palette, graphVisible)}
      >
        <span aria-hidden>◎</span> State graph
      </button>

      {graphVisible ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 5,
            background: palette.overlayBackdrop,
            backdropFilter: 'blur(2px)',
            display: 'flex',
            flexDirection: 'column',
            padding: '2.9rem 0.8rem 0.8rem',
            gap: '0.5rem',
          }}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem 1rem' }}>
            <NStepper />
            <Button onClick={hardReset} ariaLabel="Hard reset" variant="default">
              Hard reset
            </Button>
            {graphMaxHeight >= GRAPH_WARN_N ? (
              <span role="note" style={{ color: palette.amber, fontSize: '0.75rem' }}>
                N ≥ {GRAPH_WARN_N}: the graph grows combinatorially (C(N, b) states) — expect a
                dense picture.
              </span>
            ) : null}
          </div>
          {graphNotice ? (
            <p role="note" style={{ ...statusStyle(palette), color: palette.amber }}>
              {graphNotice}
            </p>
          ) : null}
          <div style={{ flex: 1, minHeight: 0, display: 'flex', justifyContent: 'center', overflow: 'hidden' }}>
            <StateGraphBody />
          </div>
        </div>
      ) : null}
    </>
  );
}

// --- Styling -----------------------------------------------------------------

function statusStyle(palette: Palette): CSSProperties {
  return {
    margin: 0,
    fontSize: '0.82rem',
    color: palette.textSecondary,
    fontVariantNumeric: 'tabular-nums',
  };
}

function toggleButtonStyle(palette: Palette, active: boolean): CSSProperties {
  return {
    position: 'absolute',
    top: '0.55rem',
    left: '0.55rem',
    zIndex: 6,
    padding: '0.28rem 0.6rem',
    borderRadius: '0.35rem',
    border: `1px solid ${active ? palette.accent : palette.border}`,
    background: active ? palette.accent : palette.panelHover,
    color: active ? palette.accentText : palette.textPrimary,
    fontSize: '0.75rem',
    fontWeight: 600,
    cursor: 'pointer',
    backdropFilter: 'blur(4px)',
  };
}

function stepperButtonStyle(palette: Palette, disabled: boolean): CSSProperties {
  return {
    width: '1.7rem',
    height: '1.7rem',
    borderRadius: '0.4rem',
    border: `1px solid ${palette.border}`,
    background: palette.panelAlt,
    color: palette.textPrimary,
    fontWeight: 700,
    fontSize: '0.95rem',
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.4 : 1,
    lineHeight: 1,
  };
}
