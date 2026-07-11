// src/ui/WorkspacePanel — the hand-workspace editor popup (owner feature
// 2026-07-11; orchestrator ruling 5). A non-darkening modal (Escape closes, like the
// app's existing panel idioms) launched from the "Workspace…" button in Controls'
// Hands & geometry group. It edits the ONE shared workspace spec (ruling 2):
//   • a small self-contained r3f preview — a representative cup at center inside the
//     translucent + wireframe volume, with the orientation triad (WebGL-guarded so
//     it degrades to a placeholder in jsdom / no-WebGL, like <Scene>);
//   • a shape selector (sphere / cube / tetra / STL upload);
//   • X / Y / Z half-extent sliders labeled in the DISPLAY frame (X along the hand
//     line, Y front↔back, Z up — ruling 3);
//   • an enabled toggle and a reset-to-default.
//
// The volume is ADVISORY (ruling 1): editing it never rebuilds the sim or moves any
// hand — it only reshapes the overlay the main scene draws (render3d/WorkspaceOverlay).

import { useEffect, useState, type CSSProperties, type ReactElement } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useAppStore } from '../state';
import {
  DEFAULT_WORKSPACE,
  parseStl,
  WORKSPACE_PRIMITIVE_KINDS,
  WORKSPACE_SCALE_MAX,
  WORKSPACE_SCALE_MIN,
  type WorkspaceScale,
  type WorkspaceShapeKind,
} from '../workspace';
import { WorkspaceShapeView } from '../render3d/WorkspaceOverlay';
import { Triad } from '../render3d/Triad';
import { usePalette, type Palette } from './theme';
import { useModalFocus } from './useModalFocus';
import { Button, CheckToggle, SectionLabel, Slider } from './widgets';

/** Whether a WebGL context can be created (false in jsdom); mirrors Scene's guard. */
function webglAvailable(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return false;
  }
  const w = window as unknown as { WebGLRenderingContext?: unknown; WebGL2RenderingContext?: unknown };
  if (typeof w.WebGLRenderingContext === 'undefined' && typeof w.WebGL2RenderingContext === 'undefined') {
    return false;
  }
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

const SHAPE_LABELS: Record<WorkspaceShapeKind, string> = {
  sphere: 'Sphere',
  cube: 'Cube',
  tetra: 'Pyramid',
  stl: 'STL',
};

/** Display-frame axis descriptions for the three half-extent sliders (ruling 3). */
const AXES: readonly { readonly key: keyof WorkspaceScale; readonly label: string }[] = [
  { key: 'x', label: 'Size X (along the hands)' },
  { key: 'y', label: 'Size Y (front–back)' },
  { key: 'z', label: 'Size Z (up)' },
];

/** The small r3f preview scene: a representative cup + the volume + a triad. */
function Preview(): ReactElement {
  const palette = usePalette();
  const workspace = useAppStore((state) => state.workspace);
  const mesh = useAppStore((state) => state.workspaceMesh);
  const [supported] = useState(webglAvailable);

  if (!supported) {
    return (
      <div style={previewPlaceholderStyle(palette)} role="img" aria-label="Workspace preview (WebGL unavailable)">
        Preview needs a WebGL-capable browser.
      </div>
    );
  }
  return (
    <div style={{ height: '13rem', borderRadius: '0.5rem', overflow: 'hidden', border: `1px solid ${palette.border}` }}>
      <Canvas dpr={[1, 2]} camera={{ position: [1.5, 1.1, 1.9], fov: 50, near: 0.02, far: 50 }}>
        <color attach="background" args={[palette.sceneBg]} />
        <hemisphereLight args={['#ffffff', '#334155', 0.8]} />
        <ambientLight intensity={0.5} />
        <directionalLight position={[3, 6, 4]} intensity={1.1} />
        {/* A representative hand cup at the center (a bowl opening upward, y-up). */}
        <mesh position={[0, 0, 0]}>
          <sphereGeometry args={[0.06, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2]} />
          <meshStandardMaterial color={palette.textSecondary} side={2} transparent opacity={0.85} roughness={0.6} />
        </mesh>
        <WorkspaceShapeView kind={workspace.kind} mesh={mesh} scale={workspace.scale} center={[0, 0, 0]} />
        <Triad />
        <OrbitControls enablePan={false} minDistance={0.4} maxDistance={12} />
      </Canvas>
    </div>
  );
}

/** The workspace editor panel body (exported for testing without the launcher). */
export function WorkspacePanel({ onClose }: { onClose(): void }): ReactElement {
  const palette = usePalette();
  const workspace = useAppStore((state) => state.workspace);
  const mesh = useAppStore((state) => state.workspaceMesh);
  const note = useAppStore((state) => state.workspaceNote);
  const setWorkspaceKind = useAppStore((state) => state.setWorkspaceKind);
  const setWorkspaceScaleAxis = useAppStore((state) => state.setWorkspaceScaleAxis);
  const setWorkspaceEnabled = useAppStore((state) => state.setWorkspaceEnabled);
  const setWorkspaceMesh = useAppStore((state) => state.setWorkspaceMesh);
  const resetWorkspace = useAppStore((state) => state.resetWorkspace);

  const [stlError, setStlError] = useState<string | null>(null);
  // The panel mounts only while open, so focus into it on mount and restore to the
  // "Workspace…" launcher on unmount (open is constant-true for this subtree).
  const dialogRef = useModalFocus<HTMLDivElement>(true);

  // Escape closes (standard dialog dismissal); only while mounted.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleStlFile = async (file: File | undefined): Promise<void> => {
    setStlError(null);
    if (!file) {
      return;
    }
    try {
      const buffer = await file.arrayBuffer();
      const parsed = parseStl(buffer);
      if (parsed.triangleCount === 0) {
        setStlError(parsed.warning);
        return;
      }
      setWorkspaceMesh(parsed); // switches the kind to 'stl'
    } catch {
      setStlError('That file could not be read as an STL.');
    }
  };

  const isDefault =
    workspace.kind === DEFAULT_WORKSPACE.kind &&
    workspace.enabled === DEFAULT_WORKSPACE.enabled &&
    workspace.scale.x === DEFAULT_WORKSPACE.scale.x &&
    workspace.scale.y === DEFAULT_WORKSPACE.scale.y &&
    workspace.scale.z === DEFAULT_WORKSPACE.scale.z &&
    mesh === null;

  return (
    <div style={backdropStyle} onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Hand workspace"
        tabIndex={-1}
        style={panelStyle(palette)}
        onClick={(event) => event.stopPropagation()}
      >
        <div style={headerStyle(palette)}>
          <h3 style={{ margin: 0, color: palette.textPrimary, fontSize: '1rem' }}>Hand workspace</h3>
          <button type="button" onClick={onClose} aria-label="Close workspace editor" style={closeButtonStyle(palette)}>
            ×
          </button>
        </div>

        <div style={{ padding: '0.85rem 1rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <p style={{ margin: 0, color: palette.textMuted, fontSize: '0.75rem', lineHeight: 1.45 }}>
            An advisory volume each hand may move within, centered on the hand. It never moves the
            hands — it flags where the hand path leaves the volume (red spans + a per-hand badge in
            the scene).
          </p>

          <Preview />

          <CheckToggle
            label="Show workspace in the scene"
            checked={workspace.enabled}
            defaultChecked={DEFAULT_WORKSPACE.enabled}
            onChange={() => setWorkspaceEnabled(!workspace.enabled)}
          />

          <div>
            <SectionLabel>Shape</SectionLabel>
            <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', marginTop: '0.35rem' }}>
              {WORKSPACE_PRIMITIVE_KINDS.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  aria-label={`Shape: ${SHAPE_LABELS[kind]}`}
                  aria-pressed={workspace.kind === kind}
                  onClick={() => setWorkspaceKind(kind)}
                  style={shapeButtonStyle(palette, workspace.kind === kind)}
                >
                  {SHAPE_LABELS[kind]}
                </button>
              ))}
              {mesh ? (
                <button
                  type="button"
                  aria-label="Shape: STL"
                  aria-pressed={workspace.kind === 'stl'}
                  onClick={() => setWorkspaceKind('stl')}
                  style={shapeButtonStyle(palette, workspace.kind === 'stl')}
                >
                  STL
                </button>
              ) : null}
            </div>
          </div>

          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            <SectionLabel>Upload STL (session only)</SectionLabel>
            <input
              type="file"
              accept=".stl,model/stl,application/sla,application/vnd.ms-pki.stl"
              aria-label="Upload STL file"
              onChange={(event) => void handleStlFile(event.target.files?.[0])}
              style={{ fontSize: '0.78rem', color: palette.textSecondary }}
            />
          </label>
          {mesh ? (
            <p style={{ margin: 0, fontSize: '0.72rem', color: palette.textMuted }}>
              STL loaded: {mesh.triangleCount} triangles
              {mesh.watertight
                ? ''
                : ' · not watertight — the muted bounding box shows the region treated as inside'}
              .
            </p>
          ) : null}
          {stlError ? (
            <p role="alert" style={{ margin: 0, fontSize: '0.74rem', color: palette.red }}>
              {stlError}
            </p>
          ) : null}
          {note ? (
            <p role="note" style={{ margin: 0, fontSize: '0.74rem', color: palette.amber, lineHeight: 1.4 }}>
              {note}
            </p>
          ) : null}

          <div>
            <SectionLabel>Size (per-axis half-extent, display frame)</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginTop: '0.35rem' }}>
              {AXES.map((axis) => (
                <Slider
                  key={axis.key}
                  label={axis.label}
                  value={workspace.scale[axis.key]}
                  min={WORKSPACE_SCALE_MIN}
                  max={WORKSPACE_SCALE_MAX}
                  scale="linear"
                  readout={`${(workspace.scale[axis.key] * 100).toFixed(0)} cm`}
                  defaultValue={DEFAULT_WORKSPACE.scale[axis.key]}
                  onChange={(value) => setWorkspaceScaleAxis(axis.key, value)}
                />
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={resetWorkspace} disabled={isDefault} ariaLabel="Reset workspace to default">
              ↺ Reset workspace
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The launch button (in Controls' Hands & geometry group) + the popup it mounts. */
export function WorkspaceButton(): ReactElement {
  const palette = usePalette();
  const [open, setOpen] = useState(false);
  const enabled = useAppStore((state) => state.workspace.enabled);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open the hand workspace editor"
        title="Configure the bounding volume each hand may move within"
        style={launchButtonStyle(palette, enabled)}
      >
        Workspace…{enabled ? ' ●' : ''}
      </button>
      {open ? <WorkspacePanel onClose={() => setOpen(false)} /> : null}
    </>
  );
}

// --- Inline styling (theme-aware; non-darkening backdrop, ruling 5) -------------

/** Transparent full-screen click-catcher — closes on outside click WITHOUT dimming
 *  the scene behind it (ruling 5: non-darkening). */
const backdropStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'transparent',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '1.5rem',
  zIndex: 320,
};

function panelStyle(palette: Palette): CSSProperties {
  return {
    background: palette.panel,
    borderRadius: '0.7rem',
    border: `1px solid ${palette.border}`,
    width: '22rem',
    maxWidth: '100%',
    maxHeight: '88vh',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: palette.shadow,
  };
}

function headerStyle(palette: Palette): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0.75rem 1rem',
    borderBottom: `1px solid ${palette.border}`,
  };
}

function closeButtonStyle(palette: Palette): CSSProperties {
  return {
    width: '1.8rem',
    height: '1.8rem',
    borderRadius: '0.4rem',
    border: `1px solid ${palette.border}`,
    background: palette.panelAlt,
    fontSize: '1.2rem',
    lineHeight: 1,
    cursor: 'pointer',
    color: palette.textSecondary,
  };
}

function launchButtonStyle(palette: Palette, active: boolean): CSSProperties {
  return {
    padding: '0.4rem 0.7rem',
    borderRadius: '0.4rem',
    border: `1px solid ${active ? palette.accent : palette.border}`,
    background: active ? palette.accent : palette.panelAlt,
    color: active ? palette.accentText : palette.textPrimary,
    fontWeight: 600,
    fontSize: '0.8rem',
    cursor: 'pointer',
    alignSelf: 'flex-start',
  };
}

function shapeButtonStyle(palette: Palette, active: boolean): CSSProperties {
  return {
    padding: '0.32rem 0.6rem',
    borderRadius: '0.4rem',
    border: `1px solid ${active ? palette.accent : palette.border}`,
    background: active ? palette.accent : palette.panelAlt,
    color: active ? palette.accentText : palette.textSecondary,
    fontWeight: 600,
    fontSize: '0.78rem',
    cursor: 'pointer',
  };
}

function previewPlaceholderStyle(palette: Palette): CSSProperties {
  return {
    height: '13rem',
    borderRadius: '0.5rem',
    border: `1px solid ${palette.border}`,
    background: palette.inset,
    color: palette.textMuted,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '0.8rem',
    textAlign: 'center',
    padding: '1rem',
  };
}
