// src/render3d/Balls — the flying balls (DESIGN.md §6), evaluated from the one
// global clock. Each physical ball (dynamic id from the kinematics, plus any
// static-hold ball riding an all-2 hand) is a sphere whose position is read from
// core's closed-form `ballState(id, simTime)` every frame.
//
// One clock (DESIGN.md §2): this component does NOT advance time. The store's
// single rAF loop (src/ui/useClock) owns simTime; here `useFrame` only *reads*
// the current simTime and moves meshes imperatively via refs — so pause/scrub and
// the non-3D views all render the same instant, and there is one wall clock.
//
// Hot-path hygiene: no React re-render per frame (positions are set on the mesh
// objects directly), a unit sphere scaled to the radius (no geometry churn on the
// radius slider), and reused Vector3s are unnecessary because `mesh.position.set`
// takes scalars. The only per-frame allocations are inside core's `ballState`
// (a small MotionState + vectors per ball); acceptable for the flat ball counts
// here (b ≲ 9) per the Phase 4 plan.

import { useMemo, useRef, type ReactElement } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Mesh } from 'three';
import { useAppStore } from '../state';
import { useBallColorResolver } from './useBallColors';

/** Sphere tessellation — smooth enough at 0.01–0.1 m, cheap for ≲ 9 balls. */
const SPHERE_WIDTH_SEGMENTS = 32;
const SPHERE_HEIGHT_SEGMENTS = 16;

export function Balls(): ReactElement {
  // Subscribe to the derived sim (changes rarely: pattern edits, horizon extend)
  // and the view settings. Per-frame position comes from getState() in useFrame.
  const sim = useAppStore((state) => state.sim);
  const ballRadius = useAppStore((state) => state.ballRadius);

  const kinematics = sim.kinematics;

  // The full ball set: dynamic (flights/carries) + static holds (all-2 hands).
  const ballIds = useMemo(() => {
    const holds = kinematics.staticHolds().map((hold) => hold.ballId);
    return [...kinematics.ballIds(), ...holds];
  }, [kinematics]);

  // Shared color resolver (per-ball palette or single color; matches the ladder).
  const colorForBall = useBallColorResolver();

  const meshes = useRef(new Map<number, Mesh>());

  useFrame(() => {
    // Read the clock and kinematics fresh so a horizon extension mid-frame (which
    // replaces `sim`) is picked up immediately; ball ids are stable across it.
    const { simTime, sim: current } = useAppStore.getState();
    const k = current.kinematics;
    meshes.current.forEach((mesh, ballId) => {
      const position = k.ballPosition(ballId, simTime);
      mesh.position.set(position.x, position.y, position.z);
    });
  });

  return (
    <>
      {ballIds.map((ballId) => (
        <mesh
          key={ballId}
          scale={ballRadius}
          ref={(mesh) => {
            if (mesh) {
              meshes.current.set(ballId, mesh);
            } else {
              meshes.current.delete(ballId);
            }
          }}
        >
          <sphereGeometry args={[1, SPHERE_WIDTH_SEGMENTS, SPHERE_HEIGHT_SEGMENTS]} />
          <meshStandardMaterial color={colorForBall(ballId)} roughness={0.45} metalness={0.05} />
        </mesh>
      ))}
    </>
  );
}
