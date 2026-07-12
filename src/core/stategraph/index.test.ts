import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { stateAt, validatePattern } from '../siteswap';
import {
  advanceState,
  bitsToState,
  buildStateGraph,
  edgesFrom,
  formatState,
  groundState,
  layoutStateGraph,
  maxThrowOf,
  patternCycle,
  planTransition,
  popcount,
  popcountBits,
  shortestCycle,
  stateAtBits,
  stateToBits,
  STRESS_MAX_NODES,
  type GraphLayout,
  type StateBits,
  type StateGraph,
} from './index';

// --- Placeholder carried forward -------------------------------------------

describe('core/stategraph popcount', () => {
  it('counts occupied landing slots (= ball count b)', () => {
    expect(popcount([true, false, true])).toBe(2);
    expect(popcount([true, true, true])).toBe(3);
    expect(popcount([])).toBe(0);
  });

  it('popcountBits matches the boolean popcount', () => {
    expect(popcountBits(0b10101)).toBe(3);
    expect(popcountBits(0)).toBe(0);
    expect(popcountBits(0b11111111111)).toBe(11);
  });
});

// --- State <-> bits round trips --------------------------------------------

describe('state bitmask helpers', () => {
  it('packs and unpacks a state vector (bit 0 = lands now)', () => {
    const state = [true, true, true, false, false];
    const bits = stateToBits(state);
    expect(bits).toBe(0b00111);
    expect(bitsToState(bits, 5)).toEqual(state);
  });

  it('formats a state bit-0-leftmost', () => {
    expect(formatState(0b00111, 5)).toBe('11100');
    expect(formatState(0b10101, 5)).toBe('10101');
  });

  it('groundState sets the b lowest bits', () => {
    expect(groundState(3)).toBe(0b111);
    expect(groundState(0)).toBe(0);
    expect(bitsToState(groundState(3), 5)).toEqual([true, true, true, false, false]);
  });

  it('maxThrowOf finds the largest throw', () => {
    expect(maxThrowOf([5, 3, 1])).toBe(5);
    expect(maxThrowOf([])).toBe(0);
  });
});

// --- advanceState / edgesFrom ----------------------------------------------

describe('advanceState', () => {
  const N = 5;
  it('a cascade ground state self-loops on throw b', () => {
    // b=3 ground 11100: throw 3 returns to ground.
    expect(advanceState(groundState(3), 3, N)).toBe(groundState(3));
  });

  it('rejects a throw onto an occupied slot', () => {
    // Ground 11100: shifted 0110-ish; throw 1 (slot 0) and 2 (slot 1) collide.
    expect(advanceState(groundState(3), 1, N)).toBeNull();
    expect(advanceState(groundState(3), 2, N)).toBeNull();
  });

  it('requires a 0 throw when nothing lands now, rejects a real throw', () => {
    const noLandNow = 0b01100; // bit0 clear
    expect(advanceState(noLandNow, 0, N)).toBe(0b00110);
    expect(advanceState(noLandNow, 3, N)).toBeNull();
  });

  it('rejects a 0 throw when a ball lands now', () => {
    expect(advanceState(groundState(3), 0, N)).toBeNull();
  });

  it('rejects throws beyond N', () => {
    expect(advanceState(groundState(3), 6, N)).toBeNull();
  });

  it('preserves popcount on every legal edge', () => {
    for (const edge of edgesFrom(0b10101, N)) {
      expect(popcountBits(edge.to)).toBe(popcountBits(0b10101));
    }
  });
});

describe('edgesFrom', () => {
  it('offers one 0-edge when nothing lands now', () => {
    const edges = edgesFrom(0b01100, 5);
    expect(edges).toEqual([{ throwValue: 0, to: 0b00110 }]);
  });

  it('offers N-b+1 edges (ascending) when a ball lands now', () => {
    // b=3, N=5: out-degree N-b+1 = 3 (throws 3,4,5 from ground).
    const edges = edgesFrom(groundState(3), 5);
    expect(edges.map((e) => e.throwValue)).toEqual([3, 4, 5]);
  });
});

// --- Graph generation -------------------------------------------------------

function binomial(n: number, k: number): number {
  if (k < 0 || k > n) {
    return 0;
  }
  let result = 1;
  for (let i = 0; i < k; i++) {
    result = (result * (n - i)) / (i + 1);
  }
  return Math.round(result);
}

describe('buildStateGraph', () => {
  it('has C(N, b) nodes, all of popcount b', () => {
    for (const [b, n] of [
      [3, 5],
      [2, 5],
      [3, 7],
      [5, 11],
    ] as const) {
      const graph = buildStateGraph(b, n);
      expect(graph.nodes).toHaveLength(binomial(n, b));
      for (const node of graph.nodes) {
        expect(popcountBits(node)).toBe(b);
      }
    }
  });

  it('places the ground state at excitation level 0', () => {
    const graph = buildStateGraph(3, 7);
    expect(graph.level(graph.ground)).toBe(0);
    expect(graph.maxLevel).toBeGreaterThan(0);
  });

  it('reaches every node from the ground state (strongly connected)', () => {
    const graph = buildStateGraph(3, 6);
    for (const node of graph.nodes) {
      expect(graph.level(node)).toBeLessThanOrEqual(graph.maxLevel);
    }
  });
});

// --- stateAtBits agrees with core/siteswap stateAt --------------------------

const permutationFromKeys = (keys: number[]): number[] =>
  keys
    .map((key, index) => ({ key, index }))
    .sort((a, b) => a.key - b.key || a.index - b.index)
    .map((entry) => entry.index);

/** Arbitrary valid siteswap value array (collision-free, integer average). */
const validPatternArb = fc.integer({ min: 1, max: 6 }).chain((length) =>
  fc
    .record({
      keys: fc.array(fc.nat(), { minLength: length, maxLength: length }),
      extra: fc.array(fc.integer({ min: 0, max: 2 }), { minLength: length, maxLength: length }),
    })
    .map(({ keys, extra }) => {
      const permutation = permutationFromKeys(keys);
      return permutation.map((target, index) => {
        const base = (((target - index) % length) + length) % length;
        return base + length * (extra[index] as number);
      });
    }),
);

describe('property: stateAtBits == core/siteswap stateAt', () => {
  it('agrees for every beat of random valid patterns', () => {
    fc.assert(
      fc.property(validPatternArb, (values) => {
        const maxHeight = maxThrowOf(values) + 2;
        for (let beat = 0; beat < values.length + 3; beat++) {
          expect(stateAtBits(values, beat, maxHeight)).toBe(
            stateToBits(stateAt(values, beat, maxHeight)),
          );
        }
      }),
    );
  });
});

// --- Required property 1: every valid pattern's cycle exists and closes -----

describe('property: a valid pattern cycle exists in its graph and closes', () => {
  it('every cycle node is a graph node, edges are legal, and it returns to start', () => {
    fc.assert(
      fc.property(validPatternArb, (values) => {
        const result = validatePattern(values);
        if (!result.ok) {
          throw new Error('generated an invalid pattern');
        }
        const b = result.ballCount;
        const n = Math.max(maxThrowOf(values), b, 3);
        if (n > 11) {
          return; // outside the graph's representable range (documented path)
        }
        const graph = buildStateGraph(b, n);
        const cycle = patternCycle(values, n);
        // Every node exists in the graph and has popcount b.
        for (const node of cycle.nodes) {
          expect(graph.has(node)).toBe(true);
          expect(popcountBits(node)).toBe(b);
        }
        // Every edge is a legal advance in the graph.
        for (const edge of cycle.edges) {
          expect(advanceState(edge.from, edge.throwValue, n)).toBe(edge.to);
        }
        // The cycle closes: applying the L throws from state 0 returns to state 0.
        let current = stateAtBits(values, 0, n);
        const start = current;
        for (let k = 0; k < values.length; k++) {
          const next = advanceState(current, values[k] as number, n);
          expect(next).not.toBeNull();
          current = next as StateBits;
        }
        expect(current).toBe(start);
      }),
    );
  });
});

// --- Required property 2: BFS transitions are valid throw sequences ---------

describe('property: BFS transition lands exactly on the target cycle', () => {
  it('applying the bridge from any reachable state reaches the target cycle', () => {
    fc.assert(
      fc.property(
        validPatternArb,
        fc.nat(),
        (targetValues, sourcePick) => {
          const result = validatePattern(targetValues);
          if (!result.ok) {
            throw new Error('invalid target');
          }
          const b = result.ballCount;
          const n = Math.max(maxThrowOf(targetValues), b, 3);
          if (n > 8 || b === 0) {
            return; // keep the graph small; b=0 is degenerate
          }
          const graph = buildStateGraph(b, n);
          const cycle = patternCycle(targetValues, n);
          // Pick an arbitrary source state from the graph.
          const source = graph.nodes[sourcePick % graph.nodes.length] as StateBits;
          const plan = planTransition(graph, source, cycle.nodeSet);
          // Applying the bridge, beat by beat, is a legal walk that ends on the
          // target cycle (the core/siteswap advance is the oracle).
          let current = source;
          for (const throwValue of plan.throws) {
            const next = advanceState(current, throwValue, n);
            expect(next, `illegal throw ${throwValue} from ${current}`).not.toBeNull();
            current = next as StateBits;
          }
          expect(current).toBe(plan.to);
          expect(cycle.nodeSet.has(current)).toBe(true);
        },
      ),
    );
  });
});

// --- Required property 3: tie-break determinism + lexicographic minimality --

/** Independent forward-BFS distance from a source over legal edges. */
function forwardDistances(graph: StateGraph, source: StateBits): Map<StateBits, number> {
  const dist = new Map<StateBits, number>([[source, 0]]);
  let frontier: StateBits[] = [source];
  while (frontier.length > 0) {
    const next: StateBits[] = [];
    for (const node of frontier) {
      const d = dist.get(node) as number;
      for (const edge of graph.edgesFrom(node)) {
        if (!dist.has(edge.to)) {
          dist.set(edge.to, d + 1);
          next.push(edge.to);
        }
      }
    }
    frontier = next;
  }
  return dist;
}

/** Independent reverse-BFS distance to a target set (for DFS pruning). */
function reverseDistances(graph: StateGraph, targets: Set<StateBits>): Map<StateBits, number> {
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
  const dist = new Map<StateBits, number>();
  let frontier: StateBits[] = [];
  for (const t of targets) {
    dist.set(t, 0);
    frontier.push(t);
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

/** Brute force: the lexicographically-smallest shortest throw sequence source→targets. */
function bruteLexMinTransition(
  graph: StateGraph,
  source: StateBits,
  targets: Set<StateBits>,
): number[] | null {
  if (targets.has(source)) {
    return [];
  }
  const forward = forwardDistances(graph, source);
  let shortest = Infinity;
  for (const t of targets) {
    const d = forward.get(t);
    if (d !== undefined) {
      shortest = Math.min(shortest, d);
    }
  }
  if (!Number.isFinite(shortest)) {
    return null;
  }
  const toTarget = reverseDistances(graph, targets);
  // DFS exploring edges ascending; the first length-`shortest` walk that ends on a
  // target (with pruning so every partial walk can still reach one) is lex-min.
  let found: number[] | null = null;
  const dfs = (node: StateBits, depth: number, acc: number[]): void => {
    if (found) {
      return;
    }
    if (depth === shortest) {
      if (targets.has(node)) {
        found = [...acc];
      }
      return;
    }
    for (const edge of graph.edgesFrom(node)) {
      const remaining = shortest - depth - 1;
      const dt = toTarget.get(edge.to);
      if (dt === undefined || dt > remaining) {
        continue; // cannot reach a target in the beats left — prune
      }
      acc.push(edge.throwValue);
      dfs(edge.to, depth + 1, acc);
      acc.pop();
      if (found) {
        return;
      }
    }
  };
  dfs(source, 0, []);
  return found;
}

describe('property: transition tie-break is deterministic and lexicographically minimal', () => {
  it('planTransition equals the brute-force lex-min shortest sequence and is stable', () => {
    const smallGraphArb = fc
      .record({ b: fc.integer({ min: 1, max: 3 }), extra: fc.integer({ min: 1, max: 2 }) })
      .map(({ b, extra }) => ({ b, n: Math.min(5, b + extra) }));
    fc.assert(
      fc.property(
        smallGraphArb,
        fc.nat(),
        fc.array(fc.nat(), { minLength: 1, maxLength: 3 }),
        ({ b, n }, sourcePick, targetPicks) => {
          const graph = buildStateGraph(b, n);
          if (graph.nodes.length === 0) {
            return;
          }
          const source = graph.nodes[sourcePick % graph.nodes.length] as StateBits;
          const targets = new Set<StateBits>(
            targetPicks.map((p) => graph.nodes[p % graph.nodes.length] as StateBits),
          );
          const plan = planTransition(graph, source, targets);
          // Deterministic: a second identical call gives the identical sequence.
          const plan2 = planTransition(graph, source, targets);
          expect(plan2.throws).toEqual(plan.throws);
          // Matches the independent brute-force lexicographically-minimal shortest.
          const brute = bruteLexMinTransition(graph, source, targets);
          expect(brute).not.toBeNull();
          expect(plan.throws).toEqual(brute);
        },
      ),
    );
  });
});

// --- shortestCycle ----------------------------------------------------------

describe('shortestCycle', () => {
  it('the ground state holds the plain cascade (throw b)', () => {
    const graph = buildStateGraph(3, 7);
    expect(shortestCycle(graph, graph.ground)).toEqual([3]);
    const graph2 = buildStateGraph(5, 7);
    expect(shortestCycle(graph2, graph2.ground)).toEqual([5]);
  });

  it('a 51-cycle node holds a rotation of 51 (a valid 3-ball pattern)', () => {
    const graph = buildStateGraph(3, 5);
    const node = stateAtBits([5, 1], 1, 5); // the excited 51 state
    const cycle = shortestCycle(graph, node);
    // The cycle is length 2 and, run from `node`, returns to `node`.
    expect(cycle).toHaveLength(2);
    let current = node;
    for (const h of cycle) {
      current = advanceState(current, h, 5) as StateBits;
    }
    expect(current).toBe(node);
    // Its throws are a rotation of {5,1} and it is a valid siteswap.
    expect([...cycle].sort()).toEqual([1, 5]);
    expect(validatePattern(cycle).ok).toBe(true);
  });

  it('property: shortestCycle run from the state returns to it and is a valid pattern', () => {
    const smallGraphArb = fc
      .record({ b: fc.integer({ min: 1, max: 3 }), extra: fc.integer({ min: 1, max: 3 }) })
      .map(({ b, extra }) => ({ b, n: Math.min(6, b + extra) }));
    fc.assert(
      fc.property(smallGraphArb, fc.nat(), ({ b, n }, pick) => {
        const graph = buildStateGraph(b, n);
        const state = graph.nodes[pick % graph.nodes.length] as StateBits;
        const cycle = shortestCycle(graph, state);
        expect(cycle.length).toBeGreaterThan(0);
        let current = state;
        for (const h of cycle) {
          const next = advanceState(current, h, n);
          expect(next).not.toBeNull();
          current = next as StateBits;
        }
        expect(current).toBe(state);
        // A cycle in the (b,N) graph is a valid siteswap (integer average = b).
        expect(validatePattern(cycle).ok).toBe(true);
      }),
    );
  });
});

// --- planTransition edge cases ---------------------------------------------

describe('planTransition edge cases', () => {
  it('returns an empty bridge when already on the target cycle', () => {
    const graph = buildStateGraph(3, 5);
    const plan = planTransition(graph, graph.ground, [graph.ground]);
    expect(plan.throws).toEqual([]);
    expect(plan.to).toBe(graph.ground);
  });

  it('3 -> 51 crosses one 4-throw bridge (the classic entry)', () => {
    const graph = buildStateGraph(3, 5);
    const cycle = patternCycle([5, 1], 5);
    const plan = planTransition(graph, graph.ground, cycle.nodeSet);
    expect(plan.throws).toEqual([4]);
    expect(cycle.nodeSet.has(plan.to)).toBe(true);
  });

  it('throws on an empty target set (unreachable)', () => {
    const graph = buildStateGraph(3, 5);
    expect(() => planTransition(graph, graph.ground, [])).toThrow(/no path/);
  });

  it('works on a graph object without the internal reverse cache', () => {
    const built = buildStateGraph(2, 4);
    // A structural clone is a different object, so the WeakMap cache misses and
    // the reverse adjacency is derived from the public edges on demand.
    const clone: StateGraph = { ...built };
    const target = built.nodes[built.nodes.length - 1] as StateBits;
    expect(planTransition(clone, built.ground, [target])).toEqual(
      planTransition(built, built.ground, [target]),
    );
  });
});

describe('degenerate inputs', () => {
  it('patternCycle and stateAtBits handle the empty pattern', () => {
    const cycle = patternCycle([], 5);
    expect(cycle.nodes).toEqual([]);
    expect(cycle.edges).toEqual([]);
    expect(stateAtBits([], 0, 5)).toBe(0);
  });

  it('degenerate graphs (b = 0 and b = N) still build and lay out', () => {
    const empty = buildStateGraph(0, 4);
    expect(empty.nodes).toEqual([0]);
    expect(empty.level(0)).toBe(0);
    const full = buildStateGraph(4, 4);
    expect(full.nodes).toEqual([0b1111]);
    expect(full.ground).toBe(0b1111);
    expect(layoutStateGraph(full).nodes).toHaveLength(1);
    // The full graph's single state only holds the cascade (throw N forever).
    expect(shortestCycle(full, full.ground)).toEqual([4]);
  });
});

// --- Layout ------------------------------------------------------------------

/** Mean mirror-symmetry error about the vertical axis through the centroid:
 *  reflect each node, take the distance to the nearest actual node, average, and
 *  normalize by the cloud's RMS radius (scale-invariant). 0 ⇔ exactly symmetric. */
function mirrorError(layout: GraphLayout): number {
  const pts = layout.nodes.map((n) => ({ x: n.x, y: n.y }));
  const n = pts.length;
  let cx = 0;
  let cy = 0;
  for (const p of pts) {
    cx += p.x;
    cy += p.y;
  }
  cx /= n;
  cy /= n;
  let rms = 0;
  for (const p of pts) {
    rms += (p.x - cx) ** 2 + (p.y - cy) ** 2;
  }
  rms = Math.sqrt(rms / n) || 1;
  let sum = 0;
  for (const p of pts) {
    const rx = 2 * cx - p.x;
    let best = Infinity;
    for (const q of pts) {
      const d = (q.x - rx) ** 2 + (q.y - p.y) ** 2;
      if (d < best) {
        best = d;
      }
    }
    sum += Math.sqrt(best);
  }
  return sum / n / rms;
}

/** Smallest pairwise node distance in the layout. */
function minNodeSeparation(layout: GraphLayout): number {
  const pts = layout.nodes.map((n) => ({ x: n.x, y: n.y }));
  let min = Infinity;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const a = pts[i] as { x: number; y: number };
      const b = pts[j] as { x: number; y: number };
      min = Math.min(min, Math.hypot(a.x - b.x, a.y - b.y));
    }
  }
  return min;
}

describe('layoutStateGraph (symmetric stress majorization)', () => {
  it('lays out every node exactly once with finite, in-box coordinates', () => {
    for (const [ballCount, maxHeight] of [
      [3, 5],
      [3, 7],
      [4, 9],
    ] as const) {
      const graph = buildStateGraph(ballCount, maxHeight);
      const layout = layoutStateGraph(graph);
      expect(layout.nodes).toHaveLength(graph.nodes.length);
      expect(new Set(layout.nodes.map((node) => node.bits)).size).toBe(graph.nodes.length);
      for (const node of layout.nodes) {
        expect(Number.isFinite(node.x)).toBe(true);
        expect(Number.isFinite(node.y)).toBe(true);
        expect(Number.isFinite(node.angle)).toBe(true);
        expect(Number.isFinite(node.radius)).toBe(true);
        // Stress layouts normalize into [MARGIN, 1 − MARGIN] with MARGIN = 0.06.
        expect(node.x).toBeGreaterThanOrEqual(0.06 - 1e-9);
        expect(node.x).toBeLessThanOrEqual(0.94 + 1e-9);
        expect(node.y).toBeGreaterThanOrEqual(0.06 - 1e-9);
        expect(node.y).toBeLessThanOrEqual(0.94 + 1e-9);
        expect(layout.coordOf.get(node.bits)).toEqual({ x: node.x, y: node.y });
      }
    }
  });

  it('(3,5) is at least as mirror-symmetric as the hand-made reference (≈0)', () => {
    // The (3,5) graph has a trivial automorphism group, so free SMACOF relaxes
    // away from symmetry (measured mirror error ~0.26, and the current concentric
    // layout ~0.43). Constraining the majorization to the mirror subspace holds
    // it exactly symmetric — matching the hand-made excitation-level triangle,
    // whose mirror error is ~0. Threshold 0.02 pins that with headroom.
    const layout = layoutStateGraph(buildStateGraph(3, 5));
    expect(mirrorError(layout)).toBeLessThan(0.02);
  });

  it('is exactly mirror-symmetric across the stress-regime (b, N) range', () => {
    for (const [ballCount, maxHeight] of [
      [3, 5],
      [2, 6],
      [3, 7],
      [4, 7],
      [3, 9],
      [4, 9],
      [5, 9],
    ] as const) {
      const layout = layoutStateGraph(buildStateGraph(ballCount, maxHeight));
      expect(layout.nodes.length).toBeLessThanOrEqual(STRESS_MAX_NODES);
      expect(mirrorError(layout)).toBeLessThan(0.02);
    }
  });

  it('holds a minimum node separation across the stress range', () => {
    for (const [ballCount, maxHeight] of [
      [3, 5],
      [3, 7],
      [3, 9],
      [4, 9],
      [5, 9],
    ] as const) {
      const layout = layoutStateGraph(buildStateGraph(ballCount, maxHeight));
      // Global measured minimum across all in-range graphs was ~0.032 (the densest
      // 126-node cases); 0.015 pins the floor with headroom.
      expect(minNodeSeparation(layout)).toBeGreaterThan(0.015);
    }
  });

  it('(7,8) is the clean wheel: no three nodes collinear, wide separation', () => {
    // (7,8) is degenerate for the level-row layout (one node per level → a line),
    // so it falls back to free SMACOF, whose natural optimum is a symmetric wheel
    // (a hub + a fanned rim). Assert no three nodes are near-collinear.
    const layout = layoutStateGraph(buildStateGraph(7, 8));
    const pts = layout.nodes.map((n) => ({ x: n.x, y: n.y }));
    expect(pts).toHaveLength(8);
    let worstColinearity = Infinity;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        for (let k = j + 1; k < pts.length; k++) {
          const a = pts[i] as { x: number; y: number };
          const b = pts[j] as { x: number; y: number };
          const c = pts[k] as { x: number; y: number };
          const area = Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
          const s1 = Math.hypot(b.x - a.x, b.y - a.y);
          const s2 = Math.hypot(c.x - a.x, c.y - a.y);
          // 2·area / (s1·s2) = |sin θ| at vertex a — small ⇒ nearly collinear.
          worstColinearity = Math.min(worstColinearity, area / (s1 * s2 || 1));
        }
      }
    }
    // Measured ~0.12; 0.03 guards against any three nodes lining up.
    expect(worstColinearity).toBeGreaterThan(0.03);
    expect(minNodeSeparation(layout)).toBeGreaterThan(0.2);
    expect(mirrorError(layout)).toBeLessThan(0.02);
  });

  it('is bit-identical across two invocations (determinism)', () => {
    for (const [ballCount, maxHeight] of [
      [3, 5],
      [7, 8],
      [4, 9],
    ] as const) {
      const a = layoutStateGraph(buildStateGraph(ballCount, maxHeight));
      const b = layoutStateGraph(buildStateGraph(ballCount, maxHeight));
      expect(a.nodes.map((n) => [n.bits, n.x, n.y, n.angle, n.radius, n.indexInLevel])).toEqual(
        b.nodes.map((n) => [n.bits, n.x, n.y, n.angle, n.radius, n.indexInLevel]),
      );
    }
  });

  it('level populations equal the excitation-level histogram', () => {
    const graph = buildStateGraph(3, 7);
    const layout = layoutStateGraph(graph);
    const histogram = new Map<number, number>();
    for (const node of graph.nodes) {
      histogram.set(graph.level(node), (histogram.get(graph.level(node)) ?? 0) + 1);
    }
    const counts = new Map<number, number>();
    for (const node of layout.nodes) {
      counts.set(node.level, (counts.get(node.level) ?? 0) + 1);
    }
    expect(counts).toEqual(histogram);
    expect(layout.levelCount).toBe(histogram.size);
    expect(layout.maxNodesPerLevel).toBe(Math.max(...histogram.values()));
  });

  it('keeps the 531 cycle reasonably local', () => {
    // Stress majorization optimizes global distance fidelity + symmetry rather
    // than cycle locality, so cycle chords are longer than under the barycenter
    // rings (measured ~0.32). 0.5 guards against a cross-disc scattering.
    const graph = buildStateGraph(3, 7);
    const layout = layoutStateGraph(graph);
    const cycle = patternCycle([5, 3, 1], 7);
    const chords = cycle.edges
      .filter((edge) => edge.from !== edge.to)
      .map((edge) => {
        const from = layout.coordOf.get(edge.from);
        const to = layout.coordOf.get(edge.to);
        expect(from).toBeDefined();
        expect(to).toBeDefined();
        return Math.hypot((from?.x ?? 0) - (to?.x ?? 0), (from?.y ?? 0) - (to?.y ?? 0));
      });
    expect(chords.length).toBeGreaterThan(0);
    const meanChord = chords.reduce((sum, value) => sum + value, 0) / chords.length;
    expect(meanChord).toBeLessThan(0.5);
  });

  it('centers a degenerate single-node graph', () => {
    const layout = layoutStateGraph(buildStateGraph(4, 4));
    expect(layout.nodes).toHaveLength(1);
    expect(layout.nodes[0]?.x).toBe(0.5);
    expect(layout.nodes[0]?.y).toBe(0.5);
    expect(layout.nodes[0]?.radius).toBe(0);
  });
});

describe('layoutStateGraph (concentric rings beyond the stress threshold)', () => {
  it('hands off to concentric rings above STRESS_MAX_NODES', () => {
    // Just below the threshold: stress (ground is not pinned to the exact center).
    const below = buildStateGraph(5, 9); // C(9,5) = 126 ≤ 150
    expect(below.nodes).toHaveLength(126);
    const belowLayout = layoutStateGraph(below);
    const belowGround = belowLayout.nodes.find((node) => node.bits === below.ground);
    expect(belowGround?.radius).toBeGreaterThan(0);

    // Just above the threshold: concentric rings (ground pinned to the center).
    const above = buildStateGraph(3, 11); // C(11,3) = 165 > 150
    expect(above.nodes).toHaveLength(165);
    const aboveLayout = layoutStateGraph(above);
    const aboveGround = aboveLayout.nodes.find((node) => node.bits === above.ground);
    expect(aboveGround?.radius).toBe(0);
    expect(aboveGround?.x).toBe(0.5);
    expect(aboveGround?.y).toBe(0.5);
  });

  it('pins the ground state at the disc center (concentric regime)', () => {
    const graph = buildStateGraph(3, 11); // 165 nodes → concentric
    const layout = layoutStateGraph(graph);
    const groundNode = layout.nodes.find((node) => node.bits === graph.ground);
    expect(groundNode?.level).toBe(0);
    expect(groundNode?.radius).toBe(0);
    expect(groundNode?.x).toBe(0.5);
    expect(groundNode?.y).toBe(0.5);
  });

  it('gives each level one shared radius, strictly increasing with level', () => {
    for (const [ballCount, maxHeight] of [
      [3, 11], // 165 nodes
      [5, 11], // 462 nodes
    ] as const) {
      const layout = layoutStateGraph(buildStateGraph(ballCount, maxHeight));
      const radiusOfLevel = new Map<number, number>();
      for (const node of layout.nodes) {
        const shared = radiusOfLevel.get(node.level);
        if (shared === undefined) {
          radiusOfLevel.set(node.level, node.radius);
        } else {
          expect(node.radius).toBe(shared);
        }
      }
      const levels = [...radiusOfLevel.keys()].sort((a, b) => a - b);
      for (let i = 1; i < levels.length; i++) {
        const inner = radiusOfLevel.get(levels[i - 1] as number) as number;
        const outer = radiusOfLevel.get(levels[i] as number) as number;
        expect(outer).toBeGreaterThan(inner);
      }
      // The outermost ring sits at the disc edge (radius 0.5 of the [0, 1] box).
      expect(radiusOfLevel.get(levels[levels.length - 1] as number)).toBeCloseTo(0.5, 12);
    }
  });

  it('handles the C(11,5) worst case: 462 finite nodes, well under budget', () => {
    const graph = buildStateGraph(5, 11);
    expect(graph.nodes).toHaveLength(462);
    const startNs = process.hrtime.bigint();
    const layout = layoutStateGraph(graph);
    const elapsedMs = Number(process.hrtime.bigint() - startNs) / 1e6;
    expect(layout.nodes).toHaveLength(462);
    for (const node of layout.nodes) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
    }
    // Concentric rings: measured ~30 ms on the reference machine; 200 ms ceiling.
    expect(elapsedMs).toBeLessThan(200);
  });
});
