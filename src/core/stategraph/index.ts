// src/core/stategraph — the siteswap state graph (DESIGN.md §5, NOTATION.md "state").
//
// A state is the binary landing-schedule vector of length N (bit i = "a ball lands
// i beats from now"); the graph for a given (b, N) has one node per state with
// popcount = b — C(N, b) nodes. Beat advance is a right shift: the ball landing now
// (bit 0) is rethrown into any empty slot ≤ N (one edge per throw value), and a
// beat that lands nothing throws a 0 (the shift, its only edge). This is exactly
// the transition the running sim performs, so the graph agrees bit-for-bit with
// core/siteswap `stateAt` / core/timeline `landingScheduleAt` (property-tested).
//
// Pure and deterministic (CLAUDE.md hard rule 1): no cross-layer imports, no
// Date.now / Math.random / performance. States are represented internally as a
// numeric bitmask (bit i set ⇔ a ball lands i beats from now); N ≤ 11 fits well
// inside a 32-bit int. `boolean[]` states (as core/siteswap returns) convert via
// {@link stateToBits} / {@link bitsToState}.

/** Default N for the state graph (DESIGN.md §7). */
export const GRAPH_DEFAULT_N = 7;
/** Hard cap on N (DESIGN.md §5: C(N, b) explodes beyond this). */
export const GRAPH_MAX_N = 11;
/** N at or above which the UI warns (DESIGN.md §5). */
export const GRAPH_WARN_N = 9;

/** A state as a numeric bitmask: bit i set ⇔ a ball lands i beats from now. */
export type StateBits = number;

/**
 * Population count of a landing-schedule state vector; for a valid state this
 * equals the ball count b (DESIGN.md §5, NOTATION.md term "state").
 */
export function popcount(state: readonly boolean[]): number {
  return state.reduce((count, occupied) => (occupied ? count + 1 : count), 0);
}

/** Population count of a state bitmask. */
export function popcountBits(bits: StateBits): number {
  let n = bits >>> 0;
  let count = 0;
  while (n !== 0) {
    n &= n - 1;
    count++;
  }
  return count;
}

/** Pack a boolean landing-schedule vector into a bitmask (bit i = state[i]). */
export function stateToBits(state: readonly boolean[]): StateBits {
  let bits = 0;
  for (let i = 0; i < state.length; i++) {
    if (state[i]) {
      bits |= 1 << i;
    }
  }
  return bits >>> 0;
}

/** Unpack a bitmask into a length-`maxHeight` boolean landing-schedule vector. */
export function bitsToState(bits: StateBits, maxHeight: number): boolean[] {
  const state = new Array<boolean>(maxHeight).fill(false);
  for (let i = 0; i < maxHeight; i++) {
    state[i] = (bits & (1 << i)) !== 0;
  }
  return state;
}

/**
 * Compact display form of a state: bit 0 leftmost, e.g. the 3-cascade ground
 * state `[1,1,1,0,0]` → `"11100"`. Reads left-to-right as "lands now, lands in 1,
 * lands in 2, …" (the array order), matching {@link bitsToState}.
 */
export function formatState(bits: StateBits, maxHeight: number): string {
  let out = '';
  for (let i = 0; i < maxHeight; i++) {
    out += bits & (1 << i) ? '1' : '0';
  }
  return out;
}

/** The ground state for b balls: the b lowest bits set (DESIGN.md §5). */
export function groundState(ballCount: number): StateBits {
  if (ballCount <= 0) {
    return 0;
  }
  return ((1 << ballCount) - 1) >>> 0;
}

/** The largest throw value in a pattern (0 for the empty pattern). */
export function maxThrowOf(values: readonly number[]): number {
  let max = 0;
  for (const value of values) {
    if (value > max) {
      max = value;
    }
  }
  return max;
}

/**
 * Advance a state by one beat under throw value `h` (DESIGN.md §5). The result is
 * the right shift `bits >> 1` (every landing moves one beat closer; the ball
 * landing now, bit 0, is dropped) with the rethrown ball placed at slot `h − 1`.
 * Returns `null` when the throw is illegal from this state:
 *  - if a ball lands now (bit 0 set) it MUST be thrown: `h` in `[1, N]` and slot
 *    `h − 1` must be free in the shifted state (else two balls would collide);
 *  - if nothing lands now (bit 0 clear) the only legal throw is `0` (the shift).
 * popcount (= b) is preserved on every legal edge.
 */
export function advanceState(bits: StateBits, throwValue: number, maxHeight: number): StateBits | null {
  const shifted = bits >>> 1;
  const landsNow = (bits & 1) !== 0;
  if (landsNow) {
    if (throwValue < 1 || throwValue > maxHeight) {
      return null;
    }
    const slot = 1 << (throwValue - 1);
    if ((shifted & slot) !== 0) {
      return null;
    }
    return (shifted | slot) >>> 0;
  }
  // Nothing lands now: the only legal throw is a 0 (the bare shift).
  if (throwValue !== 0) {
    return null;
  }
  return shifted >>> 0;
}

/** One directed graph edge: throw `throwValue` from a state leads to `to`. */
export interface StateGraphEdge {
  readonly throwValue: number;
  readonly to: StateBits;
}

/**
 * The legal throws out of a state, ascending in throw value (DESIGN.md §5). A
 * state that lands a ball now offers one edge per empty slot ≤ N (throw values
 * `1..N`); a state that lands nothing offers the single `0` edge. Ascending order
 * makes downstream BFS tie-breaks (lexicographically smallest throw sequence)
 * deterministic.
 */
export function edgesFrom(bits: StateBits, maxHeight: number): StateGraphEdge[] {
  const shifted = bits >>> 1;
  const edges: StateGraphEdge[] = [];
  if ((bits & 1) !== 0) {
    for (let h = 1; h <= maxHeight; h++) {
      const slot = 1 << (h - 1);
      if ((shifted & slot) === 0) {
        edges.push({ throwValue: h, to: (shifted | slot) >>> 0 });
      }
    }
  } else {
    edges.push({ throwValue: 0, to: shifted >>> 0 });
  }
  return edges;
}

/** The fully-generated state graph for a `(ballCount, maxHeight)` pair. */
export interface StateGraph {
  /** b, the ball count (popcount of every node). */
  readonly ballCount: number;
  /** N, the maximum throw value the graph represents. */
  readonly maxHeight: number;
  /** All C(N, b) state nodes, ascending by bitmask. */
  readonly nodes: readonly StateBits[];
  /** The ground state (b lowest bits set). */
  readonly ground: StateBits;
  /** Whether a bitmask is a node of this graph (popcount b, fits N). */
  has(bits: StateBits): boolean;
  /** Outgoing edges of a node, ascending in throw value. */
  edgesFrom(bits: StateBits): readonly StateGraphEdge[];
  /** Excitation level = BFS distance from the ground state (DESIGN.md §5). */
  level(bits: StateBits): number;
  /** The largest excitation level present. */
  readonly maxLevel: number;
}

/** All N-bit bitmasks with exactly `ballCount` bits set, ascending. */
function statesWithPopcount(ballCount: number, maxHeight: number): StateBits[] {
  const nodes: StateBits[] = [];
  const total = 1 << maxHeight;
  for (let bits = 0; bits < total; bits++) {
    if (popcountBits(bits) === ballCount) {
      nodes.push(bits);
    }
  }
  return nodes;
}

/**
 * Build the state graph for `(ballCount, maxHeight)` (DESIGN.md §5). Enumerates the
 * C(N, b) nodes, precomputes each node's outgoing edges (for navigation) and
 * incoming edges (for reverse BFS), and assigns every node an excitation level =
 * BFS distance from the ground state. The siteswap state graph is strongly
 * connected for `0 < b < N`, so every node gets a finite level; any node the BFS
 * cannot reach (degenerate `b = 0` / `b = N`) is placed one level past the rest so
 * the layout still has a home for it.
 */
export function buildStateGraph(ballCount: number, maxHeight: number): StateGraph {
  const nodes = statesWithPopcount(ballCount, maxHeight);
  const nodeSet = new Set<StateBits>(nodes);
  const forward = new Map<StateBits, StateGraphEdge[]>();
  const reverse = new Map<StateBits, StateBits[]>();
  for (const node of nodes) {
    const edges = edgesFrom(node, maxHeight);
    forward.set(node, edges);
    for (const edge of edges) {
      const preds = reverse.get(edge.to);
      if (preds === undefined) {
        reverse.set(edge.to, [node]);
      } else {
        preds.push(node);
      }
    }
  }

  const ground = groundState(ballCount);
  // Excitation level: forward BFS from the ground state.
  const level = new Map<StateBits, number>();
  let maxReached = 0;
  if (nodeSet.has(ground)) {
    level.set(ground, 0);
    let frontier: StateBits[] = [ground];
    let depth = 0;
    while (frontier.length > 0) {
      const next: StateBits[] = [];
      for (const node of frontier) {
        for (const edge of forward.get(node) ?? []) {
          if (!level.has(edge.to) && nodeSet.has(edge.to)) {
            level.set(edge.to, depth + 1);
            next.push(edge.to);
          }
        }
      }
      if (next.length > 0) {
        maxReached = depth + 1;
      }
      frontier = next;
      depth++;
    }
  }
  // Any unreached node (degenerate graphs only) lands one column past the rest.
  const orphanLevel = maxReached + 1;
  let maxLevel = maxReached;
  for (const node of nodes) {
    if (!level.has(node)) {
      level.set(node, orphanLevel);
      maxLevel = orphanLevel;
    }
  }

  const graph: StateGraph = {
    ballCount,
    maxHeight,
    nodes,
    ground,
    maxLevel,
    has: (bits) => nodeSet.has(bits >>> 0),
    edgesFrom: (bits) => forward.get(bits >>> 0) ?? [],
    level: (bits) => level.get(bits >>> 0) ?? 0,
  };
  // Cache the reverse adjacency (an internal BFS accelerator, kept off the public
  // interface) keyed by the graph object.
  reverseCache.set(graph, reverse);
  return graph;
}

/** Reverse adjacency (predecessors) per built graph, for reverse-BFS navigation. */
const reverseCache = new WeakMap<StateGraph, Map<StateBits, StateBits[]>>();

/** The reverse adjacency of a graph, from the cache or derived once on demand. */
function reverseAdjacencyOf(graph: StateGraph): Map<StateBits, StateBits[]> {
  const cached = reverseCache.get(graph);
  if (cached) {
    return cached;
  }
  const reverse = new Map<StateBits, StateBits[]>();
  for (const node of graph.nodes) {
    for (const edge of graph.edgesFrom(node)) {
      const preds = reverse.get(edge.to);
      if (preds === undefined) {
        reverse.set(edge.to, [node]);
      } else {
        preds.push(node);
      }
    }
  }
  reverseCache.set(graph, reverse);
  return reverse;
}

/**
 * Reverse-BFS distances to a set of target states: `dist(node)` = the fewest beats
 * to reach any target from `node` (following forward edges). Computed over the
 * reverse adjacency so one sweep covers every source at once.
 */
function distancesToTargets(
  graph: StateGraph,
  targets: Iterable<StateBits>,
): Map<StateBits, number> {
  const reverse = reverseAdjacencyOf(graph);
  const dist = new Map<StateBits, number>();
  let frontier: StateBits[] = [];
  for (const target of targets) {
    const t = target >>> 0;
    if (graph.has(t) && !dist.has(t)) {
      dist.set(t, 0);
      frontier.push(t);
    }
  }
  while (frontier.length > 0) {
    const next: StateBits[] = [];
    for (const node of frontier) {
      const d = dist.get(node) as number;
      for (const pred of reverse.get(node) ?? []) {
        if (!dist.has(pred)) {
          dist.set(pred, d + 1);
          next.push(pred);
        }
      }
    }
    frontier = next;
  }
  return dist;
}

/**
 * Walk from `from` to a state where `dist` is 0, always taking the smallest-valued
 * edge that stays on a shortest path (`dist` decreasing by exactly 1). This yields
 * the lexicographically smallest shortest throw sequence. `dist` must be finite at
 * `from`.
 */
function lexMinDescent(
  graph: StateGraph,
  from: StateBits,
  dist: Map<StateBits, number>,
): { throws: number[]; to: StateBits } {
  const throws: number[] = [];
  let current = from >>> 0;
  let guard = 0;
  const limit = graph.nodes.length + 1;
  while ((dist.get(current) ?? 0) > 0) {
    const target = (dist.get(current) as number) - 1;
    let chosen: StateGraphEdge | null = null;
    for (const edge of graph.edgesFrom(current)) {
      if (dist.get(edge.to) === target) {
        chosen = edge;
        break;
      }
    }
    if (chosen === null) {
      throw new Error(`stategraph: no descending edge from state ${current} (broken distance map)`);
    }
    throws.push(chosen.throwValue);
    current = chosen.to;
    if (++guard > limit) {
      throw new Error('stategraph: lexMinDescent exceeded the node count (cycle in a shortest path)');
    }
  }
  return { throws, to: current };
}

/** The shortest, lexicographically smallest throw sequence from one state to a set. */
export interface TransitionPlan {
  /** The bridge throw values (empty when `from` is already on the target set). */
  readonly throws: number[];
  /** The target-set state the bridge lands on. */
  readonly to: StateBits;
}

/**
 * Plan a transition (DESIGN.md §5): the shortest throw sequence from `from` to the
 * nearest state in `targets`, ties broken by the lexicographically smallest throw
 * sequence (deterministic — a required property test). Returns an empty bridge
 * when `from` is already in `targets`. Throws when no target is reachable (which
 * cannot happen within one strongly-connected `(b, N)` graph — it signals a bug).
 */
export function planTransition(
  graph: StateGraph,
  from: StateBits,
  targets: Iterable<StateBits>,
): TransitionPlan {
  const targetSet = new Set<StateBits>();
  for (const t of targets) {
    targetSet.add(t >>> 0);
  }
  const source = from >>> 0;
  if (targetSet.has(source)) {
    return { throws: [], to: source };
  }
  const dist = distancesToTargets(graph, targetSet);
  if (!dist.has(source)) {
    throw new Error(
      `stategraph: no path from state ${source} to the target set (unreachable — graph bug)`,
    );
  }
  return lexMinDescent(graph, source, dist);
}

/**
 * The shortest cycle through a state (DESIGN.md §5: "hold the shortest cycle
 * through that state"), returned as its throw sequence STARTING at `state`. Ties
 * broken lexicographically. The state must have at least one outgoing edge whose
 * target can return to it (always true in a strongly-connected graph). This throw
 * sequence, run from `state`, is a valid periodic pattern that visits `state`.
 */
export function shortestCycle(graph: StateGraph, state: StateBits): number[] {
  const source = state >>> 0;
  // Distances from every node back to `source` (reverse-BFS from {source}).
  const dist = distancesToTargets(graph, [source]);
  // The best first edge: minimize the resulting cycle length (1 + dist(to)),
  // ties broken by the smallest throw value (edges are ascending, so the first
  // achieving the minimum wins).
  let best: StateGraphEdge | null = null;
  let bestLength = Infinity;
  for (const edge of graph.edgesFrom(source)) {
    const d = dist.get(edge.to);
    if (d === undefined) {
      continue;
    }
    const cycleLength = 1 + d;
    if (cycleLength < bestLength) {
      bestLength = cycleLength;
      best = edge;
    }
  }
  if (best === null) {
    throw new Error(`stategraph: state ${source} lies on no cycle (graph bug)`);
  }
  // First throw, then the lex-min descent back to `source`.
  const tail = lexMinDescent(graph, best.to, dist);
  return [best.throwValue, ...tail.throws];
}

/** A pattern's cycle in the state graph: its nodes and the edges between them. */
export interface PatternCycle {
  /** Distinct states the pattern visits, in first-visit order over one period. */
  readonly nodes: StateBits[];
  /** The directed edges the pattern traverses (state_k → state_{k+1}). */
  readonly edges: { readonly from: StateBits; readonly throwValue: number; readonly to: StateBits }[];
  /** Set membership test for the cycle's nodes. */
  readonly nodeSet: Set<StateBits>;
  /**
   * The beat phase (index into `values`) at which each cycle node is first
   * visited — used to re-enter the pattern at the right point after a transition.
   */
  readonly phaseOf: Map<StateBits, number>;
}

/**
 * The cycle a valid pattern traces in the `(b, N)` graph (DESIGN.md §5): the
 * states `stateAt(values, k)` over one period and the throw edges between them.
 * `maxHeight` must be at least the pattern's largest throw. Every valid pattern's
 * cycle exists in its graph and closes (a property test). States are computed here
 * directly (agreeing with core/siteswap `stateAt`) so the module is self-contained.
 */
export function patternCycle(values: readonly number[], maxHeight: number): PatternCycle {
  const nodes: StateBits[] = [];
  const nodeSet = new Set<StateBits>();
  const phaseOf = new Map<StateBits, number>();
  const edges: { from: StateBits; throwValue: number; to: StateBits }[] = [];
  const length = values.length;
  if (length === 0) {
    return { nodes, edges, nodeSet, phaseOf };
  }
  const states: StateBits[] = [];
  for (let beat = 0; beat < length; beat++) {
    states.push(stateAtBits(values, beat, maxHeight));
  }
  for (let k = 0; k < length; k++) {
    const from = states[k] as StateBits;
    const to = states[(k + 1) % length] as StateBits;
    if (!nodeSet.has(from)) {
      nodeSet.add(from);
      nodes.push(from);
      phaseOf.set(from, k);
    }
    edges.push({ from, throwValue: values[k] as number, to });
  }
  return { nodes, edges, nodeSet, phaseOf };
}

/**
 * The state bitmask at `beat` for a pattern (DESIGN.md §5, NOTATION.md "state").
 * Mirrors core/siteswap `stateAt` (bit i set ⇔ a ball lands at `beat + i` from a
 * throw already made) but returns the packed bitmask directly. Property-tested for
 * exact agreement with core/siteswap so the two never drift.
 */
export function stateAtBits(values: readonly number[], beat: number, maxHeight: number): StateBits {
  const length = values.length;
  if (length === 0) {
    return 0;
  }
  let max = 0;
  for (const value of values) {
    if (value > max) {
      max = value;
    }
  }
  let bits = 0;
  for (let offset = 0; offset < maxHeight; offset++) {
    for (let d = offset + 1; d <= max; d++) {
      const source = (((beat + offset - d) % length) + length) % length;
      if ((values[source] as number) === d) {
        bits |= 1 << offset;
        break;
      }
    }
  }
  return bits >>> 0;
}

// --- Layout (concentric excitation rings, deterministic ordering) ------------

const TAU = Math.PI * 2;

/** One laid-out node: its excitation ring and normalized coordinates. */
export interface GraphLayoutNode {
  readonly bits: StateBits;
  readonly level: number;
  /** 0-based angular slot within the node's ring (barycenter order). */
  readonly indexInLevel: number;
  /** Normalized x in [0, 1]; 0.5 is the disc center, where the ground state sits. */
  readonly x: number;
  /** Normalized y in [0, 1]; 0.5 is the disc center. */
  readonly y: number;
  /** Ring angle in radians (outward direction for label anchoring; −π/2 = up). */
  readonly angle: number;
  /** Normalized ring radius in [0, 0.5]; 0 = the ground state at the center. */
  readonly radius: number;
  /** Compact label (bit 0 leftmost). */
  readonly label: string;
}

/** The deterministic concentric-ring layout of a graph (DESIGN.md §5). */
export interface GraphLayout {
  readonly nodes: readonly GraphLayoutNode[];
  /** Number of excitation levels (rings, counting the center). */
  readonly levelCount: number;
  /** The most nodes in any single ring. */
  readonly maxNodesPerLevel: number;
  /** Normalized coordinates keyed by state, for marker / edge placement. */
  readonly coordOf: Map<StateBits, { readonly x: number; readonly y: number }>;
}

/** Tunables for {@link layoutStateGraph}; the defaults suit the (b, N) range. */
export interface GraphLayoutOptions {
  /** Arc length reserved per node on a ring, in pre-normalization radius units. */
  readonly gapMin?: number;
  /** Minimum radial step between consecutive rings, pre-normalization. */
  readonly radialStep?: number;
  /** Barycenter sweep count (fixed, so the layout is deterministic). */
  readonly sweeps?: number;
}

/** Wrap an angle into [−π, π) — a canonical sort key for ring ordering. */
function wrapAngle(angle: number): number {
  return ((((angle + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
}

/**
 * Circular mean of a set of angles, or `null` when the unit vectors cancel (the
 * mean is undefined). Closed form (atan2 of the vector sum) — deterministic.
 */
function circularMean(angles: readonly number[]): number | null {
  let x = 0;
  let y = 0;
  for (const a of angles) {
    x += Math.cos(a);
    y += Math.sin(a);
  }
  if (Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9) {
    return null;
  }
  return Math.atan2(y, x);
}

/** Undirected adjacency (self-loops dropped), for angular barycenter ordering. */
function undirectedAdjacency(graph: StateGraph): Map<StateBits, Set<StateBits>> {
  const adjacency = new Map<StateBits, Set<StateBits>>();
  for (const node of graph.nodes) {
    adjacency.set(node, new Set());
  }
  for (const node of graph.nodes) {
    for (const edge of graph.edgesFrom(node)) {
      if (edge.to === node) {
        continue;
      }
      const mine = adjacency.get(node);
      const theirs = adjacency.get(edge.to);
      if (mine === undefined || theirs === undefined) {
        continue;
      }
      mine.add(edge.to);
      theirs.add(node);
    }
  }
  return adjacency;
}

/**
 * Lay the graph out as concentric rings by excitation level (DESIGN.md §5): the
 * ground state at the disc center (0.5, 0.5), one ring per BFS level, radius
 * growing with excitation. Ring radii are circumference-aware — each ring is
 * pushed out by at least `radialStep`, or further when its population needs the
 * arc length (`count · gapMin` of circumference) — then normalized so the outer
 * ring sits at radius 0.5 of the [0, 1] box. Angular order within a ring seeds
 * from ascending bitmask and is refined by a fixed number of barycenter sweeps
 * (sort by the circular mean of neighbor angles, ties broken by bitmask); each
 * ring's rotation offset is the closed-form circular-mean alignment against the
 * rings already placed. Fully deterministic (no randomness, no iteration-order
 * dependence), a pure function of `(graph, options)` — a stable layout across
 * renders. Not force-directed.
 */
export function layoutStateGraph(graph: StateGraph, options?: GraphLayoutOptions): GraphLayout {
  const gapMin = options?.gapMin ?? 0.06;
  const radialStep = options?.radialStep ?? 0.16;
  const sweeps = options?.sweeps ?? 8;

  const byLevel = new Map<number, StateBits[]>();
  for (const node of graph.nodes) {
    const lvl = graph.level(node);
    const bucket = byLevel.get(lvl);
    if (bucket === undefined) {
      byLevel.set(lvl, [node]);
    } else {
      bucket.push(node);
    }
  }
  const levels = [...byLevel.keys()].sort((a, b) => a - b);

  // Ring radii (circumference-aware), normalized so the outer ring is 0.5.
  const rawRadiusOf = new Map<number, number>();
  let previousRaw = 0;
  for (let i = 0; i < levels.length; i++) {
    const lvl = levels[i] as number;
    const count = (byLevel.get(lvl) as StateBits[]).length;
    const needed = (count * gapMin) / TAU;
    const raw = i === 0 ? (count > 1 ? needed : 0) : Math.max(previousRaw + radialStep, needed);
    rawRadiusOf.set(lvl, raw);
    previousRaw = raw;
  }
  const maxRaw = previousRaw;
  const radiusOf = new Map<number, number>();
  for (const lvl of levels) {
    const raw = rawRadiusOf.get(lvl) as number;
    radiusOf.set(lvl, maxRaw > 0 ? (0.5 * raw) / maxRaw : 0);
  }

  // Angular order: seed ascending by bitmask, refine with barycenter sweeps.
  const adjacency = undirectedAdjacency(graph);
  const order = new Map<number, StateBits[]>();
  for (const lvl of levels) {
    order.set(lvl, (byLevel.get(lvl) as StateBits[]).slice().sort((a, b) => a - b));
  }
  const angleOf = new Map<StateBits, number>();

  // Assign angles ring by ring (inner → outer): slot i of a k-ring sits at
  // offset + τ·i/k, where the ring's rotation offset is the circular mean of
  // (placed neighbor angle − slot angle) — aligning the ring against the rings
  // already placed. A ring with no placed neighbor starts at the top (−π/2);
  // a single center node is pinned there (its angle only anchors its label).
  const assignAngles = (): void => {
    for (const lvl of levels) {
      const ring = order.get(lvl) as StateBits[];
      const count = ring.length;
      if (lvl === levels[0] && count === 1) {
        angleOf.set(ring[0] as StateBits, -Math.PI / 2);
        continue;
      }
      const diffs: number[] = [];
      for (let i = 0; i < count; i++) {
        const slotAngle = (TAU * i) / count;
        for (const neighbor of adjacency.get(ring[i] as StateBits) ?? []) {
          const neighborAngle = angleOf.get(neighbor);
          if (neighborAngle !== undefined) {
            diffs.push(neighborAngle - slotAngle);
          }
        }
      }
      const offset = diffs.length > 0 ? (circularMean(diffs) ?? -Math.PI / 2) : -Math.PI / 2;
      for (let i = 0; i < count; i++) {
        angleOf.set(ring[i] as StateBits, offset + (TAU * i) / count);
      }
    }
  };
  assignAngles();
  for (let pass = 0; pass < sweeps; pass++) {
    const direction = pass % 2 === 0 ? levels : [...levels].reverse();
    for (const lvl of direction) {
      const ring = order.get(lvl) as StateBits[];
      if (ring.length <= 1) {
        continue;
      }
      const keyed = ring.map((bits) => {
        const neighborAngles: number[] = [];
        for (const neighbor of adjacency.get(bits) ?? []) {
          const neighborAngle = angleOf.get(neighbor);
          if (neighborAngle !== undefined) {
            neighborAngles.push(neighborAngle);
          }
        }
        const mean = circularMean(neighborAngles);
        return { bits, key: mean ?? wrapAngle(angleOf.get(bits) ?? 0) };
      });
      keyed.sort((p, q) => p.key - q.key || p.bits - q.bits);
      order.set(
        lvl,
        keyed.map((k) => k.bits),
      );
      assignAngles();
    }
  }

  // Emit normalized coordinates (disc center 0.5, 0.5; radius ≤ 0.5).
  let maxNodesPerLevel = 0;
  const nodes: GraphLayoutNode[] = [];
  const coordOf = new Map<StateBits, { x: number; y: number }>();
  for (const lvl of levels) {
    const ring = order.get(lvl) as StateBits[];
    maxNodesPerLevel = Math.max(maxNodesPerLevel, ring.length);
    const radius = radiusOf.get(lvl) as number;
    for (let i = 0; i < ring.length; i++) {
      const bits = ring[i] as StateBits;
      const angle = angleOf.get(bits) as number;
      const x = 0.5 + radius * Math.cos(angle);
      const y = 0.5 + radius * Math.sin(angle);
      nodes.push({
        bits,
        level: lvl,
        indexInLevel: i,
        x,
        y,
        angle,
        radius,
        label: formatState(bits, graph.maxHeight),
      });
      coordOf.set(bits, { x, y });
    }
  }
  return { nodes, levelCount: levels.length, maxNodesPerLevel, coordOf };
}
