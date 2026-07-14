// src/render3d/Scene — the main 3D view (DESIGN.md §6): a react-three-fiber
// Canvas with a navigable orbit camera, camera presets, a subtle ground grid,
// simple lighting, and the flying balls. Reads the one global clock through
// <Balls> (DESIGN.md §2); this component owns only view state (which preset is
// active), never simulation time.
//
// Assets: none. Lighting is analytic lights (no HDR/env maps) and the grid is
// drei's procedural Grid, so the SPA stays self-contained (CLAUDE.md, DESIGN.md).
//
// WebGL guard: mounting a Canvas needs a WebGL context, which jsdom (tests) and
// the rare context-less browser lack. We detect that once and render a plain
// placeholder instead — so <App/> stays mountable in jsdom without a Canvas
// (the Phase 4 SSR/jsdom caution), and a real browser gets the full scene.

import {
  useEffect,
  useRef,
  useState,
  type ComponentRef,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { AdaptiveDpr, Grid, OrbitControls, PerformanceMonitor } from '@react-three/drei';
import { Balls } from './Balls';
import { Tracers } from './Tracers';
import { Hands, HandPaths } from './Hands';
import { HandGizmos } from './HandGizmos';
import { WorkspaceOverlay } from './WorkspaceOverlay';
import { Triad } from './Triad';
import { useAppStore } from '../state';
import { setCameraSampler, setCanvasElement } from '../state/sceneBridge';
import { setCaptureRoot } from './captureBridge';
import type { CameraPose } from '../state/codec';
import {
  CAMERA_MAX_DISTANCE,
  CAMERA_MIN_DISTANCE,
  CAMERA_PRESETS,
  CAMERA_PRESET_LABELS,
  CAMERA_TARGET_MAX,
  CAMERA_TARGET_MIN,
  clampCameraView,
  presetView,
  type CameraPreset,
} from './camera';

/**
 * Render-loop mode for the Canvas (DESIGN.md §6, mobile battery/thermal). While
 * playing, run 'always' (the rAF clock in useClock advances simTime every frame).
 * While paused/idle, run 'demand': r3f repaints only when something asks it to
 * (OrbitControls' change→invalidate, damping settle, or {@link RepaintOnScrub} on a
 * simTime change) instead of re-rendering the full scene at 60-120Hz forever.
 * Exported as a pure helper so the paused-saves-battery contract is unit-testable
 * (Scene itself renders a WebGL-less placeholder in jsdom, so it can't be asserted
 * through a render).
 */
export function sceneFrameloop(playing: boolean): 'always' | 'demand' {
  return playing ? 'always' : 'demand';
}

/** Whether a WebGL context can be created (false in jsdom / no-WebGL browsers). */
function webglAvailable(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return false;
  }
  const w = window as unknown as {
    WebGLRenderingContext?: unknown;
    WebGL2RenderingContext?: unknown;
  };
  // If neither constructor exists (jsdom), bail before touching getContext (which
  // jsdom logs a noisy "Not implemented" for).
  if (
    typeof w.WebGLRenderingContext === 'undefined' &&
    typeof w.WebGL2RenderingContext === 'undefined'
  ) {
    return false;
  }
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

/**
 * Applies the store's camera pose (set by a preset button or a shared URL, §6) to
 * the three camera + OrbitControls, hosts the controls, and registers a live-camera
 * sampler so "Copy share link" captures wherever the user has orbited to. Runs
 * inside <Canvas>. Snapping on a pose change is intentional (an instant "jump to
 * view"); free orbit/zoom/pan in between.
 *
 * Bounds: the store pose is clamped through {@link clampCameraView} (identity on
 * presets; an out-of-bounds shared-URL camera degrades gracefully), zoom distance
 * through OrbitControls' min/maxDistance, and PANNING through the change handler
 * below — a pan moves the orbit TARGET (distance limits are relative to it), so
 * the target is boxed to keep the camera near the juggling (see camera.ts).
 */
function CameraRig(): ReactElement {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);
  const cameraView = useAppStore((state) => state.cameraView);

  useEffect(() => {
    const view = clampCameraView(cameraView);
    camera.position.set(view.position[0], view.position[1], view.position[2]);
    const orbit = controls.current;
    if (orbit) {
      orbit.target.set(view.target[0], view.target[1], view.target[2]);
      orbit.update();
    } else {
      camera.lookAt(view.target[0], view.target[1], view.target[2]);
    }
    // Repaint after a preset/shared-URL pose snap while paused (demand frameloop).
    // OrbitControls.update() dispatches 'change' → drei invalidates too, but the
    // no-controls branch (camera.lookAt) has no such hook — invalidate explicitly.
    invalidate();
  }, [cameraView, camera, invalidate]);

  // Box the orbit target on every controls change (pan is the only unclamped way
  // out of bounds). The guard makes the clamp idempotent: `update()` re-fires
  // `change` → this handler, but an in-box target changes nothing, so the
  // re-entrant call is a no-op and the recursion stops after one level. The
  // eye follows on the next update (min/maxDistance re-clamp it to the target).
  const clampControlsTarget = (): void => {
    const orbit = controls.current;
    if (!orbit) {
      return;
    }
    const { target } = orbit;
    const x = Math.min(Math.max(target.x, CAMERA_TARGET_MIN[0]), CAMERA_TARGET_MAX[0]);
    const y = Math.min(Math.max(target.y, CAMERA_TARGET_MIN[1]), CAMERA_TARGET_MAX[1]);
    const z = Math.min(Math.max(target.z, CAMERA_TARGET_MIN[2]), CAMERA_TARGET_MAX[2]);
    if (x !== target.x || y !== target.y || z !== target.z) {
      target.set(x, y, z);
      orbit.update();
    }
  };

  // Sample the LIVE camera on demand for share links (the user free-orbits without
  // touching the store); cleared on unmount so a stale sampler never fires.
  useEffect(() => {
    setCameraSampler((): CameraPose => {
      const orbit = controls.current;
      return {
        position: [camera.position.x, camera.position.y, camera.position.z],
        target: orbit
          ? [orbit.target.x, orbit.target.y, orbit.target.z]
          : [cameraView.target[0], cameraView.target[1], cameraView.target[2]],
      };
    });
    return () => setCameraSampler(null);
  }, [camera, cameraView]);

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      minDistance={CAMERA_MIN_DISTANCE}
      maxDistance={CAMERA_MAX_DISTANCE}
      onChange={clampControlsTarget}
    />
  );
}

/**
 * Registers r3f's root-store getter with the capture bridge so the offline
 * exporter (src/export/capture) can drive the render loop frame-by-frame and read
 * the gl/scene/camera handles. Runs inside <Canvas>; clears on unmount. Renders
 * nothing and never re-renders per frame (the getter reference is stable).
 */
function CaptureRegistrar(): null {
  const get = useThree((state) => state.get);
  useEffect(() => {
    setCaptureRoot(get);
    return () => setCaptureRoot(null);
  }, [get]);
  return null;
}

/**
 * Keeps the paused-but-scrubbing case alive under the 'demand' frameloop. Several
 * view-only fields are read imperatively inside useFrame subscribers (never through
 * React), so a Canvas subtree re-render is never triggered when they change and, in
 * demand mode, nothing repaints unless we ask:
 *   - simTime — Balls/Hands/Tracers read it in useFrame to place meshes at the time.
 *   - hoveredHandIndex — Hands.tsx reads it via getState() in useFrame to highlight
 *     the hovered hand (hovering a hand in the ladder/legend while paused must light
 *     it up in 3D immediately, not on the next scrub/camera-move/play).
 *   - trailLength, ghostsEnabled — Tracers.tsx reads both via getState() in useFrame;
 *     adjusting trail length or toggling ghost balls while paused must repaint now.
 * Subscribe to the store and invalidate whenever any of these changes; the next demand
 * frame runs the useFrame subscribers, which update the meshes. While playing
 * (frameloop 'always') the extra invalidate is a no-op.
 *
 * This does NOT fight offline export (src/export/capture): that path drives the loop
 * with root.advance() manually and pins/restores root.frameloop itself, and grabs
 * pixels synchronously right after its own gl.render — a stray demand repaint (same
 * frozen export camera, preserveDrawingBuffer intact) can only redraw the identical
 * frame, never corrupt a captured one.
 */
function RepaintOnScrub(): null {
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    const initial = useAppStore.getState();
    let previousSimTime = initial.simTime;
    let previousHoveredHandIndex = initial.hoveredHandIndex;
    let previousTrailLength = initial.trailLength;
    let previousGhostsEnabled = initial.ghostsEnabled;
    return useAppStore.subscribe((state) => {
      if (
        state.simTime !== previousSimTime ||
        state.hoveredHandIndex !== previousHoveredHandIndex ||
        state.trailLength !== previousTrailLength ||
        state.ghostsEnabled !== previousGhostsEnabled
      ) {
        previousSimTime = state.simTime;
        previousHoveredHandIndex = state.hoveredHandIndex;
        previousTrailLength = state.trailLength;
        previousGhostsEnabled = state.ghostsEnabled;
        invalidate();
      }
    });
  }, [invalidate]);
  return null;
}

/**
 * Adaptive render resolution under sustained GPU load (mobile perf/thermal
 * robustness). drei's <PerformanceMonitor> samples the real frame rate over a
 * sliding window and calls onDecline once enough recent samples fall below the
 * display's fps floor; wired here to r3f's own performance.regress() — the same
 * "temporarily lower quality" signal drei's <AdaptiveDpr> already watches
 * (state.performance.current), normally reserved for interactive controls' own
 * `regress` flag. Repeated onDecline calls (load sustained across sampling
 * windows) keep regress()'s internal debounce topped up; once fps recovers and
 * onDecline stops firing, that debounce elapses and resolution is restored
 * automatically — no onIncline wiring needed. Keeps the dpr cap [1, 2] on <Canvas/>
 * as the ceiling; this only ever pulls resolution DOWN from wherever it is.
 *
 * PerformanceMonitor only samples frames that actually render (via useFrame); it
 * never calls invalidate() or touches the frameloop mode itself, so it composes
 * with Scene's 'demand' frameloop while paused — sampling simply idles along with
 * the render loop instead of forcing it back to 'always'.
 *
 * Export guard: src/export/capture.ts drives frames manually with root.advance()
 * while frameloop is pinned to 'never' (see RepaintOnScrub above), and advance()
 * DOES fire useFrame subscribers — including this one. A dpr change mid-export
 * would make the captured resolution inconsistent frame-to-frame, so onDecline
 * reads the CURRENT frameloop through r3f's own `get()` (not a subscribed value —
 * export toggles it without a Scene re-render) and no-ops while it is 'never'.
 */
function AdaptivePerformance({ children }: { readonly children: ReactNode }): ReactElement {
  const regress = useThree((state) => state.performance.regress);
  const get = useThree((state) => state.get);
  const onDecline = (): void => {
    if (get().frameloop === 'never') {
      return;
    }
    regress();
  };
  return (
    <PerformanceMonitor onDecline={onDecline}>
      <AdaptiveDpr pixelated />
      {children}
    </PerformanceMonitor>
  );
}

/**
 * Themed colors the scene needs (passed down from the ui layer so render3d stays
 * ui-import-free; ui → render3d is the allowed direction). Defaults are the dark
 * palette so <Scene/> also renders standalone (tests, storybook).
 */
export interface SceneColors {
  readonly background: string;
  readonly gridCell: string;
  readonly gridSection: string;
  readonly overlayPanel: string;
  readonly overlayBorder: string;
  readonly overlayText: string;
  readonly accent: string;
  readonly accentText: string;
  /** Translucent hand-cup color (a neutral, theme-appropriate tone). */
  readonly handCup: string;
}

const DEFAULT_SCENE_COLORS: SceneColors = {
  background: '#0b1120',
  gridCell: '#24314a',
  gridSection: '#33415a',
  overlayPanel: 'rgba(30, 41, 59, 0.82)',
  overlayBorder: '#334155',
  overlayText: '#f1f5f9',
  accent: '#3b82f6',
  accentText: '#ffffff',
  handCup: '#94a3b8',
};

/** Lights + ground grid — analytic, asset-free (DESIGN.md §6). */
function Environment({ colors }: { colors: SceneColors }): ReactElement {
  return (
    <>
      <hemisphereLight args={['#ffffff', '#334155', 0.7]} />
      <ambientLight intensity={0.45} />
      <directionalLight position={[3, 6, 4]} intensity={1.15} />
      <Grid
        position={[0, 0, 0]}
        args={[20, 20]}
        infiniteGrid
        cellSize={0.2}
        cellThickness={0.6}
        cellColor={colors.gridCell}
        sectionSize={1}
        sectionThickness={1}
        sectionColor={colors.gridSection}
        fadeDistance={18}
        fadeStrength={1.5}
      />
    </>
  );
}

/** The 3D scene view. Fills its stage cell; the timeline docks beneath it in App. */
export function Scene({
  sceneColors,
  coarsePointer = false,
  touchScroll = false,
}: {
  readonly sceneColors?: SceneColors;
  readonly coarsePointer?: boolean;
  readonly touchScroll?: boolean;
} = {}): ReactElement {
  const colors = sceneColors ?? DEFAULT_SCENE_COLORS;
  const [preset, setPreset] = useState<CameraPreset>('front');
  const setCameraView = useAppStore((state) => state.setCameraView);
  // Drive the render loop from the play state: 'always' while playing, 'demand'
  // (repaint only on request) while paused/idle — the big mobile battery/thermal win.
  const playing = useAppStore((state) => state.playing);
  // On the mobile shell the canvas is the first screenful of a scrollable page.
  const editing = useAppStore((state) => state.positionsEditorOpen);
  // Decide once; capability does not change during a session.
  const [supported] = useState(webglAvailable);

  // Clear the registered canvas element when the scene unmounts (PNG capture bridge).
  useEffect(() => () => setCanvasElement(null), []);

  if (!supported) {
    return (
      <div style={placeholderStyle(colors)} role="img" aria-label="3D scene (WebGL unavailable)">
        3D scene requires a WebGL-capable browser.
      </div>
    );
  }

  const initial = presetView('front');
  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0, width: '100%', overflow: 'hidden' }}>
      <Canvas
        // touchAction: on the mobile shell the canvas is the first screenful of a
        // scrollable page, so 'pan-y' lets a vertical one-finger swipe SCROLL THE PAGE
        // (to reach the settings below) while a horizontal one-finger drag still orbits
        // (azimuth) and two-finger still pinch-zooms/pans. While the hand-positions
        // editor is open we revert to 'none' so vertical gizmo drags move the gizmo
        // instead of scrolling. Desktop (touchScroll false) keeps 'none' exactly.
        style={{ width: '100%', height: '100%', display: 'block', touchAction: touchScroll && !editing ? 'pan-y' : 'none' }}
        frameloop={sceneFrameloop(playing)}
        dpr={[1, 2]}
        // preserveDrawingBuffer keeps the framebuffer readable after the render so
        // the "Save PNG" button's canvas.toBlob() captures the current frame
        // (DESIGN.md §6). Cost: the driver cannot discard the buffer between frames
        // — a small, constant memory/bandwidth overhead, negligible for this scene.
        gl={{ preserveDrawingBuffer: true }}
        onCreated={(state) => setCanvasElement(state.gl.domElement)}
        camera={{
          position: [initial.position[0], initial.position[1], initial.position[2]],
          fov: 50,
          near: 0.05,
          far: 100,
        }}
      >
        <color attach="background" args={[colors.background]} />
        <AdaptivePerformance>
          <Environment colors={colors} />
          <CameraRig />
          <CaptureRegistrar />
          <RepaintOnScrub />
          <Tracers />
          <HandPaths />
          <Balls />
          <Hands color={colors.handCup} />
          <WorkspaceOverlay />
          <HandGizmos coarsePointer={coarsePointer} />
          {/* Always-visible orientation triad (bottom-right corner), tracking the
              camera; shows the right-handed Z-up display frame (X/Y/Z). */}
          <Triad />
        </AdaptivePerformance>
      </Canvas>

      {/* Camera presets: top-right (DESIGN.md §6; graph toggle sits top-left, in App). */}
      <div style={presetBarStyle}>
        {CAMERA_PRESETS.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => {
              setPreset(option);
              setCameraView(presetView(option));
            }}
            aria-pressed={preset === option}
            style={presetButtonStyle(colors, preset === option)}
          >
            {CAMERA_PRESET_LABELS[option]}
          </button>
        ))}
      </div>
    </div>
  );
}

// --- Inline styling (dark-first overlays over the 3D scene) -------------------

const presetBarStyle: CSSProperties = {
  position: 'absolute',
  top: '0.55rem',
  right: '0.55rem',
  display: 'flex',
  gap: '0.3rem',
  flexWrap: 'wrap',
  justifyContent: 'flex-end',
  zIndex: 3,
};

function presetButtonStyle(colors: SceneColors, active: boolean): CSSProperties {
  return {
    padding: '0.28rem 0.55rem',
    borderRadius: '0.35rem',
    border: `1px solid ${active ? colors.accent : colors.overlayBorder}`,
    background: active ? colors.accent : colors.overlayPanel,
    fontSize: '0.75rem',
    fontWeight: 600,
    color: active ? colors.accentText : colors.overlayText,
    cursor: 'pointer',
    backdropFilter: 'blur(4px)',
  };
}

function placeholderStyle(colors: SceneColors): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    minHeight: '12rem',
    width: '100%',
    background: colors.background,
    color: colors.overlayText,
    fontSize: '0.95rem',
  };
}
