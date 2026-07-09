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
} from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Grid, OrbitControls } from '@react-three/drei';
import { Balls } from './Balls';
import { Tracers } from './Tracers';
import { HandGizmos } from './HandGizmos';
import { useAppStore } from '../state';
import { setCameraSampler, setCanvasElement } from '../state/sceneBridge';
import type { CameraPose } from '../state/codec';
import {
  CAMERA_PRESETS,
  CAMERA_PRESET_LABELS,
  presetView,
  type CameraPreset,
} from './camera';

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
 */
function CameraRig(): ReactElement {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const camera = useThree((state) => state.camera);
  const cameraView = useAppStore((state) => state.cameraView);

  useEffect(() => {
    camera.position.set(cameraView.position[0], cameraView.position[1], cameraView.position[2]);
    const orbit = controls.current;
    if (orbit) {
      orbit.target.set(cameraView.target[0], cameraView.target[1], cameraView.target[2]);
      orbit.update();
    } else {
      camera.lookAt(cameraView.target[0], cameraView.target[1], cameraView.target[2]);
    }
  }, [cameraView, camera]);

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
      minDistance={0.4}
      maxDistance={20}
    />
  );
}

/** Lights + ground grid — analytic, asset-free (DESIGN.md §6). */
function Environment(): ReactElement {
  return (
    <>
      <hemisphereLight args={['#ffffff', '#9aa4b2', 0.8]} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[3, 6, 4]} intensity={1.1} />
      <Grid
        position={[0, 0, 0]}
        args={[20, 20]}
        infiniteGrid
        cellSize={0.2}
        cellThickness={0.6}
        cellColor="#c8cdd6"
        sectionSize={1}
        sectionThickness={1}
        sectionColor="#a2acbd"
        fadeDistance={18}
        fadeStrength={1.5}
      />
    </>
  );
}

/** The 3D scene view. */
export function Scene(): ReactElement {
  const [preset, setPreset] = useState<CameraPreset>('front');
  const setCameraView = useAppStore((state) => state.setCameraView);
  // Decide once; capability does not change during a session.
  const [supported] = useState(webglAvailable);

  // Clear the registered canvas element when the scene unmounts (PNG capture bridge).
  useEffect(() => () => setCanvasElement(null), []);

  if (!supported) {
    return (
      <div style={placeholderStyle} role="img" aria-label="3D scene (WebGL unavailable)">
        3D scene requires a WebGL-capable browser.
      </div>
    );
  }

  const initial = presetView('front');
  return (
    <div style={sceneContainerStyle}>
      <Canvas
        style={{ width: '100%', height: '100%', display: 'block' }}
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
        <color attach="background" args={['#eef1f5']} />
        <Environment />
        <CameraRig />
        <Tracers />
        <Balls />
        <HandGizmos />
      </Canvas>

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
            style={{
              ...presetButtonStyle,
              ...(preset === option ? presetButtonActiveStyle : null),
            }}
          >
            {CAMERA_PRESET_LABELS[option]}
          </button>
        ))}
      </div>
    </div>
  );
}

// --- Inline styling (matches the light shell of the Phase 3 UI) --------------

const sceneContainerStyle: CSSProperties = {
  position: 'relative',
  width: '100%',
  height: 'min(60vh, 34rem)',
  minHeight: '20rem',
  borderRadius: '0.5rem',
  overflow: 'hidden',
  border: '1px solid #d5dae2',
  background: '#eef1f5',
};

const presetBarStyle: CSSProperties = {
  position: 'absolute',
  top: '0.6rem',
  right: '0.6rem',
  display: 'flex',
  gap: '0.35rem',
  flexWrap: 'wrap',
  justifyContent: 'flex-end',
};

const presetButtonStyle: CSSProperties = {
  padding: '0.3rem 0.6rem',
  borderRadius: '0.35rem',
  border: '1px solid #c8cdd6',
  background: 'rgba(255, 255, 255, 0.9)',
  fontSize: '0.8rem',
  fontWeight: 600,
  color: '#3b4252',
  cursor: 'pointer',
};

const presetButtonActiveStyle: CSSProperties = {
  background: '#2f6fed',
  borderColor: '#2f6fed',
  color: '#ffffff',
};

const placeholderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '100%',
  height: 'min(60vh, 34rem)',
  minHeight: '20rem',
  borderRadius: '0.5rem',
  border: '1px dashed #c8cdd6',
  background: '#f4f6f9',
  color: '#5b6472',
  fontSize: '0.95rem',
};
