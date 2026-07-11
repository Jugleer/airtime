// src/render3d/Triad — the always-visible orientation triad (owner item,
// 2026-07-11). A small view-axes widget pinned to a screen corner that tracks the
// camera's orientation, showing the right-handed Z-UP DISPLAY frame (X along the
// hand line, Y front↔back, Z up) so the user always knows which way is up even as
// they free-orbit. The scene itself stays natively y-up (CLAUDE.md); this widget
// is the visual face of ./displayFrame.
//
// Screen-fixed placement: the triad lives in the scene (a normal child), but every
// frame it is repositioned to a fixed camera-relative corner at a fixed apparent
// size, and its world orientation is reset to identity so the three arrows point
// along the true world/sim directions — as the camera orbits, the arrows appear to
// swing, exactly like a mini view-cube. It is NOT parented to the camera (the
// camera is not part of the render graph), so a per-frame transform does the job.
//
// Labels are synthesized canvas-texture sprites (like the hand-gizmo labels), NEVER
// drei <Text> — troika resolves fallback fonts from a CDN and this app makes no
// external requests (CLAUDE.md).

import { useEffect, useMemo, useRef, type ReactElement } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  CanvasTexture,
  Color,
  Group,
  PerspectiveCamera,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { DISPLAY_AXES } from './displayFrame';

// --- Placement + sizing (all tunable; see the report for the corner decision) ---

/** Depth (world units) in front of the camera the widget floats at. */
const TRIAD_DEPTH = 1.3;
/** Corner in normalized device coords: +x right, −y bottom → bottom-right. */
const TRIAD_NDC_X = 0.8;
const TRIAD_NDC_Y = -0.78;
/** Widget size as a fraction of the view half-height at {@link TRIAD_DEPTH}. */
const TRIAD_SIZE_FRACTION = 0.14;
/** Render order: draw over the scene (with depthTest off) so nothing occludes it. */
const TRIAD_RENDER_ORDER = 20;

// --- Arrow geometry (group-local, unit axis length = 1; the group scales it) ----

const SHAFT_RADIUS = 0.05;
const HEAD_RADIUS = 0.13;
const HEAD_LENGTH = 0.3;
const LABEL_OFFSET = 1.34; // along the axis, past the head
const LABEL_SIZE = 0.55; // group-local sprite size

const UP = new Vector3(0, 1, 0);

/** A colored letter on a soft dark disc, drawn to a self-contained CanvasTexture. */
function makeAxisLabelTexture(letter: string, color: string): CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (context) {
    context.clearRect(0, 0, size, size);
    context.beginPath();
    context.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    context.fillStyle = 'rgba(15, 20, 30, 0.72)';
    context.fill();
    context.fillStyle = color;
    context.font = '700 42px system-ui, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(letter, size / 2, size / 2 + 2);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** One colored axis: shaft + arrowhead along `direction`, with a billboarded label. */
function Axis({
  direction,
  color,
  label,
}: {
  readonly direction: Vector3;
  readonly color: string;
  readonly label: string;
}): ReactElement {
  // Orient the +y-built shaft/head onto the axis direction (constant per axis).
  const quaternion = useMemo(
    () => new Quaternion().setFromUnitVectors(UP, direction.clone().normalize()),
    [direction],
  );
  const shaftLength = LABEL_OFFSET - HEAD_LENGTH - 0.2;
  const shaftCenter = useMemo(() => direction.clone().multiplyScalar(shaftLength / 2), [direction, shaftLength]);
  const headCenter = useMemo(
    () => direction.clone().multiplyScalar(shaftLength + HEAD_LENGTH / 2),
    [direction, shaftLength],
  );
  const labelPos = useMemo(() => direction.clone().multiplyScalar(LABEL_OFFSET), [direction]);

  const labelTexture = useMemo(() => makeAxisLabelTexture(label, color), [label, color]);
  useEffect(() => () => labelTexture.dispose(), [labelTexture]);

  const emissive = useMemo(() => new Color(color), [color]);

  return (
    <group>
      <mesh position={shaftCenter} quaternion={quaternion} renderOrder={TRIAD_RENDER_ORDER}>
        <cylinderGeometry args={[SHAFT_RADIUS, SHAFT_RADIUS, shaftLength, 12]} />
        <meshBasicMaterial color={color} depthTest={false} depthWrite={false} transparent />
      </mesh>
      <mesh position={headCenter} quaternion={quaternion} renderOrder={TRIAD_RENDER_ORDER}>
        <coneGeometry args={[HEAD_RADIUS, HEAD_LENGTH, 14]} />
        <meshBasicMaterial color={emissive} depthTest={false} depthWrite={false} transparent />
      </mesh>
      <sprite position={labelPos} scale={[LABEL_SIZE, LABEL_SIZE, 1]} renderOrder={TRIAD_RENDER_ORDER + 1}>
        <spriteMaterial map={labelTexture} transparent depthTest={false} depthWrite={false} />
      </sprite>
    </group>
  );
}

/**
 * The orientation triad. Rendered inside <Canvas> (see Scene). Pins itself to the
 * bottom-right corner at a fixed apparent size every frame and shows the display
 * frame's three axes (X red, Y green, Z blue) in world orientation.
 */
export function Triad(): ReactElement {
  const groupRef = useRef<Group>(null);

  // Reusable scratch vectors (no per-frame allocation).
  const scratch = useMemo(
    () => ({ pos: new Vector3(), right: new Vector3(), up: new Vector3(), forward: new Vector3() }),
    [],
  );

  useFrame(({ camera }) => {
    const group = groupRef.current;
    if (!group || !(camera instanceof PerspectiveCamera)) {
      return;
    }
    const halfHeight = Math.tan((camera.fov * Math.PI) / 360) * TRIAD_DEPTH;
    const halfWidth = halfHeight * camera.aspect;
    // Camera basis from its world matrix (columns 0/1/2 = right/up/−forward).
    scratch.right.setFromMatrixColumn(camera.matrixWorld, 0);
    scratch.up.setFromMatrixColumn(camera.matrixWorld, 1);
    camera.getWorldDirection(scratch.forward); // unit, points where the camera looks
    // corner world position = eye + forward·depth + right·(ndcX·halfW) + up·(ndcY·halfH)
    scratch.pos
      .copy(camera.position)
      .addScaledVector(scratch.forward, TRIAD_DEPTH)
      .addScaledVector(scratch.right, TRIAD_NDC_X * halfWidth)
      .addScaledVector(scratch.up, TRIAD_NDC_Y * halfHeight);
    group.position.copy(scratch.pos);
    group.quaternion.identity(); // arrows point along the true world/sim directions
    group.scale.setScalar(TRIAD_SIZE_FRACTION * halfHeight);
  });

  const axes = useMemo(
    () =>
      DISPLAY_AXES.map((axis) => ({
        name: axis.name,
        color: axis.color,
        direction: new Vector3(axis.simDirection[0], axis.simDirection[1], axis.simDirection[2]),
      })),
    [],
  );

  return (
    <group ref={groupRef} renderOrder={TRIAD_RENDER_ORDER}>
      {axes.map((axis) => (
        <Axis key={axis.name} direction={axis.direction} color={axis.color} label={axis.name} />
      ))}
    </group>
  );
}
