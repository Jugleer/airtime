// src/ui/StateGraph — the state-graph panel (DESIGN.md §5).
//
// SVG rendering of the (b, N) siteswap state graph: nodes are landing-schedule
// states (C(N, b) of them), edges are beat advances, laid out in excitation-level
// columns (BFS distance from the ground state — deterministic, NOT force-directed).
// The current pattern's cycle is highlighted; a small ball marker hops states every
// beat (derived from the ONE global clock — DESIGN.md §2); clicking any node
// navigates there through the store's BFS machinery (the running timeline is
// spliced — past bit-identical, in-flight balls unaffected). Typed pattern entry
// routes through the same machinery via the pattern input (state.setPattern).
//
// Performance: the graph, layout, cycle and all static SVG elements are memoized
// per (b, N, pattern); only the marker and the status line subscribe to simTime,
// so nothing heavy re-renders per frame. C(11,5) = 462 nodes / ~2k edges is the
// worst case — fine for plain SVG (and N ≥ 9 carries the DESIGN §5 warning).

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

const TITLE_COLOR = '#3b4252';
const NOTE_COLOR = '#5b6472';
const AMBER = '#b7791f';
const NODE_FILL = '#ffffff';
const NODE_STROKE = '#aab2c0';
const EDGE_STROKE = '#e2e6ec';
const CYCLE_COLOR = '#2f6fed';
const MARKER_COLOR = '#e8710a';

// SVG geometry (viewBox units). The layout's normalized [0, 1] coordinates are
// mapped into a margin-inset plot area; height grows with the densest level so
// nodes never overlap (the panel scrolls vertically for large N).
const MARGIN_X = 34;
const MARGIN_Y = 22;
const LEVEL_WIDTH = 96;
const ROW_HEIGHT = 30;
const NODE_RADIUS = 8;
const MARKER_RADIUS = 4.5;
/** Show bit-string labels under nodes only while the graph is small enough. */
const LABEL_NODE_LIMIT = 42;

interface GraphGeometry {
  readonly width: number;
  readonly height: number;
  toX(x: number): number;
  toY(y: number): number;
}

function geometryOf(layout: GraphLayout): GraphGeometry {
  const width = Math.max(320, MARGIN_X * 2 + (layout.levelCount - 1) * LEVEL_WIDTH);
  const height = Math.max(160, MARGIN_Y * 2 + (layout.maxNodesPerLevel - 1) * ROW_HEIGHT);
  return {
    width,
    height,
    toX: (x) => MARGIN_X + x * (width - 2 * MARGIN_X),
    toY: (y) => MARGIN_Y + y * (height - 2 * MARGIN_Y),
  };
}

/** The static graph picture: all edges, cycle highlight, clickable nodes. */
const GraphPicture = memo(function GraphPicture({
  graph,
  layout,
  cycle,
  geometry,
  onNodeClick,
}: {
  readonly graph: CoreStateGraph;
  readonly layout: GraphLayout;
  readonly cycle: PatternCycle;
  readonly geometry: GraphGeometry;
  onNodeClick(bits: number): void;
}): ReactElement {
  const { toX, toY } = geometry;
  const cycleEdgeKeys = new Set(cycle.edges.map((edge) => `${edge.from}:${edge.to}`));

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
        // Self-loop (e.g. the ground state's cascade throw): a small loop above
        // the node — drawn only when on the cycle (visual noise otherwise).
        if (onCycle) {
          cycleEdges.push(
            <circle
              key={`loop-${key}`}
              cx={toX(from.x)}
              cy={toY(from.y) - NODE_RADIUS - 4}
              r={5}
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
      const line = (
        <line
          key={`edge-${key}`}
          x1={toX(from.x)}
          y1={toY(from.y)}
          x2={toX(to.x)}
          y2={toY(to.y)}
          stroke={onCycle ? CYCLE_COLOR : EDGE_STROKE}
          strokeWidth={onCycle ? 1.8 : 1}
          markerEnd={onCycle ? 'url(#stategraph-arrow)' : undefined}
        />
      );
      (onCycle ? cycleEdges : baseEdges).push(line);
    }
  }

  const showLabels = layout.nodes.length <= LABEL_NODE_LIMIT;
  const nodes: ReactElement[] = layout.nodes.map((node) => {
    const onCycle = cycle.nodeSet.has(node.bits);
    return (
      <g key={`node-${node.bits}`}>
        <circle
          role="button"
          aria-label={`State ${node.label}`}
          cx={toX(node.x)}
          cy={toY(node.y)}
          r={NODE_RADIUS}
          fill={onCycle ? CYCLE_COLOR : NODE_FILL}
          stroke={onCycle ? CYCLE_COLOR : NODE_STROKE}
          strokeWidth={1.2}
          style={{ cursor: 'pointer' }}
          onClick={() => onNodeClick(node.bits)}
        >
          <title>{`state ${node.label} (level ${node.level})`}</title>
        </circle>
        {showLabels ? (
          <text
            x={toX(node.x)}
            y={toY(node.y) + NODE_RADIUS + 9}
            textAnchor="middle"
            fontSize={8}
            fill={NOTE_COLOR}
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
          refX={8 + NODE_RADIUS / 1.8}
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

/**
 * The current-state marker (the "little ball", DESIGN.md §5): hops each beat,
 * following the actual landing schedule — during a transition it walks the
 * bridge states off the cycle. The only SVG piece that re-renders per frame.
 */
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
    // A ball is still in flight above N (e.g. right after a hard reset from a
    // taller pattern): the state is off-graph for a few beats — hide the marker.
    return null;
  }
  return (
    <circle
      aria-label="Current state marker"
      cx={geometry.toX(coord.x)}
      cy={geometry.toY(coord.y)}
      r={MARKER_RADIUS}
      fill={MARKER_COLOR}
      stroke="#ffffff"
      strokeWidth={1.2}
      style={{ pointerEvents: 'none' }}
    />
  );
}

/** The transition status line: "transitioning to 531 (2 beats)" or the pattern. */
function StatusLine(): ReactElement {
  const sim = useAppStore((state) => state.sim);
  const simTime = useAppStore((state) => state.simTime);
  const transition = useAppStore((state) => state.transition);
  const status = transitionStatusOf(sim, transition, simTime);
  if (status) {
    const beats = status.beatsRemaining === 1 ? 'beat' : 'beats';
    return (
      <p role="status" style={{ ...statusStyle, color: MARKER_COLOR, fontWeight: 600 }}>
        transitioning to {status.targetText} ({status.beatsRemaining} {beats})
      </p>
    );
  }
  return (
    <p role="status" style={statusStyle}>
      on pattern {sim.patternText}
    </p>
  );
}

/** The graph body: derived graph/layout/cycle + the SVG (mounted only when shown). */
function StateGraphBody(): ReactElement {
  const sim = useAppStore((state) => state.sim);
  const graphMaxHeight = useAppStore((state) => state.graphMaxHeight);
  const navigateToState = useAppStore((state) => state.navigateToState);

  const ballCount = sim.ballCount;
  const values = sim.values;
  const patternMax = maxThrowOf(values);
  const unavailable = patternMax > GRAPH_N_MAX;

  // Memoized per (b, N): graph + layout. Cycle re-derives when the pattern moves.
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
      <p role="note" style={{ ...statusStyle, color: AMBER }}>
        State graph unavailable for this pattern (max throw {patternMax} &gt; {GRAPH_N_MAX}). The
        simulation still runs; type a pattern with throws ≤ {GRAPH_N_MAX} to navigate the graph.
      </p>
    );
  }
  if (!derived || !cycle) {
    return (
      <p role="note" style={{ ...statusStyle, color: AMBER }}>
        State graph needs a valid pattern with an integer ball count.
      </p>
    );
  }

  const { graph, layout, geometry } = derived;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
      <StatusLine />
      <div style={{ overflowX: 'auto' }}>
        <svg
          viewBox={`0 0 ${geometry.width} ${geometry.height}`}
          width="100%"
          role="img"
          aria-label={`State graph for ${ballCount} balls, max throw ${graphMaxHeight}`}
          style={{ display: 'block', minWidth: '20rem' }}
        >
          <GraphPicture
            graph={graph}
            layout={layout}
            cycle={cycle}
            geometry={geometry}
            onNodeClick={navigateToState}
          />
          <CurrentStateMarker layout={layout} geometry={geometry} maxHeight={graphMaxHeight} />
        </svg>
      </div>
      <p style={{ ...statusStyle, fontSize: '0.75rem' }}>
        {graph.nodes.length} states (b = {ballCount}, N = {graphMaxHeight}), grouped by excitation
        level. Click a state to transition to it — the shortest cycle through a bare state becomes
        the running pattern.
      </p>
    </div>
  );
}

/** A ±stepper for N (mirrors the Controls stepper, local to this panel). */
function NStepper(): ReactElement {
  const graphMaxHeight = useAppStore((state) => state.graphMaxHeight);
  const setGraphMaxHeight = useAppStore((state) => state.setGraphMaxHeight);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}>
      <span style={{ fontWeight: 600 }}>Max throw N</span>
      <button
        type="button"
        aria-label="Max throw N decrease"
        disabled={graphMaxHeight <= GRAPH_N_MIN}
        onClick={() => setGraphMaxHeight(graphMaxHeight - 1)}
        style={stepperButtonStyle}
      >
        −
      </button>
      <span
        aria-label="Max throw N"
        style={{ minWidth: '1.4rem', textAlign: 'center', fontWeight: 600 }}
      >
        {graphMaxHeight}
      </span>
      <button
        type="button"
        aria-label="Max throw N increase"
        disabled={graphMaxHeight >= GRAPH_N_MAX}
        onClick={() => setGraphMaxHeight(graphMaxHeight + 1)}
        style={stepperButtonStyle}
      >
        +
      </button>
    </div>
  );
}

/**
 * The collapsible state-graph panel (DESIGN.md §5, §6). The header never
 * subscribes to simTime; when hidden the body unmounts (nothing derived/drawn).
 */
export function StateGraph(): ReactElement {
  const graphVisible = useAppStore((state) => state.graphVisible);
  const graphMaxHeight = useAppStore((state) => state.graphMaxHeight);
  const graphNotice = useAppStore((state) => state.graphNotice);
  const toggleGraph = useAppStore((state) => state.toggleGraph);
  const hardReset = useAppStore((state) => state.hardReset);

  return (
    <section style={sectionStyle} aria-label="State graph panel">
      <div style={headerRowStyle}>
        <h2 style={{ margin: 0, fontSize: '1rem', color: TITLE_COLOR }}>State graph</h2>
        <button
          type="button"
          onClick={toggleGraph}
          aria-pressed={graphVisible}
          aria-label="Toggle state graph panel"
          style={toggleButtonStyle}
        >
          {graphVisible ? 'Hide graph' : 'Show graph'}
        </button>
      </div>

      {graphVisible ? (
        <>
          <div style={controlRowStyle}>
            <NStepper />
            <button type="button" onClick={hardReset} aria-label="Hard reset" style={toggleButtonStyle}>
              Hard reset
            </button>
            {graphMaxHeight >= GRAPH_WARN_N ? (
              <span role="note" style={{ color: AMBER, fontSize: '0.8rem' }}>
                N ≥ {GRAPH_WARN_N}: the graph grows combinatorially (C(N, b) states) — expect a
                dense picture.
              </span>
            ) : null}
          </div>
          {graphNotice ? (
            <p role="note" style={{ ...statusStyle, color: AMBER }}>
              {graphNotice}
            </p>
          ) : null}
          <StateGraphBody />
        </>
      ) : null}
    </section>
  );
}

// --- Inline styling (matches the light shell of the Phase 3–7 UI) ------------

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

const statusStyle: CSSProperties = {
  margin: 0,
  fontSize: '0.85rem',
  color: NOTE_COLOR,
  fontVariantNumeric: 'tabular-nums',
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

const stepperButtonStyle: CSSProperties = {
  width: '1.7rem',
  height: '1.7rem',
  borderRadius: '0.4rem',
  border: '1px solid #c8cdd6',
  background: '#ffffff',
  fontWeight: 700,
  fontSize: '0.95rem',
  cursor: 'pointer',
  lineHeight: 1,
};
