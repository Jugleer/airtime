// src/render3d/HandGizmos — draggable per-hand catch/throw markers (DESIGN.md §6:
// "hand catch/throw positions shown as draggable gizmos when the positions editor
// is open"). Each hand shows two small markers — its catch point and its throw
// point — that drag in the horizontal plane at hand height (x, z; y stays fixed).
//
// A drag creates a future-only kinematics geometry epoch through the store
// (setHandPoint), so it affects LATER throws only — an in-flight ball keeps the
// parabola it was aimed with (DESIGN.md §4.6). This is exactly the acceptance
// scenario "moving a catch point mid-flight affects only later throws".
//
// OrbitControls interplay: while a marker is being dragged we disable the default
// controls (state.controls.enabled = false) so the camera does not orbit under the
// pointer, and re-enable them on release. The drag position is the intersection of
// the pointer ray with the y = HAND_Y plane (a plane-constrained pointer drag),
// computed from the r3f event's ray — robust regardless of where the ray would hit
// the small marker mesh itself.

import { useMemo, useRef, useState, type ReactElement } from 'react';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { Plane, Vector3 } from 'three';
import { HAND_Y, useAppStore, type HandPointKind } from '../state';

/** Marker size (m) and colors — small, high-contrast, unlit so they always read. */
const MARKER_RADIUS = 0.03;
const CATCH_COLOR = '#12a150'; // green — where a ball is caught
const THROW_COLOR = '#e8710a'; // orange — where a ball is released

interface DragTarget {
  readonly hand: number;
  readonly kind: HandPointKind;
}

/** A minimal view of the default controls we toggle while dragging. */
interface ToggleableControls {
  enabled: boolean;
}

/** One draggable marker; delegates the actual point update to the parent. */
function Marker({
  position,
  color,
  onDragStart,
  onDrag,
  onDragEnd,
}: {
  readonly position: Vector3;
  readonly color: string;
  onDragStart(): void;
  onDrag(point: Vector3): void;
  onDragEnd(): void;
}): ReactElement {
  const dragging = useRef(false);
  // A single reusable plane + hit vector (no per-move allocation).
  const plane = useMemo(() => new Plane(new Vector3(0, 1, 0), -HAND_Y), []);
  const hit = useMemo(() => new Vector3(), []);

  return (
    <mesh
      position={position}
      onPointerDown={(event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation();
        dragging.current = true;
        (event.target as Element | null)?.setPointerCapture?.(event.pointerId);
        onDragStart();
      }}
      onPointerMove={(event: ThreeEvent<PointerEvent>) => {
        if (!dragging.current) {
          return;
        }
        event.stopPropagation();
        // Constrain to the y = HAND_Y plane: intersect the pointer ray with it.
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
        onDragEnd();
      }}
    >
      <sphereGeometry args={[MARKER_RADIUS, 16, 12]} />
      <meshBasicMaterial color={color} transparent opacity={0.85} />
    </mesh>
  );
}

/** All hands' catch + throw gizmos; rendered only when the positions editor is open. */
export function HandGizmos(): ReactElement | null {
  const open = useAppStore((state) => state.positionsEditorOpen);
  const handCount = useAppStore((state) => state.handCount);
  const throwPoints = useAppStore((state) => state.handThrowPoints);
  const catchPoints = useAppStore((state) => state.handCatchPoints);
  const setHandPoint = useAppStore((state) => state.setHandPoint);

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
    setHandPoint(target.hand, target.kind, point.x, point.z);
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
          color={CATCH_COLOR}
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
          color={THROW_COLOR}
          onDragStart={() => beginDrag({ hand, kind: 'throw' })}
          onDrag={(point) => update({ hand, kind: 'throw' }, point)}
          onDragEnd={endDrag}
        />,
      );
    }
  }

  // `dragging` is referenced so the group re-renders on drag state changes (and to
  // keep the intent explicit); markers read their positions from the store points.
  return <group name={dragging ? 'hand-gizmos-dragging' : 'hand-gizmos'}>{markers}</group>;
}
