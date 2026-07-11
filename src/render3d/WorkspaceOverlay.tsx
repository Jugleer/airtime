// src/render3d/WorkspaceOverlay — the main-scene visualization of the hand
// workspace (owner feature 2026-07-11; orchestrator ruling 1 + 6). When the shared
// workspace is enabled, each hand shows a translucent + wireframe copy of the volume
// centered on its catch↔throw anchor, plus the spans of the hand-path loop that fall
// OUTSIDE the volume drawn in red, and a compact per-hand violation badge.
//
// ADVISORY ONLY (ruling 1): this never alters any path — it visualizes the volume
// and flags where the hand leaves it. Path re-planning under constraints is future
// work.
//
// Performance (ruling 6): the violation sampling + all geometry are computed ONCE per
// (sim identity, workspace config) in a useMemo — NEVER per frame. The overlay is
// entirely static given a config (the hand-path loop is periodic and the anchor is
// fixed), so there is no useFrame and zero per-frame allocation. The volume shape is
// built in the DISPLAY-local frame and oriented into the natively-y-up scene by a
// single −90° X rotation (= displayFrame.displayToSim), so it stays consistent with
// the containment math (see src/workspace).

import { useEffect, useMemo, type ReactElement } from 'react';
import {
  BufferGeometry,
  CanvasTexture,
  DoubleSide,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineSegments,
  SphereGeometry,
  SRGBColorSpace,
} from 'three';
import { HAND_Y, useAppStore } from '../state';
import { firstBeatAtOrAfter } from '../state/simulation';
import {
  TETRA_FACES,
  TETRA_VERTICES,
  violationBadge,
  violationOverSamples,
  type ParsedStl,
  type Point3,
  type WorkspaceScale,
  type WorkspaceShapeKind,
} from '../workspace';
import { handPathPeriodBeats, handPathPointCount, handPathStartBeat } from './hands';
import { sampleTimeAt } from './tracers';

/** −90° about X maps a display-local point (X, Y, Z) to the sim point (X, Z, −Y),
 *  i.e. displayFrame.displayToSim — so display Z (up) becomes sim y (up). */
const DISPLAY_TO_SIM_ROTATION_X = -Math.PI / 2;

/** Fill translucency of the volume (a whisper so it never competes with the balls). */
const FILL_OPACITY = 0.1;
/** Wireframe translucency of the volume. */
const WIRE_OPACITY = 0.42;
/** The neutral volume color (calm blue; violations are red). */
const VOLUME_COLOR = '#5b9bff';
/** Red used for out-of-volume path spans + a nonzero badge. */
const VIOLATION_COLOR = '#f2555a';

// --- Canonical unit geometry per shape (display-local; the group scales/rotates) --

function tetraGeometry(): BufferGeometry {
  const positions: number[] = [];
  for (const [i, j, k] of TETRA_FACES) {
    positions.push(...TETRA_VERTICES[i]!, ...TETRA_VERTICES[j]!, ...TETRA_VERTICES[k]!);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function meshGeometry(mesh: ParsedStl): BufferGeometry {
  const positions: number[] = [];
  for (const t of mesh.triangles) {
    positions.push(...t.a, ...t.b, ...t.c);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** Build the canonical unit geometry (display-local) for a shape kind + optional mesh. */
export function buildWorkspaceGeometry(kind: WorkspaceShapeKind, mesh: ParsedStl | null): BufferGeometry {
  if (kind === 'sphere') {
    return new SphereGeometry(1, 32, 24);
  }
  if (kind === 'cube') {
    // Box half-extent 1 (full size 2) so the per-axis scale = the half-extent.
    return boxUnitGeometry();
  }
  if (kind === 'tetra') {
    return tetraGeometry();
  }
  if (mesh && mesh.triangleCount > 0) {
    return meshGeometry(mesh);
  }
  // No mesh yet: a tiny placeholder so the component never holds a null geometry.
  return new SphereGeometry(1, 8, 6);
}

/** Unit box (half-extent 1) as a BufferGeometry, kept local to avoid a BoxGeometry
 *  import cost and to share the display-local convention. */
function boxUnitGeometry(): BufferGeometry {
  // 8 corners at ±1; 12 triangles.
  const c: readonly [number, number, number][] = [
    [-1, -1, -1],
    [1, -1, -1],
    [1, 1, -1],
    [-1, 1, -1],
    [-1, -1, 1],
    [1, -1, 1],
    [1, 1, 1],
    [-1, 1, 1],
  ];
  const faces: readonly [number, number, number][] = [
    [0, 1, 2], [0, 2, 3], // z-
    [4, 6, 5], [4, 7, 6], // z+
    [0, 3, 7], [0, 7, 4], // x-
    [1, 5, 6], [1, 6, 2], // x+
    [0, 4, 5], [0, 5, 1], // y-
    [3, 2, 6], [3, 6, 7], // y+
  ];
  const positions: number[] = [];
  for (const [i, j, k] of faces) {
    positions.push(...c[i]!, ...c[j]!, ...c[k]!);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * A reusable translucent + wireframe view of the workspace volume, centered at
 * `center` (sim frame), scaled per display axis and oriented into the y-up scene.
 * Shared by the main-scene overlay and the popup preview.
 */
export function WorkspaceShapeView({
  kind,
  mesh,
  scale,
  center,
  color = VOLUME_COLOR,
}: {
  readonly kind: WorkspaceShapeKind;
  readonly mesh: ParsedStl | null;
  readonly scale: WorkspaceScale;
  readonly center: readonly [number, number, number];
  readonly color?: string;
}): ReactElement {
  const geometry = useMemo(() => buildWorkspaceGeometry(kind, mesh), [kind, mesh]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <group position={[center[0], center[1], center[2]]}>
      {/* Scale in display-local axes, then rotate the whole thing into sim (y-up). */}
      <group scale={[scale.x, scale.y, scale.z]} rotation={[DISPLAY_TO_SIM_ROTATION_X, 0, 0]}>
        <mesh geometry={geometry}>
          <meshBasicMaterial
            color={color}
            transparent
            opacity={FILL_OPACITY}
            side={DoubleSide}
            depthWrite={false}
          />
        </mesh>
        <mesh geometry={geometry}>
          <meshBasicMaterial color={color} wireframe transparent opacity={WIRE_OPACITY} depthWrite={false} />
        </mesh>
      </group>
    </group>
  );
}

// --- Per-hand violation sampling + red spans ------------------------------------

interface HandOverlay {
  readonly hand: number;
  readonly center: [number, number, number];
  readonly outsideFraction: number;
  /** Red out-of-volume path segments as a flat xyz endpoint buffer (sim frame). */
  readonly redSegments: Float32Array;
  readonly badgeTop: number; // sim y where the badge floats
}

/** A billboarded badge sprite showing "H0 · 12%", red when the hand ever leaves. */
function Badge({
  hand,
  outsideFraction,
  position,
}: {
  readonly hand: number;
  readonly outsideFraction: number;
  readonly position: readonly [number, number, number];
}): ReactElement {
  const texture = useMemo(() => {
    const width = 128;
    const height = 48;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (context) {
      const radius = height / 2;
      context.fillStyle = 'rgba(15, 20, 30, 0.82)';
      if (typeof context.roundRect === 'function') {
        context.beginPath();
        context.roundRect(0, 0, width, height, radius);
        context.fill();
      } else {
        context.fillRect(0, 0, width, height);
      }
      context.fillStyle = outsideFraction > 0 ? VIOLATION_COLOR : '#8bd5a0';
      context.font = '600 26px system-ui, sans-serif';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(violationBadge(hand, outsideFraction), width / 2, height / 2 + 1);
    }
    const created = new CanvasTexture(canvas);
    created.colorSpace = SRGBColorSpace;
    return created;
  }, [hand, outsideFraction]);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <sprite position={[position[0], position[1], position[2]]} scale={[0.16, 0.06, 1]} renderOrder={21}>
      <spriteMaterial map={texture} transparent depthTest={false} depthWrite={false} />
    </sprite>
  );
}

/** The red out-of-volume path spans for one hand (a LineSegments primitive). */
function RedSpans({ segments }: { readonly segments: Float32Array }): ReactElement | null {
  const line = useMemo(() => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(segments, 3));
    const material = new LineBasicMaterial({ color: VIOLATION_COLOR, transparent: true, opacity: 0.95 });
    const built = new LineSegments(geometry, material);
    built.frustumCulled = false;
    return built;
  }, [segments]);
  useEffect(
    () => () => {
      line.geometry.dispose();
      (line.material as LineBasicMaterial).dispose();
    },
    [line],
  );
  if (segments.length === 0) {
    return null;
  }
  return <primitive object={line} />;
}

/**
 * The workspace overlay for the whole scene. Renders only when the workspace is
 * enabled (and, for an STL kind, only when a mesh is loaded — otherwise it is a
 * degraded/disabled STL and shows nothing). All per-hand data is computed once per
 * (sim, workspace, mesh, geometry) in a memo.
 */
export function WorkspaceOverlay(): ReactElement | null {
  const workspace = useAppStore((state) => state.workspace);
  const mesh = useAppStore((state) => state.workspaceMesh);
  const handCount = useAppStore((state) => state.handCount);
  const throwPoints = useAppStore((state) => state.handThrowPoints);
  const catchPoints = useAppStore((state) => state.handCatchPoints);
  const sim = useAppStore((state) => state.sim);
  const kinematicsEpochs = useAppStore((state) => state.kinematicsEpochs);

  const usableStl = workspace.kind !== 'stl' || (mesh !== null && mesh.triangleCount > 0);

  const overlays = useMemo<HandOverlay[]>(() => {
    if (!workspace.enabled || !usableStl) {
      return [];
    }
    const { timeline, beatCount, spatialPeriodBeats, kinematics } = sim;
    const periodBeats = handPathPeriodBeats(spatialPeriodBeats);
    const count = handPathPointCount(periodBeats);
    const lastEpoch = kinematicsEpochs.length > 0 ? kinematicsEpochs[kinematicsEpochs.length - 1] : null;
    const lastEpochBeat = lastEpoch ? firstBeatAtOrAfter(timeline, lastEpoch.time) : -1;
    const startBeat = handPathStartBeat(periodBeats, beatCount, lastEpochBeat);
    const start = timeline.beatTime(startBeat);
    const end = timeline.beatTime(startBeat + periodBeats);

    const result: HandOverlay[] = [];
    for (let hand = 0; hand < handCount; hand++) {
      const c = catchPoints[hand];
      const t = throwPoints[hand];
      if (!c || !t) {
        continue;
      }
      const center: [number, number, number] = [0.5 * (c.x + t.x), HAND_Y, 0.5 * (c.z + t.z)];
      const centerPoint: Point3 = { x: center[0], y: center[1], z: center[2] };

      // Sample the closed hand-path loop at the overlay density (ruling 6).
      const samples: Point3[] = [];
      if (count >= 2) {
        for (let i = 0; i < count; i++) {
          const { position } = kinematics.handState(hand, sampleTimeAt(i, count, start, end));
          samples.push({ x: position.x, y: position.y, z: position.z });
        }
      }
      const violation = violationOverSamples(workspace, mesh, centerPoint, samples);

      // Red segments: any loop edge with an out-of-volume endpoint (closed loop).
      const segs: number[] = [];
      const n = samples.length;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        if (!violation.insideFlags[i] || !violation.insideFlags[j]) {
          const a = samples[i]!;
          const b = samples[j]!;
          segs.push(a.x, a.y, a.z, b.x, b.y, b.z);
        }
      }
      result.push({
        hand,
        center,
        outsideFraction: violation.outsideFraction,
        redSegments: new Float32Array(segs),
        badgeTop: center[1] + workspace.scale.z + 0.12,
      });
    }
    return result;
    // simOffsetToLocal + pointInsideWorkspace are pure; the memo key covers every input.
  }, [workspace, mesh, usableStl, handCount, throwPoints, catchPoints, sim, kinematicsEpochs]);

  if (!workspace.enabled || !usableStl || overlays.length === 0) {
    return null;
  }

  return (
    <group name="workspace-overlay">
      {overlays.map((overlay) => (
        <group key={overlay.hand}>
          <WorkspaceShapeView
            kind={workspace.kind}
            mesh={mesh}
            scale={workspace.scale}
            center={overlay.center}
          />
          <RedSpans segments={overlay.redSegments} />
          <Badge
            hand={overlay.hand}
            outsideFraction={overlay.outsideFraction}
            position={[overlay.center[0], overlay.badgeTop, overlay.center[2]]}
          />
        </group>
      ))}
    </group>
  );
}
