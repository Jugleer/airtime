// Pure tests for the hand-gizmo sizing/color/label helpers (./gizmos): the
// invariants that make the enlarged hit spheres unambiguous under closest-hit
// raycasting, and the label scheme that identifies markers without a selector.

import { describe, expect, it } from 'vitest';
import { circleHandGeometry, lineHandGeometry } from '../core/kinematics';
import { HAND_COUNT_MAX, HAND_Y, type HandPointKind } from '../state';
import {
  GIZMO_HIT_RADIUS,
  GIZMO_HIT_RADIUS_COARSE,
  GIZMO_HOVER_SCALE,
  GIZMO_LABEL_RENDER_ORDER,
  GIZMO_MARKER_RADIUS,
  GIZMO_RENDER_ORDER,
  GLOBAL_COLOR,
  GLOBAL_HOT_COLOR,
  GLOBAL_NODE_DROP,
  GLOBAL_NODE_DROP_COARSE,
  globalAnchor,
  globalColorOf,
  globalMarkerLabel,
  globalNodeDropForPointer,
  hitRadiusForPointer,
  markerColorOf,
  markerLabel,
} from './gizmos';

const KINDS: readonly HandPointKind[] = ['catch', 'throw'];

describe('gizmo sizing invariants', () => {
  it('hit sphere is larger than the visual marker, even hover-scaled', () => {
    expect(GIZMO_HIT_RADIUS).toBeGreaterThan(GIZMO_MARKER_RADIUS);
    expect(GIZMO_HIT_RADIUS).toBeGreaterThan(GIZMO_MARKER_RADIUS * GIZMO_HOVER_SCALE);
    expect(GIZMO_HOVER_SCALE).toBeGreaterThan(1);
  });

  it('no preset marker center falls inside a same-hand neighbor hit sphere', () => {
    // Closest-hit disambiguation: a hand's own catch and throw markers are the
    // tightest pair in both presets (DESIGN.md §7). As long as each center is
    // OUTSIDE the other's hit sphere, pointing at a marker's visible body always
    // grabs that marker (the neighbor's sphere is missed or hit strictly later).
    for (const geometry of [lineHandGeometry(2), circleHandGeometry(2)]) {
      for (let hand = 0; hand < 2; hand++) {
        const t = geometry.throwPoint(hand);
        const c = geometry.catchPoint(hand);
        const gap = Math.hypot(t.x - c.x, t.y - c.y, t.z - c.z);
        expect(gap).toBeGreaterThan(GIZMO_HIT_RADIUS);
      }
    }
  });

  it('overlay render order puts labels above markers, markers above the scene', () => {
    expect(GIZMO_RENDER_ORDER).toBeGreaterThan(0);
    expect(GIZMO_LABEL_RENDER_ORDER).toBeGreaterThan(GIZMO_RENDER_ORDER);
  });
});

describe('markerLabel', () => {
  it('encodes hand index + kind initial', () => {
    expect(markerLabel(0, 'catch')).toBe('0C');
    expect(markerLabel(0, 'throw')).toBe('0T');
    expect(markerLabel(7, 'catch')).toBe('7C');
    expect(markerLabel(3, 'throw')).toBe('3T');
  });

  it('is unique across every marker at the maximum hand count', () => {
    const labels = new Set<string>();
    for (let hand = 0; hand < HAND_COUNT_MAX; hand++) {
      for (const kind of KINDS) {
        labels.add(markerLabel(hand, kind));
      }
    }
    expect(labels.size).toBe(HAND_COUNT_MAX * KINDS.length);
  });
});

describe('markerColorOf', () => {
  it('distinguishes kinds, and hot from idle', () => {
    const colors = new Set(
      KINDS.flatMap((kind) => [markerColorOf(kind, false), markerColorOf(kind, true)]),
    );
    expect(colors.size).toBe(4); // catch/throw x idle/hot, all distinct
  });
});

// --- Global ("whole hand") node (owner item, 2026-07-11) ---------------------

describe('global hand-position node', () => {
  it('labels the global node "<hand>G", unique against the C/T markers of every hand', () => {
    expect(globalMarkerLabel(0)).toBe('0G');
    expect(globalMarkerLabel(7)).toBe('7G');
    const labels = new Set<string>();
    for (let hand = 0; hand < HAND_COUNT_MAX; hand++) {
      labels.add(markerLabel(hand, 'catch'));
      labels.add(markerLabel(hand, 'throw'));
      labels.add(globalMarkerLabel(hand));
    }
    expect(labels.size).toBe(HAND_COUNT_MAX * 3); // C, T, G per hand, all distinct
  });

  it('uses a grey color distinct from catch/throw, brightening when hot', () => {
    expect(globalColorOf(false)).toBe(GLOBAL_COLOR);
    expect(globalColorOf(true)).toBe(GLOBAL_HOT_COLOR);
    const all = new Set([
      GLOBAL_COLOR,
      GLOBAL_HOT_COLOR,
      markerColorOf('catch', false),
      markerColorOf('catch', true),
      markerColorOf('throw', false),
      markerColorOf('throw', true),
    ]);
    expect(all.size).toBe(6); // grey idle/hot never collides with catch/throw
  });

  it('anchors at the midpoint of the catch and throw points', () => {
    expect(globalAnchor({ x: -0.3, z: 0 }, { x: -0.1, z: 0 })).toEqual({ x: -0.2, z: 0 });
    expect(globalAnchor({ x: 0.2, z: 0.4 }, { x: 0.6, z: -0.2 })).toEqual({ x: 0.4, z: 0.1 });
  });

  it('the coarse-pointer (fingertip) sizing keeps every sphere unambiguous in BOTH presets', () => {
    // Touch bumps the hit radius AND deepens the global drop together (./gizmos): the
    // pair must preserve the SAME invariants the fine sizing guarantees — global sphere
    // fully disjoint from catch/throw, and no marker centre inside another's hit sphere.
    expect(GIZMO_HIT_RADIUS_COARSE).toBeGreaterThan(GIZMO_HIT_RADIUS);
    expect(hitRadiusForPointer(true)).toBe(GIZMO_HIT_RADIUS_COARSE);
    expect(hitRadiusForPointer(false)).toBe(GIZMO_HIT_RADIUS);
    expect(globalNodeDropForPointer(true)).toBe(GLOBAL_NODE_DROP_COARSE);
    expect(globalNodeDropForPointer(false)).toBe(GLOBAL_NODE_DROP);
    const dist = (
      a: { x: number; y: number; z: number },
      b: { x: number; y: number; z: number },
    ): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    for (const geometry of [lineHandGeometry(2), circleHandGeometry(2)]) {
      for (let hand = 0; hand < 2; hand++) {
        const catchPoint = geometry.catchPoint(hand);
        const throwPoint = geometry.throwPoint(hand);
        const anchor = globalAnchor(catchPoint, throwPoint);
        const global = { x: anchor.x, y: HAND_Y - GLOBAL_NODE_DROP_COARSE, z: anchor.z };
        expect(dist(global, catchPoint)).toBeGreaterThanOrEqual(2 * GIZMO_HIT_RADIUS_COARSE);
        expect(dist(global, throwPoint)).toBeGreaterThanOrEqual(2 * GIZMO_HIT_RADIUS_COARSE);
        expect(dist(catchPoint, throwPoint)).toBeGreaterThan(GIZMO_HIT_RADIUS_COARSE);
        expect(dist(global, catchPoint)).toBeGreaterThan(GIZMO_HIT_RADIUS_COARSE);
        expect(dist(global, throwPoint)).toBeGreaterThan(GIZMO_HIT_RADIUS_COARSE);
      }
    }
  });

  it('drops the global node so its hit sphere clears catch/throw in BOTH presets', () => {
    // The three markers a hand shows in 3D: catch (on the hand plane), throw (on the
    // hand plane), and the grey global node dropped GLOBAL_NODE_DROP below the plane.
    // The global node's whole POINT is to move the pair; if its hit sphere overlapped
    // C or T, a grab near an endpoint could resolve to it. So the global↔endpoint
    // CENTER distance must exceed 2·GIZMO_HIT_RADIUS (the spheres are fully disjoint).
    // C↔T themselves keep only the design's weaker closest-hit invariant — each center
    // outside the other's hit sphere — because their separation is fixed geometry
    // (0.10 m in the circle preset, below 2·GIZMO_HIT_RADIUS = 0.14 m by design).
    const dist = (
      a: { x: number; y: number; z: number },
      b: { x: number; y: number; z: number },
    ): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    for (const geometry of [lineHandGeometry(2), circleHandGeometry(2)]) {
      for (let hand = 0; hand < 2; hand++) {
        const catchPoint = geometry.catchPoint(hand);
        const throwPoint = geometry.throwPoint(hand);
        const anchor = globalAnchor(catchPoint, throwPoint);
        const global = { x: anchor.x, y: HAND_Y - GLOBAL_NODE_DROP, z: anchor.z };
        // The global hit sphere is fully disjoint from both endpoint hit spheres.
        expect(dist(global, catchPoint)).toBeGreaterThanOrEqual(2 * GIZMO_HIT_RADIUS);
        expect(dist(global, throwPoint)).toBeGreaterThanOrEqual(2 * GIZMO_HIT_RADIUS);
        // And no marker center sits inside another's hit sphere (closest-hit invariant).
        expect(dist(catchPoint, throwPoint)).toBeGreaterThan(GIZMO_HIT_RADIUS);
        expect(dist(global, catchPoint)).toBeGreaterThan(GIZMO_HIT_RADIUS);
        expect(dist(global, throwPoint)).toBeGreaterThan(GIZMO_HIT_RADIUS);
      }
    }
  });
});
