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

/**
 * The GLOBAL ("whole hand") node color — a neutral grey, distinct from the green
 * catch and orange throw markers (owner item, 2026-07-11). Dragging it translates
 * the hand's catch AND throw points together as a rigid pair.
 */
export const GLOBAL_COLOR = '#8a94a6'; // grey — moves the whole hand
export const GLOBAL_HOT_COLOR = '#c2cad6';

/** The marker fill color for a kind and hover/drag state. */
export function markerColorOf(kind: HandPointKind, hot: boolean): string {
  if (kind === 'catch') {
    return hot ? CATCH_HOT_COLOR : CATCH_COLOR;
  }
  return hot ? THROW_HOT_COLOR : THROW_COLOR;
}

/** The grey global-node color for a hover/drag state. */
export function globalColorOf(hot: boolean): string {
  return hot ? GLOBAL_HOT_COLOR : GLOBAL_COLOR;
}

/**
 * The per-hand identity label for a marker: hand index + kind initial, e.g.
 * "0C" = hand 0 catch point, "3T" = hand 3 throw point. Unique per marker, so
 * the 3D view answers "which hand is this?" without any selector UI.
 */
export function markerLabel(hand: number, kind: HandPointKind): string {
  return `${hand}${kind === 'catch' ? 'C' : 'T'}`;
}

/**
 * The per-hand GLOBAL-node label: hand index + "G" (e.g. "0G" = hand 0 whole-hand
 * mover), matching the "0C"/"0T" style and unique across every marker of a hand.
 */
export function globalMarkerLabel(hand: number): string {
  return `${hand}G`;
}

/** A point in the horizontal hand plane (x, z); y is fixed at hand height. */
export interface PlanarXZ {
  readonly x: number;
  readonly z: number;
}

/**
 * The anchor point for a hand's global node: the midpoint of its catch and throw
 * points in the x–z plane (owner's "sensible anchor"). Dragging the global node to
 * a new anchor translates both points by the same delta — see {@link translatedPair}.
 */
export function globalAnchor(catchPoint: PlanarXZ, throwPoint: PlanarXZ): PlanarXZ {
  return {
    x: 0.5 * (catchPoint.x + throwPoint.x),
    z: 0.5 * (catchPoint.z + throwPoint.z),
  };
}

/**
 * Move a hand's catch/throw pair rigidly so its {@link globalAnchor} lands on
 * `(anchorX, anchorZ)`: both points shift by the same delta = new anchor − old
 * anchor, preserving their relative offset. Pure math for the grey global node's
 * drag; the store applies the result as a future-only geometry epoch.
 */
export function translatedPair(
  catchPoint: PlanarXZ,
  throwPoint: PlanarXZ,
  anchorX: number,
  anchorZ: number,
): { catch: PlanarXZ; throw: PlanarXZ } {
  const anchor = globalAnchor(catchPoint, throwPoint);
  const dx = anchorX - anchor.x;
  const dz = anchorZ - anchor.z;
  return {
    catch: { x: catchPoint.x + dx, z: catchPoint.z + dz },
    throw: { x: throwPoint.x + dx, z: throwPoint.z + dz },
  };
}
