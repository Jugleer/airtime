// src/ui/StateGraph — the state-graph OVERLAY (DESIGN.md §5; redesign 2026-07-10,
// owner requirement 7). The graph is a translucent overlay over the 3D scene,
// default OFF, toggled by a labeled button in the scene's TOP-LEFT corner (the
// camera presets sit top-right). When open, a semi-transparent dark backdrop
// covers the scene and the graph FILLS it; the scene stays visible behind. Node
// clicks navigate (BFS splice — past bit-identical); the marker, the transition
// status line, the N stepper and the hard-reset button live with the overlay.
//
// Expanded-view UX (owner 2026-07-12): the SVG viewBox is sized to the measured
// panel (CSS px, 1:1) and the layout is stretched PER-AXIS (draw layer only, core
// untouched) so it fills the space — especially horizontally, where the symmetric
// layouts are narrow. A `<g>` transform layers on TRANSIENT zoom (cursor-centered
// wheel, non-passive) + drag-to-pan (pointer capture, click/drag threshold) + reset
// (a top-left cluster button, or double-click) — never persisted to the URL. The
// same top-left cluster hosts the "Throw labels" toggle (moved off the sidebar).
//
// Layout (round 6, owner-approved): core's layoutStateGraph dispatches by size —
// symmetric stress majorization (exact mirror symmetry, ground at the top apex)
// up to STRESS_MAX_NODES, the concentric excitation rings beyond. The draw layer
// here is placement-independent (barbed rim arrowheads, split bidirectional arcs —
// each direction its own arrow — teardrop self-loops, throw-number chips, codec key
// gt). The corner minimap is ALWAYS shown while the overlay is closed. Performance:
// graph/layout/cycle are memoized per (b, N, pattern); only the marker + status
// line subscribe to simTime, and the zoom/pan transform never re-renders the picture.

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from 'react';
import { clamp } from '../core/math';
import {
  buildStateGraph,
  GRAPH_WARN_N,
  layoutStateGraph,
  STRESS_MAX_NODES,
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

// SVG geometry (viewBox units). The minimap keeps a fixed square box; the expanded
// overlay now sizes its viewBox to the MEASURED panel in CSS pixels (1 unit = 1 px)
// so the layout can be stretched per-axis to fill the space (owner 2026-07-12).
const VIEW_SIZE = 480;
const MARGIN_PLAIN = 30;
const MARGIN_LABELED = 60;
const MAX_NODE_RADIUS = 8;
const MIN_NODE_RADIUS = 1.6;
const TAU = Math.PI * 2;
const LABEL_NODE_LIMIT = 42;
/** Fallback overlay size (CSS px) before the panel is measured / in jsdom tests. */
const DEFAULT_OVERLAY_WIDTH = 760;
const DEFAULT_OVERLAY_HEIGHT = 460;
/** Wheel-zoom clamp + sensitivity for the expanded view (transient, never persisted). */
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 8;
const ZOOM_WHEEL_SENSITIVITY = 0.0015;
/** Pixels of pointer travel that turn a would-be node click into a pan (drag) gesture. */
const CLICK_DRAG_THRESHOLD = 4;
/**
 * Density gate (graphics redesign 2026-07-12). The draw layer counts NODES, not the
 * (shrinking) node radius, to decide clutter: at/under this many nodes the graph is
 * sparse enough to carry per-edge arrowheads and (in the overlay) throw-number
 * labels; above it, base arrowheads are dropped and throw labels auto-downgrade to
 * cycle-only. This replaces the old BASE_ARROW_MIN_RADIUS gate, which fired BACKWARDS
 * — small graphs got no arrows while a 400-node graph would have carried hundreds.
 */
const ARROW_NODE_LIMIT = 42;

/**
 * The state-graph draw-layer colors (graphics redesign 2026-07-12). The designer's
 * hexes are the DARK-theme values; the light-theme counterparts here keep the same
 * contrast roles over the light overlay backdrop. Kept LOCAL to the draw layer rather
 * than extended onto the shared {@link Palette} (owned by ui/theme, out of this
 * change's scope): the base greys, accent, amber and text still come from usePalette,
 * and only the graph's own secondary blues/greys are chosen per theme here.
 */
interface GraphColors {
  readonly baseEdge: string;
  readonly baseArrow: string;
  readonly cycleEdge: string;
  readonly cycleArrow: string;
  readonly cycleRim: string;
  readonly glow: string;
  readonly nodeFill: string;
  readonly nodeStroke: string;
  readonly homeRing: string;
  readonly hoverRing: string;
  readonly marker: string;
  readonly chipBg: string;
  readonly chipBorderBase: string;
  readonly chipBorderCycle: string;
  readonly throwCycle: string;
  readonly throwBase: string;
  readonly stateLabel: string;
}

function graphColors(palette: Palette): GraphColors {
  const dark = palette.name === 'dark';
  return {
    // Base edges/arrowheads: lifted off the too-dim palette.edgeStroke so heads read.
    baseEdge: dark ? '#42546f' : '#b4bdcb',
    baseArrow: dark ? '#7488a6' : '#7d8898',
    cycleEdge: palette.accent,
    cycleArrow: dark ? '#60a5fa' : '#5b8def',
    cycleRim: dark ? '#93c5fd' : '#bcd7fb',
    glow: palette.accent,
    nodeFill: palette.nodeFill,
    nodeStroke: palette.nodeStroke,
    homeRing: palette.textSecondary,
    hoverRing: palette.accentHover,
    marker: palette.amber,
    chipBg: dark ? 'rgba(11,17,32,0.86)' : 'rgba(248,250,252,0.92)',
    chipBorderBase: palette.border,
    chipBorderCycle: palette.accent,
    throwCycle: dark ? '#93c5fd' : palette.accent,
    throwBase: palette.textSecondary,
    stateLabel: palette.textSecondary,
  };
}

// --- Draw-layer geometry primitives (ported from the designer's mockups) ------

type Pt = { readonly x: number; readonly y: number };
const round2 = (n: number): number => Math.round(n * 100) / 100;
const vsub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const vadd = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
const vmul = (a: Pt, s: number): Pt => ({ x: a.x * s, y: a.y * s });
const vunit = (a: Pt): Pt => {
  const l = Math.hypot(a.x, a.y) || 1;
  return { x: a.x / l, y: a.y / l };
};
/** Left normal (90° CCW) of a vector. */
const vperp = (a: Pt): Pt => ({ x: -a.y, y: a.x });

/**
 * A BARBED arrowhead polygon (concave back at 0.55·len), tip at `tip`, pointing along
 * unit `dir`. Absolute size in view units (userSpaceOnUse semantics): it never
 * couples to stroke-width, so a dense graph's hairline edges still land a legible
 * head. The caller lands `tip` at the node rim so the node never occludes it.
 */
function arrowHead(tip: Pt, dir: Pt, len: number, width: number, fill: string, key: string): ReactElement {
  const back = { x: tip.x - dir.x * len, y: tip.y - dir.y * len };
  const n = vperp(dir);
  const half = width / 2;
  const left = { x: back.x + n.x * half, y: back.y + n.y * half };
  const right = { x: back.x - n.x * half, y: back.y - n.y * half };
  const notch = { x: tip.x - dir.x * len * 0.55, y: tip.y - dir.y * len * 0.55 };
  const points = `${round2(tip.x)},${round2(tip.y)} ${round2(left.x)},${round2(left.y)} ${round2(notch.x)},${round2(notch.y)} ${round2(right.x)},${round2(right.y)}`;
  return <polygon key={key} points={points} fill={fill} />;
}

/** A straight directed edge landing its head at b's rim; returns the throw-label point. */
function straightEdge(
  a: Pt, b: Pt, r: number, gap: number, stroke: string, width: number,
  arrowLen: number, arrowW: number, arrowFill: string, throwFS: number, key: string,
): { elements: ReactElement[]; labelPt: Pt } {
  const d = vunit(vsub(b, a));
  const start = vadd(a, vmul(d, r + gap));
  const tip = vsub(b, vmul(d, r + gap));
  const elements: ReactElement[] = [];
  if (arrowLen > 0) {
    const lineEnd = vsub(tip, vmul(d, arrowLen * 0.9));
    elements.push(
      <line key={`e-${key}`} x1={round2(start.x)} y1={round2(start.y)} x2={round2(lineEnd.x)} y2={round2(lineEnd.y)} stroke={stroke} strokeWidth={width} strokeLinecap="round" />,
      arrowHead(tip, d, arrowLen, arrowW, arrowFill, `h-${key}`),
    );
  } else {
    elements.push(
      <line key={`e-${key}`} x1={round2(start.x)} y1={round2(start.y)} x2={round2(tip.x)} y2={round2(tip.y)} stroke={stroke} strokeWidth={width} strokeLinecap="round" />,
    );
  }
  const nrm = vperp(d);
  const mid = vmul(vadd(a, b), 0.5);
  const labelPt = { x: mid.x + nrm.x * (throwFS * 0.85), y: mid.y + nrm.y * (throwFS * 0.85) };
  return { elements, labelPt };
}

/** A quadratic-arc directed edge (signed `bow` perpendicular offset); returns its label point. */
function arcEdge(
  a: Pt, b: Pt, r: number, gap: number, bow: number, stroke: string, width: number,
  arrowLen: number, arrowW: number, arrowFill: string, throwFS: number, key: string,
): { elements: ReactElement[]; labelPt: Pt } {
  const mid = vmul(vadd(a, b), 0.5);
  const chord = vunit(vsub(b, a));
  const nrm = vperp(chord);
  const ctrl = vadd(mid, vmul(nrm, bow));
  const dStart = vunit(vsub(ctrl, a));
  const dTip = vunit(vsub(b, ctrl));
  const start = vadd(a, vmul(dStart, r + gap));
  const tip = vsub(b, vmul(dTip, r + gap));
  const lineEnd = arrowLen > 0 ? vsub(tip, vmul(dTip, arrowLen * 0.9)) : tip;
  const elements: ReactElement[] = [
    <path key={`e-${key}`} d={`M ${round2(start.x)} ${round2(start.y)} Q ${round2(ctrl.x)} ${round2(ctrl.y)} ${round2(lineEnd.x)} ${round2(lineEnd.y)}`} fill="none" stroke={stroke} strokeWidth={width} strokeLinecap="round" />,
  ];
  if (arrowLen > 0) {
    elements.push(arrowHead(tip, dTip, arrowLen, arrowW, arrowFill, `h-${key}`));
  }
  // Quadratic-Bézier apex at t = 0.5, nudged further off the arc so the chip clears it.
  const apex = { x: 0.25 * a.x + 0.5 * ctrl.x + 0.25 * b.x, y: 0.25 * a.y + 0.5 * ctrl.y + 0.25 * b.y };
  const sign = Math.sign(bow) || 1;
  const labelPt = { x: apex.x + sign * nrm.x * (throwFS * 0.4), y: apex.y + sign * nrm.y * (throwFS * 0.4) };
  return { elements, labelPt };
}

/** A teardrop self-loop (cubic) with a barbed head, pointing outward along `angleOut`. */
function selfLoop(
  c: Pt, r: number, angleOut: number, reach: number, stroke: string, width: number,
  arrowLen: number, arrowW: number, arrowFill: string, key: string,
): { elements: ReactElement[]; apex: Pt } {
  const spread = 0.62;
  const p1 = { x: c.x + r * Math.cos(angleOut - spread), y: c.y + r * Math.sin(angleOut - spread) };
  const p2 = { x: c.x + r * Math.cos(angleOut + spread), y: c.y + r * Math.sin(angleOut + spread) };
  const o = { x: Math.cos(angleOut), y: Math.sin(angleOut) };
  const c1 = { x: p1.x + o.x * reach, y: p1.y + o.y * reach };
  const c2 = { x: p2.x + o.x * reach, y: p2.y + o.y * reach };
  const dTip = vunit(vsub(p2, c2));
  const tip = p2;
  const end = { x: tip.x - dTip.x * arrowLen * 0.9, y: tip.y - dTip.y * arrowLen * 0.9 };
  const elements: ReactElement[] = [
    <path key={`e-${key}`} d={`M ${round2(p1.x)} ${round2(p1.y)} C ${round2(c1.x)} ${round2(c1.y)} ${round2(c2.x)} ${round2(c2.y)} ${round2(end.x)} ${round2(end.y)}`} fill="none" stroke={stroke} strokeWidth={width} strokeLinecap="round" />,
    arrowHead(tip, dTip, arrowLen, arrowW, arrowFill, `h-${key}`),
  ];
  const apex = { x: c.x + (r + reach) * Math.cos(angleOut), y: c.y + (r + reach) * Math.sin(angleOut) };
  return { elements, apex };
}

/** Direction (radians) pointing from the graph centroid out through `p` (fallback for the centre). */
function awayAngle(p: Pt, centroid: Pt, fallback: number): number {
  const dx = p.x - centroid.x;
  const dy = p.y - centroid.y;
  return Math.hypot(dx, dy) > 1e-6 ? Math.atan2(dy, dx) : fallback;
}

/**
 * Belt-and-braces linear-chain detector (spec: "in case a degenerate layout ever
 * reaches the draw layer"). Returns a fan `bow` function only when every node is
 * ~collinear (max perpendicular spread below ~a node radius) — so it NEVER fires on
 * the 2D concentric/stress layouts, whose nodes fill a disc. When it does fire, edges
 * fan to one side with magnitude scaling by level distance (mockup 06).
 */
function collinearFan(
  nodes: GraphLayout['nodes'],
  posOf: Map<number, Pt>,
  centroid: Pt,
  nodeRadius: number,
): ((fromLevel: number, toBits: number) => number) | null {
  const pts = nodes.map((n) => posOf.get(n.bits)).filter((p): p is Pt => p !== undefined);
  if (pts.length < 3) {
    return null;
  }
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of pts) {
    const dx = p.x - centroid.x;
    const dy = p.y - centroid.y;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const perp = { x: -Math.sin(theta), y: Math.cos(theta) };
  let maxPerp = 0;
  for (const p of pts) {
    const d = Math.abs((p.x - centroid.x) * perp.x + (p.y - centroid.y) * perp.y);
    if (d > maxPerp) {
      maxPerp = d;
    }
  }
  if (maxPerp > Math.max(nodeRadius * 1.2, 2)) {
    return null;
  }
  const levelOf = new Map(nodes.map((n) => [n.bits, n.level] as const));
  return (fromLevel, toBits) => {
    const d = Math.abs((levelOf.get(toBits) ?? 0) - fromLevel);
    return -(nodeRadius * 2.5 + Math.max(0, d - 1) * nodeRadius * 2.2);
  };
}

/** A throw-number label: a backdrop pill (chip) with the throw value, kept legible over crossings. */
function throwChip(
  x: number, y: number, value: number, fontSize: number,
  textFill: string, border: string, bg: string, key: string,
): ReactElement {
  const s = String(value);
  const w = s.length * fontSize * 0.62 + fontSize * 0.7;
  const h = fontSize + fontSize * 0.5;
  return (
    <g key={key} style={{ pointerEvents: 'none' }}>
      <rect x={round2(x - w / 2)} y={round2(y - h / 2)} width={round2(w)} height={round2(h)} rx={round2(h / 2)} fill={bg} stroke={border} strokeWidth={0.6} />
      <text x={round2(x)} y={round2(y + fontSize * 0.34)} textAnchor="middle" fontSize={fontSize} fill={textFill} style={{ fontFamily: 'ui-monospace, monospace' }}>
        {s}
      </text>
    </g>
  );
}

interface GraphGeometry {
  readonly width: number;
  readonly height: number;
  readonly nodeRadius: number;
  readonly markerRadius: number;
  toX(x: number): number;
  toY(y: number): number;
}

/**
 * Map the (pure, deterministic) normalized layout into a `width × height` pixel box,
 * per-axis (owner 2026-07-12: "fill the space when expanded"). Core normalizes the
 * layout UNIFORMLY into [0.06, 0.94] so a symmetric graph that is taller than wide
 * stays narrow in x — which read as "tightly clustered near the centre". The draw
 * layer here — NOT core — remaps each axis independently from the layout's actual
 * bounding box to [margin, dim − margin], so x stretches to fill a wide panel while
 * the mirror-about-the-vertical-axis symmetry is preserved (an x-only stretch keeps
 * left/right mirrored). The stretch touches ONLY node POSITIONS; node radii, arc
 * bows and label offsets are all in screen units (see GraphPicture), so circles stay
 * circular and arcs/labels never distort. `width`/`height` are the SVG viewBox size
 * (the square VIEW_SIZE for the minimap; the measured panel in CSS px for the overlay).
 */
function geometryOf(
  layout: GraphLayout,
  width: number,
  height: number,
  labeled: boolean = layout.nodes.length <= LABEL_NODE_LIMIT,
): GraphGeometry {
  // The minimap draws no labels at any size (owner requirement), so it passes
  // `labeled = false` to reclaim the label margin and fill its small box.
  const margin = labeled ? MARGIN_LABELED : MARGIN_PLAIN;
  const spanX = Math.max(1, width - 2 * margin);
  const spanY = Math.max(1, height - 2 * margin);

  // The layout's actual bounding box (per-axis) — what we stretch to fill the panel.
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const node of layout.nodes) {
    minX = Math.min(minX, node.x);
    maxX = Math.max(maxX, node.x);
    minY = Math.min(minY, node.y);
    maxY = Math.max(maxY, node.y);
  }
  const domX = maxX - minX;
  const domY = maxY - minY;
  // Degenerate axis (single column/row/node): centre it rather than divide by ~0.
  const scaleX = domX > 1e-6 ? spanX / domX : 0;
  const scaleY = domY > 1e-6 ? spanY / domY : 0;
  const toX = (x: number): number =>
    scaleX > 0 ? margin + (x - minX) * scaleX : width / 2;
  const toY = (y: number): number =>
    scaleY > 0 ? margin + (y - minY) * scaleY : height / 2;

  // Node radius from the min screen-space arc gap (per ring). Under a non-uniform
  // stretch the tighter axis constrains spacing, so use the SMALLER per-axis scale
  // (pixels per normalized unit) — nodes never overlap on the compressed axis while
  // the other axis simply gains breathing room.
  const scaleMin = Math.min(scaleX || Infinity, scaleY || Infinity);
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
    if (count > 1 && radius > 0 && Number.isFinite(scaleMin)) {
      minArcGap = Math.min(minArcGap, (TAU * radius * scaleMin) / count);
    }
  }
  const nodeRadius = Number.isFinite(minArcGap)
    ? Math.min(MAX_NODE_RADIUS, Math.max(MIN_NODE_RADIUS, minArcGap * 0.42))
    : MAX_NODE_RADIUS;
  return {
    width,
    height,
    nodeRadius,
    // A readable size FLOOR so the amber marker stays findable on dense graphs where
    // nodeRadius bottoms out at MIN_NODE_RADIUS (graphics redesign 2026-07-12).
    markerRadius: Math.max(2.4, nodeRadius * 0.62),
    toX,
    toY,
  };
}

/**
 * The static graph picture (graphics redesign 2026-07-12 — placement-independent, so
 * it renders whatever layout it is handed, concentric or the symmetric-stress one).
 * Edges are barbed-arrow polygons landing at the node rim (never occluded); base edges
 * hairline, cycle edges accent-blue; bidirectional pairs split into opposite arcs;
 * self-loops are teardrops (drawn for ALL, not only on-cycle); throw-number labels are
 * halo chips (overlay only); cycle nodes get a soft glow + light rim; the ground gets
 * a dashed home ring; interactive nodes carry a hover ring. All decoration is gated by
 * NODE COUNT (not the shrinking radius) so dense graphs stay legible.
 */
const GraphPicture = memo(function GraphPicture({
  graph,
  layout,
  cycle,
  geometry,
  palette,
  onNodeClick,
  labels,
  interactive = true,
  decorated = true,
  showThrowLabels = false,
  idPrefix,
}: {
  readonly graph: CoreStateGraph;
  readonly layout: GraphLayout;
  readonly cycle: PatternCycle;
  readonly geometry: GraphGeometry;
  readonly palette: Palette;
  onNodeClick(bits: number): void;
  /** Force node labels on/off; defaults to the node-count rule (overlay behavior). */
  readonly labels?: boolean;
  /** When false (the minimap), nodes are plain, unclickable circles (no role/aria/hover). */
  readonly interactive?: boolean;
  /** When false (the minimap), skip the glow filter + home ring to stay cheap/clean. */
  readonly decorated?: boolean;
  /** Overlay throw-number labels (auto-downgrades to cycle-only above the density limit). */
  readonly showThrowLabels?: boolean;
  /** Unique id namespace for this instance's filter defs (overlay vs minimap). */
  readonly idPrefix: string;
}): ReactElement {
  const c = graphColors(palette);
  const { toX, toY, nodeRadius: nr } = geometry;
  const nodeCount = layout.nodes.length;
  const baseArrows = nodeCount <= ARROW_NODE_LIMIT;
  const throwMode: 'off' | 'all' | 'cycleOnly' = !showThrowLabels
    ? 'off'
    : nodeCount > ARROW_NODE_LIMIT
      ? 'cycleOnly'
      : 'all';

  const gap = 1.3;
  const baseLen = clamp(nr * 1.5, 6.5, 11);
  const baseW = baseLen * 0.78;
  const cycleLen = clamp(nr * 1.75, 8, 13);
  const cycleW = cycleLen * 0.82;
  const throwFS = clamp(nr * 1.18, 6.5, 10);

  const cycleEdgeKeys = new Set(cycle.edges.map((edge) => `${edge.from}:${edge.to}`));

  // Screen-space node positions + centroid + the full edge set (for the bidirectional
  // pair test — a `to→from` twin means we split both directions into opposite arcs).
  const posOf = new Map<number, Pt>();
  for (const node of layout.nodes) {
    posOf.set(node.bits, { x: toX(node.x), y: toY(node.y) });
  }
  let cx = 0;
  let cy = 0;
  for (const p of posOf.values()) {
    cx += p.x;
    cy += p.y;
  }
  const centroid: Pt = { x: cx / (posOf.size || 1), y: cy / (posOf.size || 1) };
  const edgeSet = new Set<string>();
  for (const node of layout.nodes) {
    for (const edge of graph.edgesFrom(node.bits)) {
      edgeSet.add(`${node.bits}:${edge.to}`);
    }
  }
  const fan = collinearFan(layout.nodes, posOf, centroid, nr);

  const baseEdges: ReactElement[] = [];
  const cycleEdges: ReactElement[] = [];
  const loopEdges: ReactElement[] = [];
  const candidates: { readonly x: number; readonly y: number; readonly val: number; readonly onCyc: boolean; readonly key: string }[] = [];

  for (const node of layout.nodes) {
    const a = posOf.get(node.bits);
    if (!a) {
      continue;
    }
    for (const edge of graph.edgesFrom(node.bits)) {
      const key = `${node.bits}:${edge.to}`;
      const rkey = `${edge.to}:${node.bits}`;
      const onCycle = cycleEdgeKeys.has(key);

      if (edge.to === node.bits) {
        // Self-loop teardrop — drawn for ALL self-loops (base included), with a head.
        const outAngle = awayAngle(a, centroid, node.angle);
        const loop = selfLoop(
          a,
          nr,
          outAngle,
          nr * 2.2,
          onCycle ? c.cycleEdge : c.baseEdge,
          onCycle ? 2 : 1,
          onCycle ? cycleLen * 0.8 : baseLen * 0.75,
          onCycle ? cycleW * 0.8 : baseW * 0.75,
          onCycle ? c.cycleArrow : c.baseArrow,
          key,
        );
        (onCycle ? cycleEdges : loopEdges).push(...loop.elements);
        candidates.push({ x: loop.apex.x, y: loop.apex.y, val: edge.throwValue, onCyc: onCycle, key });
        continue;
      }
      const b = posOf.get(edge.to);
      if (!b) {
        continue;
      }
      const stroke = onCycle ? c.cycleEdge : c.baseEdge;
      const width = onCycle ? 2.2 : 1;
      const arrowFill = onCycle ? c.cycleArrow : c.baseArrow;
      // Base arrowheads honour the density gate; cycle arrows always show.
      const arrowLen = onCycle ? cycleLen : baseArrows ? baseLen : 0;
      const arrowW = onCycle ? cycleW : baseArrows ? baseW : 0;
      // Bidirectional split (owner 2026-07-12): A↔B must render as TWO clearly
      // separated arrows, one per direction. `arcEdge` offsets its control point by
      // `bow` along the chord's LEFT normal, and that normal FLIPS with the edge's
      // direction (A→B vs B→A point opposite ways). So a SAME-SIGN bow for both
      // directions lands the two control points on OPPOSITE screen sides of the chord
      // — the split. (The old code used opposite signs, which — because the normal
      // already flips — put both control points on the SAME side, collapsing the pair
      // into one doubled/indistinct arc.) The magnitude scales with the on-screen
      // chord length so the two arcs bow far enough apart to read, with their heads
      // landing at opposite node rims without overlapping.
      const bow = fan
        ? fan(node.level, edge.to)
        : edgeSet.has(rkey)
          ? clamp(Math.hypot(b.x - a.x, b.y - a.y) * 0.2, 10, 30)
          : 0;
      const built =
        bow === 0
          ? straightEdge(a, b, nr, gap, stroke, width, arrowLen, arrowW, arrowFill, throwFS, key)
          : arcEdge(a, b, nr, gap, bow, stroke, width, arrowLen, arrowW, arrowFill, throwFS, key);
      (onCycle ? cycleEdges : baseEdges).push(...built.elements);
      candidates.push({ x: built.labelPt.x, y: built.labelPt.y, val: edge.throwValue, onCyc: onCycle, key });
    }
  }

  // Throw labels: place cycle labels first (always), then base labels only where a
  // grid cell is still free — a graceful auto-hide where edges crowd (the "collision
  // behaviour"). Dense graphs (throwMode 'cycleOnly') drop base labels entirely.
  const throwLabels: ReactElement[] = [];
  if (throwMode !== 'off') {
    const cells = new Set<string>();
    const cellW = throwFS * 1.35;
    const cellH = throwFS * 1.15;
    const ordered = [...candidates.filter((k) => k.onCyc), ...candidates.filter((k) => !k.onCyc)];
    for (const cand of ordered) {
      if (throwMode === 'cycleOnly' && !cand.onCyc) {
        continue;
      }
      const cellKey = `${Math.round(cand.x / cellW)}:${Math.round(cand.y / cellH)}`;
      if (!cand.onCyc && cells.has(cellKey)) {
        continue;
      }
      cells.add(cellKey);
      throwLabels.push(
        throwChip(
          cand.x,
          cand.y,
          cand.val,
          throwFS,
          cand.onCyc ? c.throwCycle : c.throwBase,
          cand.onCyc ? c.chipBorderCycle : c.chipBorderBase,
          c.chipBg,
          `t-${cand.key}`,
        ),
      );
    }
  }

  const showLabels = labels ?? nodeCount <= LABEL_NODE_LIMIT;
  const ground = graph.ground;
  const glowLayer: ReactElement[] = [];
  const nodeEls: ReactElement[] = [];
  for (const node of layout.nodes) {
    const p = posOf.get(node.bits);
    if (!p) {
      continue;
    }
    const onCycle = cycle.nodeSet.has(node.bits);
    if (onCycle && decorated) {
      glowLayer.push(
        <circle
          key={`glow-${node.bits}`}
          cx={round2(p.x)}
          cy={round2(p.y)}
          r={round2(nr * 1.7)}
          fill={c.glow}
          opacity={0.28}
          filter={`url(#${idPrefix}-softglow)`}
        />,
      );
    }
    const decoRings: ReactElement[] = [];
    if (decorated && node.bits === ground) {
      decoRings.push(
        <circle
          key="home"
          cx={round2(p.x)}
          cy={round2(p.y)}
          r={round2(nr + 3.5)}
          fill="none"
          stroke={c.homeRing}
          strokeWidth={1}
          strokeDasharray="2.4 2.4"
          style={{ pointerEvents: 'none' }}
        />,
      );
    }
    if (interactive) {
      // Pointer hover / keyboard focus surfaces an accent ring (see the <style> below).
      decoRings.push(
        <circle
          key="hover"
          className="sg-hover-ring"
          cx={round2(p.x)}
          cy={round2(p.y)}
          r={round2(nr + 3.5)}
          fill="none"
          stroke={c.hoverRing}
          strokeWidth={1.6}
          style={{ pointerEvents: 'none', opacity: 0 }}
        />,
      );
    }
    const interactiveProps = interactive
      ? {
          role: 'button',
          'aria-label': `State ${node.label}`,
          style: { cursor: 'pointer' as const },
          onClick: () => onNodeClick(node.bits),
        }
      : {};
    const labelAngle = cycleEdgeKeys.has(`${node.bits}:${node.bits}`) ? node.angle + Math.PI : node.angle;
    const labelCos = Math.cos(labelAngle);
    const labelDistance = nr + 8;
    const labelAnchor = labelCos > 0.35 ? 'start' : labelCos < -0.35 ? 'end' : 'middle';
    const labelFS = clamp(nr * 1.05, 7, 9);
    nodeEls.push(
      <g key={`node-${node.bits}`} className={interactive ? 'sg-node' : undefined}>
        {decoRings}
        <circle
          cx={round2(p.x)}
          cy={round2(p.y)}
          r={round2(nr)}
          fill={onCycle ? c.cycleEdge : c.nodeFill}
          stroke={onCycle ? c.cycleRim : c.nodeStroke}
          strokeWidth={onCycle ? 1.4 : 1.2}
        >
          <title>{`state ${node.label} (level ${node.level})`}</title>
        </circle>
        {interactive ? (
          // Finger-sized transparent hit target: the visible circle is only 3–16 px,
          // untappable on touch. This overlay (drawn last, so it owns the pointer) stays
          // ≥ 22 px in user space regardless of the node radius, and carries ALL the
          // interactive affordances (click, keyboard, role/label). Being transparent it
          // paints nothing over its neighbours.
          <circle
            {...interactiveProps}
            cx={round2(p.x)}
            cy={round2(p.y)}
            r={round2(Math.max(nr, 22))}
            fill="transparent"
            pointerEvents="all"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onNodeClick(node.bits);
              }
            }}
          />
        ) : null}
        {showLabels ? (
          <text
            x={round2(p.x + labelCos * labelDistance)}
            y={round2(p.y + Math.sin(labelAngle) * labelDistance + labelFS * 0.35)}
            textAnchor={labelAnchor}
            fontSize={labelFS}
            fill={c.stateLabel}
            style={{ pointerEvents: 'none', fontFamily: 'ui-monospace, monospace' }}
          >
            {node.label}
          </text>
        ) : null}
      </g>,
    );
  }

  return (
    <>
      <defs>
        {decorated ? (
          // One shared soft-glow filter (cycle-node haloes + the marker). Cycle nodes
          // are few (the pattern's period), so per-cycle-node glow stays cheap even on
          // a 126-node graph; the minimap skips it entirely (decorated=false).
          <filter id={`${idPrefix}-softglow`} x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation={3.2} />
          </filter>
        ) : null}
      </defs>
      {interactive ? (
        <style>{`.sg-node:hover .sg-hover-ring,.sg-node:focus-within .sg-hover-ring{opacity:1 !important;}`}</style>
      ) : null}
      <g>{glowLayer}</g>
      <g>{baseEdges}</g>
      <g>{loopEdges}</g>
      <g>{cycleEdges}</g>
      <g>{nodeEls}</g>
      <g>{throwLabels}</g>
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
  color,
  markerLabel = 'Current state marker',
  glowFilterId,
}: {
  readonly layout: GraphLayout;
  readonly geometry: GraphGeometry;
  readonly maxHeight: number;
  /** The (theme-aware) amber marker color. */
  readonly color: string;
  readonly markerLabel?: string;
  /** When set (the overlay), a faint glow keeps the marker findable each beat. */
  readonly glowFilterId?: string;
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
  const mx = round2(geometry.toX(coord.x));
  const my = round2(geometry.toY(coord.y));
  const r = geometry.markerRadius;
  return (
    <g style={{ pointerEvents: 'none' }}>
      {glowFilterId ? (
        <circle cx={mx} cy={my} r={round2(r * 1.7)} fill={color} opacity={0.35} filter={`url(#${glowFilterId})`} />
      ) : null}
      <circle
        aria-label={markerLabel}
        cx={mx}
        cy={my}
        r={round2(r)}
        fill={color}
        stroke="#ffffff"
        strokeWidth={1.3}
      />
    </g>
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
      <p role="status" style={{ ...statusStyle(palette), color: palette.amber, fontWeight: 700 }}>
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
  // The running pattern is sync/multiplex — the state graph covers vanilla only (ruling 3).
  | { readonly status: 'compiled' }
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
  const isCompiled = sim.compiled !== undefined;
  const patternMax = maxThrowOf(values);
  const unavailable = patternMax > GRAPH_N_MAX;

  const derived = useMemo(() => {
    if (unavailable || isCompiled || !Number.isInteger(ballCount)) {
      return null;
    }
    const graph = buildStateGraph(ballCount, graphMaxHeight);
    const layout = layoutStateGraph(graph);
    return { graph, layout };
  }, [ballCount, graphMaxHeight, unavailable, isCompiled]);

  const cycle = useMemo(
    () => (derived ? patternCycle(values, graphMaxHeight) : null),
    [derived, values, graphMaxHeight],
  );

  // Sync/multiplex is not a vanilla state-graph cycle — show an honest placeholder
  // and disable navigation rather than draw a misleading (or empty) graph (ruling 3).
  if (isCompiled) {
    return { status: 'compiled' };
  }
  if (unavailable) {
    return { status: 'unavailable', patternMax };
  }
  if (!derived || !cycle) {
    return { status: 'invalid' };
  }
  return { status: 'ok', graph: derived.graph, layout: derived.layout, cycle, ballCount, graphMaxHeight };
}

/** Just the interactive-graph member of the {@link GraphModel} union (canvas prop). */
type OkGraphModel = Extract<GraphModel, { status: 'ok' }>;

/**
 * Measure a container's content box in CSS px so the overlay's SVG viewBox can match
 * it 1:1 (needed for cursor-centered zoom and per-axis fill). Defaults to a sensible
 * size before the first layout — and in jsdom, where ResizeObserver is absent and
 * clientWidth/Height read 0, the default is simply kept (so tests still render nodes).
 */
function useMeasuredSize(): {
  readonly ref: React.RefObject<HTMLDivElement | null>;
  readonly width: number;
  readonly height: number;
} {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: DEFAULT_OVERLAY_WIDTH, height: DEFAULT_OVERLAY_HEIGHT });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) {
      return undefined;
    }
    const read = (): void => {
      const width = element.clientWidth;
      const height = element.clientHeight;
      if (width > 0 && height > 0) {
        setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
      }
    };
    read();
    if (typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    const observer = new ResizeObserver(read);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width: size.width, height: size.height };
}

interface ZoomPan {
  /** SVG transform for the content group (translate then scale). */
  readonly transform: string;
  /** True when zoomed or panned off the identity view (gates the ↺ Reset affordance). */
  readonly transformed: boolean;
  reset(): void;
  /** True while the last gesture crossed the drag threshold (a pan, not a node click). */
  readonly movedRef: React.MutableRefObject<boolean>;
  onPointerDown(event: ReactPointerEvent<SVGSVGElement>): void;
  onPointerMove(event: ReactPointerEvent<SVGSVGElement>): void;
  onPointerUp(event: ReactPointerEvent<SVGSVGElement>): void;
}

/**
 * Transient zoom/pan for the expanded graph (owner 2026-07-12) — NEVER persisted
 * (not in the codec/URL): wheel-zoom centered on the cursor (clamped MIN_ZOOM–MAX_ZOOM
 * via a NON-PASSIVE wheel listener so the page never scrolls — the Slider precedent in
 * ui/widgets), drag-to-pan with pointer capture, and reset (the cluster button or a
 * double-click). A small movement threshold distinguishes a click (navigate) from a
 * drag (pan): capture only engages once the pointer crosses it, so a plain node click
 * is never swallowed. Zoom/pan is a `<g>` transform, so GraphPicture (memoized) does
 * not re-render as the view moves — only the transform attribute updates.
 */
function useZoomPan(svgRef: React.RefObject<SVGSVGElement | null>): ZoomPan {
  const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const dragRef = useRef<
    { startX: number; startY: number; startTx: number; startTy: number; pointerId: number } | null
  >(null);
  const movedRef = useRef(false);
  // Every active pointer (client coords), so two-finger pinch-zoom can be detected on
  // touch. A single pointer keeps doing pan (below); exactly two drives pinch.
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{
    startDist: number;
    startMidX: number;
    startMidY: number;
    startScale: number;
    startTx: number;
    startTy: number;
  } | null>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) {
      return undefined;
    }
    const handler = (event: WheelEvent): void => {
      if (event.deltaY === 0) {
        return;
      }
      event.preventDefault(); // keep the page from scrolling while zooming
      const rect = svg.getBoundingClientRect();
      // viewBox == element px (1:1), so client−rect IS the SVG/user coordinate.
      const cx = event.clientX - rect.left;
      const cy = event.clientY - rect.top;
      setView((v) => {
        const scale = clamp(v.scale * Math.exp(-event.deltaY * ZOOM_WHEEL_SENSITIVITY), MIN_ZOOM, MAX_ZOOM);
        const factor = scale / v.scale;
        // Keep the point under the cursor fixed: p = t + s·w ⇒ t' = p − factor·(p − t).
        return { scale, tx: cx - factor * (cx - v.tx), ty: cy - factor * (cy - v.ty) };
      });
    };
    svg.addEventListener('wheel', handler, { passive: false });
    return () => svg.removeEventListener('wheel', handler);
  }, [svgRef]);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>): void => {
      // Track every active pointer so a second finger can start a pinch (touch zoom).
      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointersRef.current.size === 2) {
        // Second finger down → begin a pinch. Cancel any single-pointer pan in flight,
        // and mark the gesture "moved" so the closing tap never navigates a node.
        dragRef.current = null;
        movedRef.current = true;
        const rect = svgRef.current?.getBoundingClientRect();
        const [a, b] = [...pointersRef.current.values()];
        if (!a || !b) {
          return;
        }
        const v = viewRef.current;
        pinchRef.current = {
          startDist: Math.max(1e-6, Math.hypot(a.x - b.x, a.y - b.y)),
          startMidX: (a.x + b.x) / 2 - (rect?.left ?? 0),
          startMidY: (a.y + b.y) / 2 - (rect?.top ?? 0),
          startScale: v.scale,
          startTx: v.tx,
          startTy: v.ty,
        };
        return;
      }
      if (event.button !== 0) {
        return; // primary button / touch only (leave right-click for the browser)
      }
      movedRef.current = false;
      const v = viewRef.current;
      dragRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        startTx: v.tx,
        startTy: v.ty,
        pointerId: event.pointerId,
      };
    },
    [svgRef],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>): void => {
      const pointers = pointersRef.current;
      if (pointers.has(event.pointerId)) {
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      }
      // Two-finger pinch-zoom (touch): scale by the finger-distance ratio and keep the
      // content point under the pinch midpoint fixed — the same transform math the wheel
      // uses (p = t + s·w ⇒ t = mid − scale·w), folding zoom and pan into one update.
      const pinch = pinchRef.current;
      if (pinch && pointers.size === 2) {
        event.preventDefault();
        const rect = svgRef.current?.getBoundingClientRect();
        const [a, b] = [...pointers.values()];
        if (!a || !b) {
          return;
        }
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const midX = (a.x + b.x) / 2 - (rect?.left ?? 0);
        const midY = (a.y + b.y) / 2 - (rect?.top ?? 0);
        const scale = clamp(pinch.startScale * (dist / pinch.startDist), MIN_ZOOM, MAX_ZOOM);
        // Content point under the gesture-start midpoint: w = (startMid − startT)/startScale.
        const wx = (pinch.startMidX - pinch.startTx) / pinch.startScale;
        const wy = (pinch.startMidY - pinch.startTy) / pinch.startScale;
        setView({ scale, tx: midX - scale * wx, ty: midY - scale * wy });
        return;
      }
      const drag = dragRef.current;
      if (!drag) {
        return;
      }
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (!movedRef.current && Math.hypot(dx, dy) > CLICK_DRAG_THRESHOLD) {
        // Crossed the threshold: this is a pan, not a click. Capture the pointer now
        // (not on down) so a plain click still reaches the node's own handler.
        movedRef.current = true;
        const svg = svgRef.current;
        if (svg && typeof svg.setPointerCapture === 'function') {
          try {
            svg.setPointerCapture(drag.pointerId);
          } catch {
            // jsdom / unsupported: capture is a nicety, not required.
          }
        }
      }
      if (movedRef.current) {
        setView((v) => ({ scale: v.scale, tx: drag.startTx + dx, ty: drag.startTy + dy }));
        event.preventDefault();
      }
    },
    [svgRef],
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>): void => {
      pointersRef.current.delete(event.pointerId);
      if (pointersRef.current.size < 2) {
        pinchRef.current = null;
      }
      // Lifting one finger of a pinch while the other stays down → hand the remaining
      // pointer to the pan path so the graph keeps tracking it without a jump.
      if (pointersRef.current.size === 1 && !dragRef.current) {
        const remaining = [...pointersRef.current.entries()][0];
        if (remaining) {
          const [id, pos] = remaining;
          const v = viewRef.current;
          dragRef.current = { startX: pos.x, startY: pos.y, startTx: v.tx, startTy: v.ty, pointerId: id };
          movedRef.current = true;
        }
      }
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) {
        return; // no pan, or this up belongs to a different (e.g. handed-over) pointer
      }
      dragRef.current = null;
      const svg = svgRef.current;
      if (svg && typeof svg.releasePointerCapture === 'function') {
        try {
          svg.releasePointerCapture(event.pointerId);
        } catch {
          // ignore
        }
      }
    },
    [svgRef],
  );

  const reset = useCallback((): void => {
    movedRef.current = false;
    setView({ scale: 1, tx: 0, ty: 0 });
  }, []);

  return {
    transform: `translate(${view.tx} ${view.ty}) scale(${view.scale})`,
    transformed: view.scale !== 1 || view.tx !== 0 || view.ty !== 0,
    reset,
    movedRef,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  };
}

/**
 * The small top-left control cluster over the EXPANDED graph (owner 2026-07-12): the
 * "Throw labels" toggle (relocated from the sidebar View group) and — only once the
 * view is zoomed/panned — a "↺ Reset view" button. Absolutely positioned at the graph
 * area's top-left corner so it overlays the drawing without stealing its space.
 */
function GraphOverlayCluster({
  onResetView,
  showReset,
}: {
  onResetView(): void;
  readonly showReset: boolean;
}): ReactElement {
  const palette = usePalette();
  const graphThrowLabels = useAppStore((state) => state.graphThrowLabels);
  const toggleGraphThrowLabels = useAppStore((state) => state.toggleGraphThrowLabels);
  return (
    <div style={clusterStyle(palette)}>
      <label style={clusterToggleStyle(palette)}>
        <input type="checkbox" checked={graphThrowLabels} onChange={toggleGraphThrowLabels} />
        <span>Throw labels</span>
      </label>
      {showReset ? (
        <button
          type="button"
          onClick={onResetView}
          aria-label="Reset graph view"
          title="Reset zoom and pan (or double-click the graph)"
          style={clusterButtonStyle(palette)}
        >
          ↺ Reset view
        </button>
      ) : null}
    </div>
  );
}

/**
 * The full-overlay graph body: derived graph/layout/cycle + the interactive SVG. This
 * dispatcher only surfaces the honest notices; the interactive canvas (which owns the
 * measure + zoom/pan hooks) is a child so those hooks are never called conditionally.
 */
function StateGraphBody(): ReactElement {
  const palette = usePalette();
  const model = useGraphModel();

  if (model.status === 'unavailable') {
    return (
      <p role="note" style={{ ...statusStyle(palette), color: palette.amber }}>
        State graph unavailable for this pattern (max throw {model.patternMax} &gt; {GRAPH_N_MAX}). The
        simulation still runs; type a pattern with throws ≤ {GRAPH_N_MAX} to navigate the graph.
      </p>
    );
  }
  if (model.status === 'compiled') {
    return (
      <p role="note" style={{ ...statusStyle(palette), color: palette.amber }}>
        State graph covers vanilla (asynchronous) patterns only (for now). Sync and multiplex
        patterns still run — navigation from the graph is disabled here.
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
  return <StateGraphCanvas model={model} />;
}

/**
 * The interactive graph canvas. The SVG viewBox is sized to the MEASURED panel (CSS px,
 * 1 unit = 1 px) and the layout is stretched per-axis to FILL it (owner 2026-07-12);
 * a `<g>` transform layers on transient zoom/pan. Node clicks still navigate — a small
 * drag threshold tells a click apart from a pan.
 */
function StateGraphCanvas({ model }: { readonly model: OkGraphModel }): ReactElement {
  const palette = usePalette();
  const navigateToState = useAppStore((state) => state.navigateToState);
  const graphThrowLabels = useAppStore((state) => state.graphThrowLabels);
  const { graph, layout, cycle, ballCount, graphMaxHeight } = model;

  const container = useMeasuredSize();
  const svgRef = useRef<SVGSVGElement>(null);
  const zoom = useZoomPan(svgRef);
  const { movedRef } = zoom;
  const geometry = useMemo(
    () => geometryOf(layout, container.width, container.height),
    [layout, container.width, container.height],
  );
  const handleNodeClick = useCallback(
    (bits: number): void => {
      // Suppress the click that ends a pan (drag), so a node only navigates on a real
      // click (see useZoomPan's movement threshold).
      if (movedRef.current) {
        return;
      }
      navigateToState(bits);
    },
    [navigateToState, movedRef],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', minHeight: 0, width: '100%', flex: 1 }}>
      <StatusLine />
      <div ref={container.ref} style={{ position: 'relative', flex: 1, minHeight: 0, width: '100%', overflow: 'hidden' }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${geometry.width} ${geometry.height}`}
          role="img"
          aria-label={`State graph for ${ballCount} balls, max throw ${graphMaxHeight}`}
          onPointerDown={zoom.onPointerDown}
          onPointerMove={zoom.onPointerMove}
          onPointerUp={zoom.onPointerUp}
          onPointerCancel={zoom.onPointerUp}
          onDoubleClick={zoom.reset}
          style={{ display: 'block', width: '100%', height: '100%', touchAction: 'none', cursor: 'grab' }}
        >
          <g transform={zoom.transform}>
            <GraphPicture
              graph={graph}
              layout={layout}
              cycle={cycle}
              geometry={geometry}
              palette={palette}
              onNodeClick={handleNodeClick}
              showThrowLabels={graphThrowLabels}
              idPrefix="sg-overlay"
            />
            <CurrentStateMarker
              layout={layout}
              geometry={geometry}
              maxHeight={graphMaxHeight}
              color={palette.amber}
              glowFilterId="sg-overlay-softglow"
            />
          </g>
        </svg>
        <GraphOverlayCluster onResetView={zoom.reset} showReset={zoom.transformed} />
      </div>
      <p style={{ ...statusStyle(palette), fontSize: '0.72rem', textAlign: 'center' }}>
        {graph.nodes.length} states (b = {ballCount}, N = {graphMaxHeight}
        {graph.nodes.length <= STRESS_MAX_NODES
          ? '), symmetric layout (ground at the top'
          : ') in excitation rings (ground at centre'}
        ). Click a state to transition to it. Scroll or pinch to zoom, drag to pan, double-tap to reset.
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
        // The minimap keeps a fixed SQUARE box (per-axis fill within it), no labels.
        const geometry = geometryOf(layout, VIEW_SIZE, VIEW_SIZE, false);
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
              decorated={false}
              idPrefix="sg-minimap"
            />
            <CurrentStateMarker
              layout={layout}
              geometry={geometry}
              maxHeight={graphMaxHeight}
              color={palette.amber}
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
      <span aria-hidden style={minimapExpandLabelStyle(palette)}>
        click to expand
      </span>
    </button>
  );
}

/**
 * The state-graph scene affordances (DESIGN.md §5, §6):
 *   • a persistent top-left toggle button that opens/closes the FULL overlay;
 *   • an always-visible corner MINIMAP under it (owner 2026-07-12: the minimap is now
 *     always shown while the overlay is closed — the optional toggle was removed) that
 *     also expands the overlay on click;
 *   • the full interactive overlay (N stepper, hard reset, navigation) when
 *     `graphVisible`. When the overlay is closed its body unmounts (nothing derived
 *     or drawn beyond the cheap minimap).
 */
export function StateGraph({ mobile = false }: { readonly mobile?: boolean } = {}): ReactElement {
  const palette = usePalette();
  const graphVisible = useAppStore((state) => state.graphVisible);
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

      {/* Corner minimap, under the toggle — always shown while the overlay is closed
          (owner 2026-07-12: the optional minimap toggle was removed). Hidden on the
          mobile shell (owner round 9: the graph is "minimized completely" — the
          top-left "◎ State graph" toggle is the only affordance to open it). */}
      {!graphVisible && !mobile ? <GraphMinimap onExpand={() => setGraphVisible(true)} /> : null}

      {graphVisible ? (
        <div
          style={{
            // On mobile the overlay is FULL-SCREEN (owner round 9: expanding fills the
            // whole screen). position:fixed escapes the hero's overflow:hidden and is
            // viewport-relative because no ancestor in the mobile hero sets
            // transform/filter/perspective. Desktop keeps the in-scene absolute overlay.
            position: mobile ? 'fixed' : 'absolute',
            inset: 0,
            zIndex: mobile ? 50 : 5,
            background: palette.overlayBackdrop,
            backdropFilter: 'blur(2px)',
            display: 'flex',
            flexDirection: 'column',
            padding: mobile
              ? 'calc(2.9rem + env(safe-area-inset-top)) calc(0.8rem + env(safe-area-inset-right)) calc(0.8rem + env(safe-area-inset-bottom)) calc(0.8rem + env(safe-area-inset-left))'
              : '2.9rem 0.8rem 0.8rem',
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

/** The expanded overlay's top-left control cluster (throw labels + reset view). */
function clusterStyle(palette: Palette): CSSProperties {
  return {
    position: 'absolute',
    top: '0.4rem',
    left: '0.4rem',
    zIndex: 2,
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '0.3rem 0.6rem',
    padding: '0.3rem 0.5rem',
    borderRadius: '0.4rem',
    border: `1px solid ${palette.border}`,
    background: palette.name === 'dark' ? 'rgba(15, 23, 42, 0.6)' : 'rgba(255, 255, 255, 0.7)',
    backdropFilter: 'blur(3px)',
  };
}

/** The "Throw labels" checkbox row inside the cluster. */
function clusterToggleStyle(palette: Palette): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: '0.35rem',
    fontWeight: 600,
    fontSize: '0.75rem',
    color: palette.textPrimary,
    cursor: 'pointer',
  };
}

/** The "↺ Reset view" button inside the cluster (shown only when zoomed/panned). */
function clusterButtonStyle(palette: Palette): CSSProperties {
  return {
    padding: '0.15rem 0.45rem',
    borderRadius: '0.3rem',
    border: `1px solid ${palette.border}`,
    background: palette.panelAlt,
    color: palette.textPrimary,
    fontSize: '0.72rem',
    fontWeight: 600,
    cursor: 'pointer',
    lineHeight: 1.2,
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

/**
 * The "click to expand" hint (owner 2026-07-11, replacing the ⤢ glyph): a small,
 * muted caption pinned to the minimap's bottom edge. A faint chip behind it keeps
 * it legible over the ring graph without drawing attention; the whole card stays
 * the click target (this span is aria-hidden and pointer-transparent).
 */
function minimapExpandLabelStyle(palette: Palette): CSSProperties {
  return {
    position: 'absolute',
    bottom: '0.3rem',
    left: '50%',
    transform: 'translateX(-50%)',
    fontSize: '0.6rem',
    lineHeight: 1,
    fontWeight: 600,
    letterSpacing: '0.02em',
    whiteSpace: 'nowrap',
    color: palette.textSecondary,
    background: palette.name === 'dark' ? 'rgba(15, 23, 42, 0.55)' : 'rgba(255, 255, 255, 0.6)',
    padding: '0.12rem 0.35rem',
    borderRadius: '0.25rem',
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
