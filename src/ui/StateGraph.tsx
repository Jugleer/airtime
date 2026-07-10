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

function geometryOf(
  layout: GraphLayout,
  labeled: boolean = layout.nodes.length <= LABEL_NODE_LIMIT,
): GraphGeometry {
  // The minimap draws no labels at any size (owner requirement), so it passes
  // `labeled = false` to reclaim the label margin and fill its small box.
  const margin = labeled ? MARGIN_LABELED : MARGIN_PLAIN;
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
  labels,
  interactive = true,
}: {
  readonly graph: CoreStateGraph;
  readonly layout: GraphLayout;
  readonly cycle: PatternCycle;
  readonly geometry: GraphGeometry;
  readonly palette: Palette;
  onNodeClick(bits: number): void;
  /** Force node labels on/off; defaults to the node-count rule (overlay behavior). */
  readonly labels?: boolean;
  /** When false (the minimap), nodes are plain, unclickable circles (no role/aria). */
  readonly interactive?: boolean;
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

  const showLabels = labels ?? layout.nodes.length <= LABEL_NODE_LIMIT;
  const nodes: ReactElement[] = layout.nodes.map((node) => {
    const onCycle = cycle.nodeSet.has(node.bits);
    const labelAngle = cycleEdgeKeys.has(`${node.bits}:${node.bits}`)
      ? node.angle + Math.PI
      : node.angle;
    const labelCos = Math.cos(labelAngle);
    const labelDistance = nodeRadius + 7;
    const labelAnchor = labelCos > 0.35 ? 'start' : labelCos < -0.35 ? 'end' : 'middle';
    // Non-interactive (minimap) nodes drop role/aria/onClick and the pointer
    // cursor — the whole minimap is a single "expand" affordance instead.
    const interactiveProps = interactive
      ? {
          role: 'button',
          'aria-label': `State ${node.label}`,
          style: { cursor: 'pointer' as const },
          onClick: () => onNodeClick(node.bits),
        }
      : {};
    return (
      <g key={`node-${node.bits}`}>
        <circle
          {...interactiveProps}
          cx={toX(node.x)}
          cy={toY(node.y)}
          r={nodeRadius}
          fill={onCycle ? CYCLE_COLOR : palette.nodeFill}
          stroke={onCycle ? CYCLE_COLOR : palette.nodeStroke}
          strokeWidth={1.2}
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

/**
 * The current-state marker (the "little ball", DESIGN.md §5): hops each beat.
 * The selector returns the marker's STATE BITS, so the component re-renders (and
 * the DOM circle moves) only when the marker hops to a new node — not on every
 * frame — even though the underlying simTime advances continuously. This is what
 * keeps the always-visible minimap cheap (only the marker tracks simTime).
 */
function CurrentStateMarker({
  layout,
  geometry,
  maxHeight,
  markerLabel = 'Current state marker',
}: {
  readonly layout: GraphLayout;
  readonly geometry: GraphGeometry;
  readonly maxHeight: number;
  readonly markerLabel?: string;
}): ReactElement | null {
  const bits = useAppStore((state) =>
    stateToBits(
      state.sim.timeline.landingScheduleAt(currentBeatIndex(state.sim.timeline, state.simTime), maxHeight),
    ),
  );
  const coord = layout.coordOf.get(bits);
  if (!coord) {
    return null;
  }
  return (
    <circle
      aria-label={markerLabel}
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

/** The derived (b, N) graph + layout + current cycle, memoized and shared by the
 *  minimap and the full overlay (only one is mounted at a time, so this computes
 *  once). Returns a tagged status so callers render the right notice. */
type GraphModel =
  | { readonly status: 'unavailable'; readonly patternMax: number }
  | { readonly status: 'invalid' }
  | {
      readonly status: 'ok';
      readonly graph: CoreStateGraph;
      readonly layout: GraphLayout;
      readonly cycle: PatternCycle;
      readonly ballCount: number;
      readonly graphMaxHeight: number;
    };

function useGraphModel(): GraphModel {
  const sim = useAppStore((state) => state.sim);
  const graphMaxHeight = useAppStore((state) => state.graphMaxHeight);

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
    return { graph, layout };
  }, [ballCount, graphMaxHeight, unavailable]);

  const cycle = useMemo(
    () => (derived ? patternCycle(values, graphMaxHeight) : null),
    [derived, values, graphMaxHeight],
  );

  if (unavailable) {
    return { status: 'unavailable', patternMax };
  }
  if (!derived || !cycle) {
    return { status: 'invalid' };
  }
  return { status: 'ok', graph: derived.graph, layout: derived.layout, cycle, ballCount, graphMaxHeight };
}

/** The full-overlay graph body: derived graph/layout/cycle + the interactive SVG. */
function StateGraphBody(): ReactElement {
  const palette = usePalette();
  const navigateToState = useAppStore((state) => state.navigateToState);
  const model = useGraphModel();

  if (model.status === 'unavailable') {
    return (
      <p role="note" style={{ ...statusStyle(palette), color: palette.amber }}>
        State graph unavailable for this pattern (max throw {model.patternMax} &gt; {GRAPH_N_MAX}). The
        simulation still runs; type a pattern with throws ≤ {GRAPH_N_MAX} to navigate the graph.
      </p>
    );
  }
  if (model.status === 'invalid') {
    return (
      <p role="note" style={{ ...statusStyle(palette), color: palette.amber }}>
        State graph needs a valid pattern with an integer ball count.
      </p>
    );
  }

  const { graph, layout, cycle, ballCount, graphMaxHeight } = model;
  const geometry = geometryOf(layout);
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

/** No-op node-click handler for the non-interactive minimap. */
const NOOP = (): void => {};

/**
 * The always-visible corner MINIMAP (DESIGN.md §5; owner requirement 2026-07-11):
 * a compact, non-interactive ring-graph preview in the scene's top-left corner
 * (under the toggle button) — cycle highlighted, no labels, the marker hopping
 * each beat is the point. Clicking anywhere on it opens the full overlay. It
 * reuses the memoized layout via {@link useGraphModel} and only the marker
 * subscribes to simTime, so it stays cheap even at dense (462-node) graphs.
 */
function GraphMinimap({ onExpand }: { onExpand(): void }): ReactElement {
  const palette = usePalette();
  const model = useGraphModel();

  const body =
    model.status === 'ok' ? (
      (() => {
        const { graph, layout, cycle, graphMaxHeight } = model;
        const geometry = geometryOf(layout, false);
        return (
          <svg
            viewBox={`0 0 ${geometry.width} ${geometry.height}`}
            role="img"
            aria-label="State graph minimap"
            style={{ display: 'block', width: '100%', height: '100%', pointerEvents: 'none' }}
          >
            <GraphPicture
              graph={graph}
              layout={layout}
              cycle={cycle}
              geometry={geometry}
              palette={palette}
              onNodeClick={NOOP}
              labels={false}
              interactive={false}
            />
            <CurrentStateMarker
              layout={layout}
              geometry={geometry}
              maxHeight={graphMaxHeight}
              markerLabel="State minimap marker"
            />
          </svg>
        );
      })()
    ) : (
      <span style={{ ...statusStyle(palette), fontSize: '0.68rem', textAlign: 'center', padding: '0.6rem' }}>
        graph unavailable — expand for details
      </span>
    );

  return (
    <button
      type="button"
      onClick={onExpand}
      aria-label="Expand state graph"
      title="Expand state graph"
      style={minimapCardStyle(palette)}
    >
      {body}
      <span aria-hidden style={minimapExpandGlyphStyle(palette)}>
        ⤢
      </span>
    </button>
  );
}

/**
 * The state-graph scene affordances (DESIGN.md §5, §6):
 *   • a persistent top-left toggle button that opens/closes the FULL overlay;
 *   • an always-visible corner MINIMAP under it (unless the overlay is open or the
 *     operator turned it off in Settings) that also expands the overlay on click;
 *   • the full interactive overlay (N stepper, hard reset, navigation) when
 *     `graphVisible`. When the overlay is closed its body unmounts (nothing derived
 *     or drawn beyond the cheap minimap).
 */
export function StateGraph(): ReactElement {
  const palette = usePalette();
  const graphVisible = useAppStore((state) => state.graphVisible);
  const graphMinimap = useAppStore((state) => state.graphMinimap);
  const graphMaxHeight = useAppStore((state) => state.graphMaxHeight);
  const graphNotice = useAppStore((state) => state.graphNotice);
  const toggleGraph = useAppStore((state) => state.toggleGraph);
  const setGraphVisible = useAppStore((state) => state.setGraphVisible);
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

      {/* Corner minimap, under the toggle (hidden while the overlay is open, or
          when the operator turned the minimap off — the toggle still opens it). */}
      {!graphVisible && graphMinimap ? (
        <GraphMinimap onExpand={() => setGraphVisible(true)} />
      ) : null}

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
            <Button onClick={() => setGraphVisible(false)} ariaLabel="Close state graph" variant="ghost">
              ✕ Close
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

/** The translucent minimap card, top-left under the toggle button. */
function minimapCardStyle(palette: Palette): CSSProperties {
  return {
    position: 'absolute',
    top: '2.7rem',
    left: '0.55rem',
    zIndex: 4,
    width: '200px',
    height: '200px',
    padding: '0.3rem',
    borderRadius: '0.5rem',
    border: `1px solid ${palette.border}`,
    // Very translucent so the scene reads behind it.
    background: palette.name === 'dark' ? 'rgba(15, 23, 42, 0.45)' : 'rgba(255, 255, 255, 0.5)',
    backdropFilter: 'blur(3px)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  };
}

/** The small ⤢ expand glyph pinned in the minimap's corner. */
function minimapExpandGlyphStyle(palette: Palette): CSSProperties {
  return {
    position: 'absolute',
    top: '0.15rem',
    right: '0.3rem',
    fontSize: '0.8rem',
    lineHeight: 1,
    color: palette.textSecondary,
    pointerEvents: 'none',
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
