// src/render3d/Tracers — ball trails + dashed future ghosts (DESIGN.md §6).
//
// Each dynamic ball gets a solid trailing polyline of `position(t)` over
// [simTime − trailLength, simTime] and, when enabled, a dashed forward polyline
// over [simTime, simTime + GHOST_SPAN_SECONDS]. Because the sim is a pure function
// of time (DESIGN.md §2), these are just resamplings of the exact analytic path —
// they trace flight parabolas and carry splines exactly and stay correct while
// scrubbing (no recorded history, no replay buffer).
//
// One clock (DESIGN.md §2): like <Balls>, this reads simTime in useFrame and never
// advances it. Hot-path hygiene (Phase 5 requirement): every ball's position and
// line-distance buffers are Float32Arrays allocated ONCE (sized for the longest
// possible trail / the fixed ghost span); each frame we overwrite them in place
// and move the geometry draw range — NO per-frame array or geometry allocation.
// (The only per-sample allocation is inside core's `ballState`, inherent to that
// API and unchanged from Phase 4.)

import { useEffect, useMemo, type ReactElement } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BufferAttribute,
  BufferGeometry,
  Line,
  LineBasicMaterial,
  LineDashedMaterial,
} from 'three';
import { TRAIL_LENGTH_MAX, useAppStore } from '../state';
import { useBallColorResolver } from './useBallColors';
import {
  GHOST_SPAN_SECONDS,
  maxGhostPoints,
  maxTrailPoints,
  sampleTimeAt,
  TRAIL_SAMPLE_DT,
  trailPointCount,
} from './tracers';

// Buffer capacities: sized for the widest trail (store cap) and the fixed ghost
// span, so a slider/handle change never reallocates (Phase 5 hot-path rule).
const MAX_TRAIL_POINTS = maxTrailPoints(TRAIL_LENGTH_MAX);
const MAX_GHOST_POINTS = maxGhostPoints();

// Dashes in world units (meters): small enough to read as a "future" hint.
const GHOST_DASH_SIZE = 0.045;
const GHOST_GAP_SIZE = 0.03;

/** Build a Line with a preallocated position buffer (and optional lineDistance). */
function makeLine(maxPoints: number, dashed: boolean): Line {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(maxPoints * 3), 3));
  if (dashed) {
    // LineDashedMaterial reads the `lineDistance` attribute; we fill it in place
    // each frame (cumulative arc length) instead of calling computeLineDistances,
    // which would allocate a fresh attribute every frame.
    geometry.setAttribute('lineDistance', new BufferAttribute(new Float32Array(maxPoints), 1));
  }
  geometry.setDrawRange(0, 0);
  const material = dashed
    ? new LineDashedMaterial({
        dashSize: GHOST_DASH_SIZE,
        gapSize: GHOST_GAP_SIZE,
        transparent: true,
        opacity: 0.7,
      })
    : new LineBasicMaterial({ transparent: true, opacity: 0.9 });
  const line = new Line(geometry, material);
  line.frustumCulled = false; // buffers span the whole path; skip stale-bounds culling
  return line;
}

/** One ball's trail + ghost lines, updated imperatively each frame. */
function BallTracer({ ballId, color }: { ballId: number; color: string }): ReactElement {
  // Built once (capacities are module constants); persists across horizon
  // extensions because React reconciles this element by its stable ballId key.
  const { trail, ghost } = useMemo(
    () => ({ trail: makeLine(MAX_TRAIL_POINTS, false), ghost: makeLine(MAX_GHOST_POINTS, true) }),
    [],
  );

  // Reactively recolor without rebuilding geometry.
  useEffect(() => {
    (trail.material as LineBasicMaterial).color.set(color);
    (ghost.material as LineDashedMaterial).color.set(color);
  }, [color, trail, ghost]);

  // Dispose GPU resources when this ball leaves the pattern.
  useEffect(
    () => () => {
      trail.geometry.dispose();
      (trail.material as LineBasicMaterial).dispose();
      ghost.geometry.dispose();
      (ghost.material as LineDashedMaterial).dispose();
    },
    [trail, ghost],
  );

  useFrame(() => {
    const { simTime, trailLength, ghostsEnabled, positionsEditorOpen, sim } = useAppStore.getState();
    const k = sim.kinematics;

    // Editor-scoped ghost override: while the hand-positions editor is open the
    // dashed future paths are always drawn, even with the ghosts toggle off. A
    // hand-point drag is future-only (DESIGN.md §4.6) — in-flight balls keep the
    // parabola they were aimed with — so the ghost path is the only immediate
    // ball-side feedback an edit produces; without it a drag can read as a no-op
    // (especially paused). The toggle state itself is untouched.
    const ghostsShown = ghostsEnabled || positionsEditorOpen;

    // --- Trail: [max(0, simTime − trailLength), simTime] ---
    const trailSpan = Math.min(trailLength, simTime); // never sample t < 0
    const trailCount = trailPointCount(trailSpan, TRAIL_SAMPLE_DT, MAX_TRAIL_POINTS);
    if (trailCount > 0) {
      const start = simTime - trailSpan;
      const pos = trail.geometry.getAttribute('position') as BufferAttribute;
      const arr = pos.array as Float32Array;
      for (let i = 0; i < trailCount; i++) {
        const { position } = k.ballState(ballId, sampleTimeAt(i, trailCount, start, simTime));
        arr[3 * i] = position.x;
        arr[3 * i + 1] = position.y;
        arr[3 * i + 2] = position.z;
      }
      pos.needsUpdate = true;
      trail.geometry.setDrawRange(0, trailCount);
    }
    trail.visible = trailCount > 0;

    // --- Ghost: [simTime, simTime + GHOST_SPAN_SECONDS], dashed ---
    if (ghostsShown) {
      const end = simTime + GHOST_SPAN_SECONDS;
      const ghostCount = trailPointCount(GHOST_SPAN_SECONDS, TRAIL_SAMPLE_DT, MAX_GHOST_POINTS);
      const pos = ghost.geometry.getAttribute('position') as BufferAttribute;
      const dist = ghost.geometry.getAttribute('lineDistance') as BufferAttribute;
      const parr = pos.array as Float32Array;
      const darr = dist.array as Float32Array;
      let cumulative = 0;
      let px = 0;
      let py = 0;
      let pz = 0;
      for (let i = 0; i < ghostCount; i++) {
        const { position } = k.ballState(ballId, sampleTimeAt(i, ghostCount, simTime, end));
        parr[3 * i] = position.x;
        parr[3 * i + 1] = position.y;
        parr[3 * i + 2] = position.z;
        if (i === 0) {
          darr[0] = 0;
        } else {
          const dx = position.x - px;
          const dy = position.y - py;
          const dz = position.z - pz;
          cumulative += Math.sqrt(dx * dx + dy * dy + dz * dz);
          darr[i] = cumulative;
        }
        px = position.x;
        py = position.y;
        pz = position.z;
      }
      pos.needsUpdate = true;
      dist.needsUpdate = true;
      ghost.geometry.setDrawRange(0, ghostCount);
      ghost.visible = true;
    } else {
      ghost.visible = false;
    }
  });

  return (
    <>
      <primitive object={trail} />
      <primitive object={ghost} />
    </>
  );
}

/** Trails + ghosts for every dynamic ball (static holds don't move — skipped). */
export function Tracers(): ReactElement {
  const sim = useAppStore((state) => state.sim);
  const ballIds = useMemo(() => sim.kinematics.ballIds(), [sim]);
  const colorForBall = useBallColorResolver();

  return (
    <>
      {ballIds.map((ballId) => (
        <BallTracer key={ballId} ballId={ballId} color={colorForBall(ballId)} />
      ))}
    </>
  );
}
