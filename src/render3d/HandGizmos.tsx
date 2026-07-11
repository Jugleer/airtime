// src/render3d/HandGizmos — draggable per-hand catch/throw markers (DESIGN.md §6:
// "hand catch/throw positions shown as draggable gizmos when the positions editor
// is open"). Each hand shows two markers — its catch point and its throw point —
// that drag in the horizontal plane at hand height (x, z; y stays fixed).
//
// A drag creates a future-only kinematics geometry epoch through the store
// (setHandPoint), so it affects LATER throws only — an in-flight ball keeps the
// parabola it was aimed with (DESIGN.md §4.6). This is exactly the acceptance
// scenario "moving a catch point mid-flight affects only later throws". The
// marker itself and the dashed future ghost paths update live during the drag
// (Tracers keeps ghosts visible while the editor is open), so the edit is never
// silent even though the balls' current paths are — correctly — unchanged.
//
// Ergonomics (each marker):
//   - an INVISIBLE enlarged hit sphere (GIZMO_HIT_RADIUS) owns the pointer
//     handlers, so grabs don't demand pixel-precise aim; the raycaster's
//     closest-hit ordering keeps adjacent markers separable (see ./gizmos);
//   - hover/drag affordance: the visual marker scales up and brightens, and the
//     document cursor shows grab/grabbing (restored on out/up/unmount);
//   - the visual marker and its label render with depth testing off at a raised
//     render order, so balls/trails/ghosts never occlude an editing target
//     (editor-scoped — gizmos only exist while the editor is open);
//   - a per-hand identity label ("0C" = hand 0 catch, "0T" = hand 0 throw)
//     billboarded above each marker answers "which hand?" with no selector UI.
//     The label is a synthesized canvas texture on a sprite, NOT drei <Text>:
//     troika-three-text resolves fallback fonts from a CDN at runtime, and this
//     app makes no external requests (CLAUDE.md).
//
// OrbitControls interplay: while a marker is being dragged we disable the default
// controls (state.controls.enabled = false) so the camera does not orbit under the
// pointer, and re-enable them on release. The drag position is the intersection of
// the pointer ray with the y = HAND_Y plane (a plane-constrained pointer drag),
// computed from the r3f event's ray — robust regardless of where the ray would hit
// the marker mesh itself.

import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { CanvasTexture, Plane, SRGBColorSpace, Vector3 } from 'three';
import { HAND_Y, useAppStore, type HandPointKind } from '../state';
import {
  GIZMO_HIT_RADIUS,
  GIZMO_HOVER_SCALE,
  GIZMO_LABEL_RENDER_ORDER,
  GIZMO_MARKER_RADIUS,
  GIZMO_RENDER_ORDER,
  GLOBAL_NODE_DROP,
  globalAnchor,
  globalColorOf,
  globalMarkerLabel,
  markerColorOf,
  markerLabel,
} from './gizmos';

/** What a drag targets: one endpoint (catch/throw) or the whole-hand global node. */
type NodeKind = HandPointKind | 'global';

// --- Label sprites (synthesized, self-contained — no external font fetch) ----

/** Canvas pixel size for a two-character label (supersampled for crispness). */
const LABEL_CANVAS_WIDTH = 96;
const LABEL_CANVAS_HEIGHT = 56;
/** World-space label size (m) and lift above the marker center (m). */
const LABEL_WORLD_HEIGHT = 0.05;
const LABEL_WORLD_WIDTH = (LABEL_CANVAS_WIDTH / LABEL_CANVAS_HEIGHT) * LABEL_WORLD_HEIGHT;
const LABEL_LIFT = 0.085; // clears the hover-scaled marker (0.042) + half label height

/** Draw `text` as a white-on-dark pill onto a fresh CanvasTexture. */
function makeLabelTexture(text: string): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = LABEL_CANVAS_WIDTH;
  canvas.height = LABEL_CANVAS_HEIGHT;
  const context = canvas.getContext('2d');
  if (context) {
    const radius = LABEL_CANVAS_HEIGHT / 2;
    context.fillStyle = 'rgba(28, 34, 44, 0.85)';
    if (typeof context.roundRect === 'function') {
      context.beginPath();
      context.roundRect(0, 0, LABEL_CANVAS_WIDTH, LABEL_CANVAS_HEIGHT, radius);
      context.fill();
    } else {
      context.fillRect(0, 0, LABEL_CANVAS_WIDTH, LABEL_CANVAS_HEIGHT);
    }
    context.fillStyle = '#ffffff';
    context.font = '600 32px system-ui, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, LABEL_CANVAS_WIDTH / 2, LABEL_CANVAS_HEIGHT / 2 + 1);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** Set/clear the page cursor (grab affordance); no-op outside a browser. */
function setDocumentCursor(cursor: string): void {
  if (typeof document !== 'undefined') {
    document.body.style.cursor = cursor;
  }
}

interface DragTarget {
  readonly hand: number;
  readonly kind: NodeKind;
}

/** A minimal view of the default controls we toggle while dragging. */
interface ToggleableControls {
  enabled: boolean;
}

/** One draggable marker; delegates the actual point update to the parent. */
function Marker({
  position,
  label,
  colorIdle,
  colorHot,
  planeY = HAND_Y,
  onDragStart,
  onDrag,
  onDragEnd,
}: {
  readonly position: Vector3;
  readonly label: string;
  readonly colorIdle: string;
  readonly colorHot: string;
  /**
   * The y of the horizontal plane the pointer ray is intersected against during a
   * drag. Defaults to HAND_Y (the catch/throw markers sit on it); the grey global
   * node renders one {@link GLOBAL_NODE_DROP} below the hand plane, so it drags in
   * that lowered plane — keeping the grabbed point under the pointer (no parallax
   * jump) while its x/z still map straight to the catch↔throw midpoint.
   */
  readonly planeY?: number;
  onDragStart(): void;
  onDrag(point: Vector3): void;
  onDragEnd(): void;
}): ReactElement {
  // Refs are what the pointer handlers consult; `hot` re-renders the affordance.
  const dragging = useRef(false);
  const hovered = useRef(false);
  const [hot, setHot] = useState(false);
  const refreshHot = (): void => setHot(hovered.current || dragging.current);

  // A single reusable plane + hit vector (no per-move allocation).
  const plane = useMemo(() => new Plane(new Vector3(0, 1, 0), -planeY), [planeY]);
  const hit = useMemo(() => new Vector3(), []);

  const labelTexture = useMemo(() => makeLabelTexture(label), [label]);
  useEffect(() => () => labelTexture.dispose(), [labelTexture]);

  // Closing the editor mid-hover/drag unmounts us — never leave a stale cursor.
  useEffect(
    () => () => {
      if (hovered.current || dragging.current) {
        setDocumentCursor('');
      }
    },
    [],
  );

  return (
    <group position={position}>
      {/* Invisible enlarged hit sphere — owns ALL pointer handling. opacity 0 +
          depthWrite off draws nothing and punches no holes; raycasting ignores
          the material entirely, so it still grabs (that is its whole job). */}
      <mesh
        onPointerOver={() => {
          hovered.current = true;
          if (!dragging.current) {
            setDocumentCursor('grab');
          }
          refreshHot();
        }}
        onPointerOut={() => {
          hovered.current = false;
          if (!dragging.current) {
            setDocumentCursor('');
          }
          refreshHot();
        }}
        onPointerDown={(event: ThreeEvent<PointerEvent>) => {
          event.stopPropagation();
          dragging.current = true;
          (event.target as Element | null)?.setPointerCapture?.(event.pointerId);
          setDocumentCursor('grabbing');
          refreshHot();
          onDragStart();
        }}
        onPointerMove={(event: ThreeEvent<PointerEvent>) => {
          if (!dragging.current) {
            return;
          }
          event.stopPropagation();
          // Constrain to the marker's drag plane (y = planeY): intersect the ray with it.
          if (event.ray.intersectPlane(plane, hit)) {
            onDrag(hit);
          }
        }}
        onPointerUp={(event: ThreeEvent<PointerEvent>) => {
          if (!dragging.current) {
            return;
          }
          event.stopPropagation();
          dragging.current = false;
          (event.target as Element | null)?.releasePointerCapture?.(event.pointerId);
          setDocumentCursor(hovered.current ? 'grab' : '');
          refreshHot();
          onDragEnd();
        }}
      >
        <sphereGeometry args={[GIZMO_HIT_RADIUS, 12, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* Visual marker: depth test off + raised render order so balls, trails,
          and ghosts never hide an editing target; grows + brightens when hot. */}
      <mesh scale={hot ? GIZMO_HOVER_SCALE : 1} renderOrder={GIZMO_RENDER_ORDER}>
        <sphereGeometry args={[GIZMO_MARKER_RADIUS, 16, 12]} />
        <meshBasicMaterial
          color={hot ? colorHot : colorIdle}
          transparent
          opacity={hot ? 1 : 0.85}
          depthTest={false}
        />
      </mesh>

      {/* Per-hand identity label; sprites always face the camera. */}
      <sprite
        position={[0, LABEL_LIFT, 0]}
        scale={[LABEL_WORLD_WIDTH, LABEL_WORLD_HEIGHT, 1]}
        renderOrder={GIZMO_LABEL_RENDER_ORDER}
      >
        <spriteMaterial map={labelTexture} transparent depthTest={false} depthWrite={false} />
      </sprite>
    </group>
  );
}

/** All hands' catch + throw gizmos; rendered only when the positions editor is open. */
export function HandGizmos(): ReactElement | null {
  const open = useAppStore((state) => state.positionsEditorOpen);
  const handCount = useAppStore((state) => state.handCount);
  const throwPoints = useAppStore((state) => state.handThrowPoints);
  const catchPoints = useAppStore((state) => state.handCatchPoints);
  const setHandPoint = useAppStore((state) => state.setHandPoint);
  const setHandAnchor = useAppStore((state) => state.setHandAnchor);

  const controls = useThree((state) => state.controls) as ToggleableControls | null;
  const [dragging, setDragging] = useState<DragTarget | null>(null);

  if (!open) {
    return null;
  }

  const beginDrag = (target: DragTarget): void => {
    setDragging(target);
    if (controls) {
      controls.enabled = false; // don't orbit the camera while dragging a marker
    }
  };
  const endDrag = (): void => {
    setDragging(null);
    if (controls) {
      controls.enabled = true;
    }
  };
  const update = (target: DragTarget, point: Vector3): void => {
    // The grey global node moves the whole hand (catch + throw as a rigid pair);
    // the catch/throw nodes move their single point. Both are future-only epochs.
    if (target.kind === 'global') {
      setHandAnchor(target.hand, point.x, point.z);
    } else {
      setHandPoint(target.hand, target.kind, point.x, point.z);
    }
  };

  const markers: ReactElement[] = [];
  for (let hand = 0; hand < handCount; hand++) {
    const catchPoint = catchPoints[hand];
    const throwPoint = throwPoints[hand];
    if (catchPoint) {
      markers.push(
        <Marker
          key={`catch-${hand}`}
          position={new Vector3(catchPoint.x, catchPoint.y, catchPoint.z)}
          label={markerLabel(hand, 'catch')}
          colorIdle={markerColorOf('catch', false)}
          colorHot={markerColorOf('catch', true)}
          onDragStart={() => beginDrag({ hand, kind: 'catch' })}
          onDrag={(point) => update({ hand, kind: 'catch' }, point)}
          onDragEnd={endDrag}
        />,
      );
    }
    if (throwPoint) {
      markers.push(
        <Marker
          key={`throw-${hand}`}
          position={new Vector3(throwPoint.x, throwPoint.y, throwPoint.z)}
          label={markerLabel(hand, 'throw')}
          colorIdle={markerColorOf('throw', false)}
          colorHot={markerColorOf('throw', true)}
          onDragStart={() => beginDrag({ hand, kind: 'throw' })}
          onDrag={(point) => update({ hand, kind: 'throw' }, point)}
          onDragEnd={endDrag}
        />,
      );
    }
    // Grey whole-hand ("global") node at the midpoint of catch and throw; drags
    // both together as a rigid pair (owner item, 2026-07-11). It renders one
    // GLOBAL_NODE_DROP BELOW the hand plane so its hit sphere clears the catch/throw
    // spheres even in the tight circle preset (see ./gizmos); it drags in that same
    // lowered plane, so its x/z still target the midpoint (setHandAnchor).
    if (catchPoint && throwPoint) {
      const anchor = globalAnchor(catchPoint, throwPoint);
      const globalY = HAND_Y - GLOBAL_NODE_DROP;
      markers.push(
        <Marker
          key={`global-${hand}`}
          position={new Vector3(anchor.x, globalY, anchor.z)}
          label={globalMarkerLabel(hand)}
          colorIdle={globalColorOf(false)}
          colorHot={globalColorOf(true)}
          planeY={globalY}
          onDragStart={() => beginDrag({ hand, kind: 'global' })}
          onDrag={(point) => update({ hand, kind: 'global' }, point)}
          onDragEnd={endDrag}
        />,
      );
    }
  }

  // `dragging` is referenced so the group re-renders on drag state changes (and to
  // keep the intent explicit); markers read their positions from the store points.
  return <group name={dragging ? 'hand-gizmos-dragging' : 'hand-gizmos'}>{markers}</group>;
}
