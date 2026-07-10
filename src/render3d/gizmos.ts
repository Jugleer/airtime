// src/render3d/gizmos — pure sizing/color/label helpers for the hand-position
// gizmos (DESIGN.md §6). No three.js, no React — unit-testable without WebGL,
// like ./tracers and ./coloring. The component (HandGizmos.tsx) renders these.
//
// Sizing rationale: the VISUAL marker stays small (3 cm — it marks a point), but
// the raycast HIT target is a larger invisible sphere so a drag doesn't demand
// pixel-precise aim. The hit radius is bounded by the tightest same-hand
// catch↔throw separation of the two geometry presets (DESIGN.md §7): line preset
// 0.20 m, circle preset throwInset 0.10 m — with GIZMO_HIT_RADIUS below, one
// marker's center is never inside a neighbor's hit sphere, so the raycaster's
// closest-hit ordering resolves every grab unambiguously.

import type { HandPointKind } from '../state';

/** Visual marker sphere radius (m) — small, it marks a point. */
export const GIZMO_MARKER_RADIUS = 0.03;

/**
 * Invisible hit-sphere radius (m) — the forgiving grab/hover target
 * (≈ 13 px at the front-preset camera vs ≈ 5 px for the bare visual marker).
 */
export const GIZMO_HIT_RADIUS = 0.07;

/** Visual scale applied to a hovered or dragged marker (hover affordance). */
export const GIZMO_HOVER_SCALE = 1.4;

/**
 * Render order for the marker spheres. With depth testing disabled they draw
 * after (over) the balls, trails, and ghosts — an editing target is never
 * occluded. Editor-scoped: gizmos only render while the positions editor is open.
 */
export const GIZMO_RENDER_ORDER = 10;

/** Labels draw over the markers themselves. */
export const GIZMO_LABEL_RENDER_ORDER = 11;

/** Marker colors by kind, with a brightened "hot" (hovered/dragged) variant. */
const CATCH_COLOR = '#12a150'; // green — where a ball is caught
const CATCH_HOT_COLOR = '#1fd873';
const THROW_COLOR = '#e8710a'; // orange — where a ball is released
const THROW_HOT_COLOR = '#ff9433';

/** The marker fill color for a kind and hover/drag state. */
export function markerColorOf(kind: HandPointKind, hot: boolean): string {
  if (kind === 'catch') {
    return hot ? CATCH_HOT_COLOR : CATCH_COLOR;
  }
  return hot ? THROW_HOT_COLOR : THROW_COLOR;
}

/**
 * The per-hand identity label for a marker: hand index + kind initial, e.g.
 * "0C" = hand 0 catch point, "3T" = hand 3 throw point. Unique per marker, so
 * the 3D view answers "which hand is this?" without any selector UI.
 */
export function markerLabel(hand: number, kind: HandPointKind): string {
  return `${hand}${kind === 'catch' ? 'C' : 'T'}`;
}
