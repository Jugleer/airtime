// Pure tests for the hand-gizmo sizing/color/label helpers (./gizmos): the
// invariants that make the enlarged hit spheres unambiguous under closest-hit
// raycasting, and the label scheme that identifies markers without a selector.

import { describe, expect, it } from 'vitest';
import { circleHandGeometry, lineHandGeometry } from '../core/kinematics';
import { HAND_COUNT_MAX, type HandPointKind } from '../state';
import {
  GIZMO_HIT_RADIUS,
  GIZMO_HOVER_SCALE,
  GIZMO_LABEL_RENDER_ORDER,
  GIZMO_MARKER_RADIUS,
  GIZMO_RENDER_ORDER,
  GLOBAL_COLOR,
  GLOBAL_HOT_COLOR,
  globalAnchor,
  globalColorOf,
  globalMarkerLabel,
  markerColorOf,
  markerLabel,
  translatedPair,
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

  it('translates the catch/throw pair rigidly so the anchor lands on the drag target', () => {
    const catchPoint = { x: -0.3, z: 0 };
    const throwPoint = { x: -0.1, z: 0 };
    // Old anchor is (−0.2, 0); dragging it to (0.5, 0.25) shifts both by (+0.7, +0.25).
    const moved = translatedPair(catchPoint, throwPoint, 0.5, 0.25);
    expect(moved.catch.x).toBeCloseTo(0.4, 12);
    expect(moved.catch.z).toBeCloseTo(0.25, 12);
    expect(moved.throw.x).toBeCloseTo(0.6, 12);
    expect(moved.throw.z).toBeCloseTo(0.25, 12);
    // The pair's relative offset is preserved, and the new midpoint IS the target.
    const newAnchor = globalAnchor(moved.catch, moved.throw);
    expect(newAnchor.x).toBeCloseTo(0.5, 12);
    expect(newAnchor.z).toBeCloseTo(0.25, 12);
  });
});
