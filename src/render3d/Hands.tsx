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
} from 'three';
import { useAppStore } from '../state';
import { firstBeatAtOrAfter } from '../state/simulation';
import { sampleTimeAt } from './tracers';
import {
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
  maxHandPathPoints,
} from './hands';

/** Cup tessellation — smooth enough for a small bowl, cheap for ≤ 8 hands. */
const CUP_WIDTH_SEGMENTS = 24;
const CUP_HEIGHT_SEGMENTS = 12;
/** Cup translucency (subtle so it never competes with the balls). */
const CUP_OPACITY = 0.55;
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

  const cupRadius = handCupRadius(ballRadius);
  const drop = ballRadius * HAND_CUP_DROP_FACTOR;
  const meshes = useRef(new Map<number, Mesh>());

  useFrame(() => {
    // Read the clock + kinematics fresh (a horizon extension mid-frame replaces
    // `sim`); hand indices are stable across it. Empty map ⇒ a no-op when hidden.
    const { simTime, sim } = useAppStore.getState();
    const k = sim.kinematics;
    meshes.current.forEach((mesh, hand) => {
      const { position } = k.handState(hand, simTime);
      mesh.position.set(position.x, position.y - drop, position.z);
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
          {/* DoubleSide so the open shell reads from inside and out. */}
          <meshStandardMaterial
            color={color}
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
  const kinematicsEpochs = useAppStore((state) => state.kinematicsEpochs);

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

  // Resample the closed loop once per sim / kinematics-epoch change. Anchor the
  // one-period window at the steady state after the latest kinematics epoch (so a
  // gravity / hold-depth / carry-path / geometry edit is reflected), or one period
  // in when there is none (the first steady cycle, past the startup ease-in).
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
    const lastEpoch = kinematicsEpochs.length > 0 ? kinematicsEpochs[kinematicsEpochs.length - 1] : null;
    const lastEpochBeat = lastEpoch ? firstBeatAtOrAfter(timeline, lastEpoch.time) : -1;
    const startBeat = handPathStartBeat(periodBeats, beatCount, lastEpochBeat);
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
  }, [sim, kinematicsEpochs, hand, line]);

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
