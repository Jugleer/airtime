// src/render3d/Hands — the hand cups + persistent hand paths (DESIGN.md §4.3–§4.4,
// §6). Two independent, toggleable layers over the balls:
//
//   <Hands>      one translucent partial hollow sphere (a bowl opening upward) per
//                hand, moved imperatively to `handState(hand, simTime)` every frame
//                — exactly like <Balls>, no per-frame allocation. Static-hold hands
//                are included: handState returns their rest (hold) point.
//   <HandPaths>  one subtle line per hand tracing the CLOSED loop the hand walks
//                over one spatial period (carries + returns). The loop is periodic
//                and closed-form, so it is sampled ONCE per sim rebuild / kinematics
//                epoch into a preallocated buffer (an effect keyed on the sim +
//                kinematics epochs), NOT per frame.
//
// One clock (DESIGN.md §2): like <Balls>/<Tracers>, the cups read simTime in
// useFrame and never advance it, so pause/scrub and the other views stay in sync.

import { useEffect, useMemo, useRef, type ReactElement } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Line,
  LineBasicMaterial,
  type Mesh,
  type MeshStandardMaterial,
} from 'three';
import { useAppStore } from '../state';
import { sampleTimeAt } from './tracers';
import {
  buildHandTiltKeyframes,
  evaluateHandTilt,
  HAND_CUP_DROP_FACTOR,
  HAND_CUP_PHI_LENGTH,
  HAND_CUP_PHI_START,
  HAND_CUP_THETA_LENGTH,
  HAND_CUP_THETA_START,
  handCupRadius,
  handPathColor,
  handPathPeriodBeats,
  handPathPointCount,
  handPathStartBeat,
  type HandTiltKeyframes,
  maxHandPathPoints,
  type Quat,
} from './hands';

// Reused scratch for the per-frame cup orientation — one <Hands> is mounted and
// each frame fills it per hand in turn, so a module-level object is zero-allocation.
const cupTiltScratch: Quat = { x: 0, y: 0, z: 0, w: 1 };

/** Cup tessellation — smooth enough for a small bowl, cheap for ≤ 8 hands. */
const CUP_WIDTH_SEGMENTS = 24;
const CUP_HEIGHT_SEGMENTS = 12;
/** Cup translucency (subtle so it never competes with the balls). */
const CUP_OPACITY = 0.55;
/** Highlighted-cup opacity + emissive boost on chart-legend hover (owner req. 3). */
const CUP_HOVER_OPACITY = 0.92;
const CUP_HOVER_EMISSIVE = 0.7;
/** Hand-path line translucency (a faint guide, not a solid trace). */
const HAND_PATH_OPACITY = 0.55;

/**
 * The hand cups (DESIGN.md §4.3–§4.4). One unit-radius lower-hemisphere mesh per
 * hand, scaled to the cup radius and moved every frame to the hand point (dropped
 * slightly so a carried ball nests in the opening). Position is set imperatively
 * on the mesh — no React re-render per frame, no allocation (the only per-sample
 * cost is inside core's `handState`, inherent to that API).
 */
export function Hands({ color }: { readonly color: string }): ReactElement | null {
  const showHands = useAppStore((state) => state.showHands);
  const handCount = useAppStore((state) => state.handCount);
  const ballRadius = useAppStore((state) => state.ballRadius);
  // Subscribe to the sim so cup-tilt keyframes recompute once per sim identity (a
  // horizon extension / kinematics edit replaces `sim`), NOT per frame. carriesForHand
  // allocates fresh copies, so it must live in a memo — never in useFrame.
  const sim = useAppStore((state) => state.sim);

  const cupRadius = handCupRadius(ballRadius);
  const drop = ballRadius * HAND_CUP_DROP_FACTOR;
  const meshes = useRef(new Map<number, Mesh>());

  // Per-hand cup-orientation keyframes (catch/throw normals + upright return relax),
  // from core's analytic event velocities. Rebuilt only when the sim / hand count
  // changes; the render loop below just binary-searches + slerps into a scratch quat.
  const tiltKeyframes = useMemo(() => {
    const map = new Map<number, HandTiltKeyframes>();
    for (let hand = 0; hand < handCount; hand++) {
      map.set(hand, buildHandTiltKeyframes(sim.kinematics.carriesForHand(hand)));
    }
    return map;
  }, [sim, handCount]);

  useFrame(() => {
    // Read the clock + kinematics fresh (a horizon extension mid-frame replaces
    // `sim`); hand indices are stable across it. Empty map ⇒ a no-op when hidden.
    // `hoveredHandIndex` (set by the chart legend, DESIGN.md §2 view-only) makes the
    // hovered hand's cup pop — brighter (emissive) and more opaque — so it stands out
    // from its neighbors. Scalars only (no per-frame allocation, no string parsing).
    const { simTime, sim: liveSim, hoveredHandIndex } = useAppStore.getState();
    const k = liveSim.kinematics;
    meshes.current.forEach((mesh, hand) => {
      const { position } = k.handState(hand, simTime);
      mesh.position.set(position.x, position.y - drop, position.z);
      // Tilt the cup so its opening is normal to the ball at catches/throws and
      // blends smoothly between (evaluateHandTilt is zero-allocation). A hand with
      // no carries (static hold) has empty keyframes → upright.
      const keyframes = tiltKeyframes.get(hand);
      if (keyframes) {
        evaluateHandTilt(keyframes, simTime, cupTiltScratch);
        mesh.quaternion.set(cupTiltScratch.x, cupTiltScratch.y, cupTiltScratch.z, cupTiltScratch.w);
      }
      const material = mesh.material as MeshStandardMaterial;
      const highlighted = hand === hoveredHandIndex;
      material.emissiveIntensity = highlighted ? CUP_HOVER_EMISSIVE : 0;
      material.opacity = highlighted ? CUP_HOVER_OPACITY : CUP_OPACITY;
    });
  });

  if (!showHands) {
    return null;
  }

  const hands = Array.from({ length: handCount }, (_, hand) => hand);
  return (
    <>
      {hands.map((hand) => (
        <mesh
          key={hand}
          scale={cupRadius}
          ref={(mesh) => {
            if (mesh) {
              meshes.current.set(hand, mesh);
            } else {
              meshes.current.delete(hand);
            }
          }}
        >
          {/* Lower hemisphere (theta ∈ [π/2, π]) = a bowl opening upward. */}
          <sphereGeometry
            args={[
              1,
              CUP_WIDTH_SEGMENTS,
              CUP_HEIGHT_SEGMENTS,
              HAND_CUP_PHI_START,
              HAND_CUP_PHI_LENGTH,
              HAND_CUP_THETA_START,
              HAND_CUP_THETA_LENGTH,
            ]}
          />
          {/* DoubleSide so the open shell reads from inside and out. emissive is the
              cup color at intensity 0 (no glow) until a legend hover boosts it in
              useFrame, so the highlight needs no per-frame color allocation. */}
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={0}
            side={DoubleSide}
            transparent
            opacity={CUP_OPACITY}
            roughness={0.6}
            metalness={0.05}
          />
        </mesh>
      ))}
    </>
  );
}

/**
 * One hand's persistent path line. The polyline buffer is allocated ONCE (module
 * capacity) and refilled by an effect only when the sim or the kinematics epochs
 * change — never per frame (the loop is periodic and closed-form, DESIGN.md §2).
 */
function HandPathLine({ hand, color }: { readonly hand: number; readonly color: string }): ReactElement {
  const sim = useAppStore((state) => state.sim);

  // Built once; persists across sim rebuilds because React reconciles this element
  // by its stable hand key. frustumCulled off: the buffer spans a whole loop.
  const line = useMemo(() => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(maxHandPathPoints() * 3), 3));
    geometry.setDrawRange(0, 0);
    const material = new LineBasicMaterial({ transparent: true, opacity: HAND_PATH_OPACITY });
    const built = new Line(geometry, material);
    built.frustumCulled = false;
    return built;
  }, []);

  useEffect(() => {
    (line.material as LineBasicMaterial).color.set(color);
  }, [color, line]);

  useEffect(
    () => () => {
      line.geometry.dispose();
      (line.material as LineBasicMaterial).dispose();
    },
    [line],
  );

  // Resample the closed loop once per sim identity change (rebuild / splice /
  // clean restart / kinematics epoch / horizon extension — every one of these
  // replaces `sim`). The window is anchored at the END of the horizon, which is
  // always the CURRENT pattern's steady state with the latest kinematics: a live
  // pattern splice keeps the past bit-identical, so sampling near the start would
  // resample the OLD pattern and the overlay would persist the pre-change loop
  // (handPathStartBeat). drawRange is set to the fresh `count` every time, so a
  // shorter new loop never leaves stale points from a longer previous one drawn.
  useEffect(() => {
    const { timeline, beatCount, spatialPeriodBeats, kinematics } = sim;
    const periodBeats = handPathPeriodBeats(spatialPeriodBeats);
    const count = handPathPointCount(periodBeats);
    const position = line.geometry.getAttribute('position') as BufferAttribute;
    const array = position.array as Float32Array;
    if (count < 2) {
      line.geometry.setDrawRange(0, 0);
      line.visible = false;
      return;
    }
    const startBeat = handPathStartBeat(periodBeats, beatCount);
    const start = timeline.beatTime(startBeat);
    const end = timeline.beatTime(startBeat + periodBeats);
    for (let i = 0; i < count; i++) {
      const { position: point } = kinematics.handState(hand, sampleTimeAt(i, count, start, end));
      array[3 * i] = point.x;
      array[3 * i + 1] = point.y;
      array[3 * i + 2] = point.z;
    }
    position.needsUpdate = true;
    line.geometry.setDrawRange(0, count);
    line.visible = true;
  }, [sim, hand, line]);

  return <primitive object={line} />;
}

/** Persistent per-hand path loops (one subtle line each), when enabled. */
export function HandPaths(): ReactElement | null {
  const showHandPaths = useAppStore((state) => state.showHandPaths);
  const handCount = useAppStore((state) => state.handCount);
  if (!showHandPaths) {
    return null;
  }
  const hands = Array.from({ length: handCount }, (_, hand) => hand);
  return (
    <>
      {hands.map((hand) => (
        <HandPathLine key={hand} hand={hand} color={handPathColor(hand)} />
      ))}
    </>
  );
}
