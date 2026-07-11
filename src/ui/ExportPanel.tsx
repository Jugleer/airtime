// src/ui/ExportPanel — the "Export GIF…" button + its non-darkening dialog (DESIGN.md
// §1 deferred GIF/video export, now built). Self-contained (owns its open/running
// state, like ui/Help): a small floating card that does NOT dim the scene, so the
// user sees exactly what they are exporting. Escape closes it (matching Help / the
// pattern box). The heavy lifting — frame-exact offline render + encode — lives in
// src/export/capture; this component is the form, the progress bar, and the
// blob download.

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
} from 'react';
import { useAppStore } from '../state';
import {
  DEFAULT_EXPORT_OPTIONS,
  EXPORT_FPS_CHOICES,
  EXPORT_LOOPS_MAX,
  EXPORT_LOOPS_MIN,
  ExportCancelledError,
  ExportError,
  estimateFrameCount,
  isWebmExportSupported,
  runExport,
  type ExportCancel,
  type ExportFormat,
  type ExportFps,
  type ExportOptions,
  type ExportScale,
} from '../export';
import { usePalette, type Palette } from './theme';
import { Button, CheckToggle, SectionLabel, Segmented, Stepper } from './widgets';

/** Trigger a client-side download of a Blob (no server output; user-initiated). */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(0)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type Phase = 'idle' | 'running' | 'done';

export function ExportPanel(): ReactElement {
  const palette = usePalette();
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<ExportOptions>(DEFAULT_EXPORT_OPTIONS);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const cancelRef = useRef<ExportCancel>({ cancelled: false });

  // WebCodecs support is fixed for the session; hide WebM entirely when absent.
  const webmSupported = useMemo(() => isWebmExportSupported(), []);

  // Live "≈ N frames" estimate from the spatial period (one loop = periodBeats·τ_b).
  const spatialPeriodBeats = useAppStore((state) => state.sim.spatialPeriodBeats);
  const beatPeriod = useAppStore((state) => state.baseParams.beatPeriod);
  const loopDuration = spatialPeriodBeats * beatPeriod;
  const frameEstimate = estimateFrameCount(loopDuration, options.loops, options.fps);
  const secondsEstimate = loopDuration * options.loops;

  // Escape closes the dialog (but never mid-export — Cancel handles that).
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && phase !== 'running') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, phase]);

  const setOption = <K extends keyof ExportOptions>(key: K, value: ExportOptions[K]): void => {
    setOptions((prev) => ({ ...prev, [key]: value }));
  };

  const formatOptions: readonly { readonly value: ExportFormat; readonly label: string }[] =
    webmSupported
      ? [
          { value: 'gif', label: 'GIF' },
          { value: 'webm', label: 'WebM' },
        ]
      : [{ value: 'gif', label: 'GIF' }];

  const onExport = async (): Promise<void> => {
    setPhase('running');
    setProgress(0);
    setMessage(null);
    cancelRef.current = { cancelled: false };
    const startedAt = performance.now();
    try {
      const result = await runExport(
        options,
        (done, total) => setProgress(total > 0 ? done / total : 0),
        cancelRef.current,
      );
      downloadBlob(result.blob, result.filename);
      const elapsed = ((performance.now() - startedAt) / 1000).toFixed(1);
      setMessage(
        `Saved ${result.filename} — ${result.frameCount} frames, ${result.width}×${result.height}, ${formatBytes(result.blob.size)} in ${elapsed}s.`,
      );
      setPhase('done');
    } catch (err) {
      if (err instanceof ExportCancelledError) {
        setMessage('Export cancelled.');
      } else if (err instanceof ExportError) {
        setMessage(err.message);
      } else {
        setMessage('Export failed unexpectedly.');
      }
      setPhase('idle');
    }
  };

  const onCancel = (): void => {
    cancelRef.current.cancelled = true;
  };

  return (
    <>
      {/* GIF is the primary/always-available format; the dialog also offers WebM when the
          browser supports WebCodecs. Labeled "Export GIF…" so it is not confused with the
          adjacent "Export JSON" (finding: the bare "Export…" read as a JSON sibling). */}
      <Button onClick={() => setOpen(true)}>Export GIF…</Button>

      {open ? (
        // Non-darkening: a transparent full-screen layer that only catches an
        // outside click; the scene stays fully visible behind the card.
        <div
          style={overlayStyle}
          onClick={() => {
            if (phase !== 'running') {
              setOpen(false);
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="false"
            aria-label="Export animation"
            style={cardStyle(palette)}
            onClick={(event) => event.stopPropagation()}
          >
            <div style={headerStyle(palette)}>
              <SectionLabel>Export animation</SectionLabel>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close export"
                disabled={phase === 'running'}
                style={closeButtonStyle(palette)}
              >
                ×
              </button>
            </div>

            <div style={bodyStyle}>
              <Segmented<ExportFormat>
                label="Format"
                value={options.format}
                options={formatOptions}
                onChange={(value) => setOption('format', value)}
              />

              <Stepper
                label="Loops"
                value={options.loops}
                min={EXPORT_LOOPS_MIN}
                max={EXPORT_LOOPS_MAX}
                onChange={(value) => setOption('loops', value)}
              />

              <Segmented<string>
                label="Frames per second"
                value={String(options.fps)}
                options={EXPORT_FPS_CHOICES.map((fps) => ({ value: String(fps), label: `${fps}` }))}
                onChange={(value) => setOption('fps', Number(value) as ExportFps)}
              />

              <Segmented<string>
                label="Resolution"
                value={options.scale === 1 ? 'full' : 'half'}
                options={[
                  { value: 'full', label: 'Current size' },
                  { value: 'half', label: 'Half (0.5×)' },
                ]}
                onChange={(value) => setOption('scale', (value === 'half' ? 0.5 : 1) as ExportScale)}
              />

              <CheckToggle
                label="Turntable (one orbit)"
                checked={options.turntable}
                onChange={() => setOption('turntable', !options.turntable)}
              />

              <p style={estimateStyle(palette)} role="status">
                ≈ {frameEstimate} frames · {secondsEstimate.toFixed(2)} s loop
              </p>

              {phase === 'running' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  <div
                    role="progressbar"
                    aria-label="Export progress"
                    aria-valuenow={Math.round(progress * 100)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    style={progressTrackStyle(palette)}
                  >
                    <div style={progressFillStyle(palette, progress)} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
                    <span style={{ color: palette.textSecondary, fontSize: '0.8rem' }}>
                      Rendering… {Math.round(progress * 100)}%
                    </span>
                    <Button onClick={onCancel}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <Button variant="primary" onClick={() => void onExport()}>
                    Export {options.format.toUpperCase()}
                  </Button>
                </div>
              )}

              {message !== null ? (
                <p role="status" style={messageStyle(palette)}>
                  {message}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

// --- Inline styling (theme-aware, dark-first; deliberately non-darkening) ------

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '1.5rem',
  // No background fill — the scene stays visible (a non-darkening dialog).
  background: 'transparent',
  zIndex: 320,
};

function cardStyle(palette: Palette): CSSProperties {
  return {
    background: palette.panel,
    borderRadius: '0.7rem',
    border: `1px solid ${palette.borderStrong}`,
    width: '100%',
    maxWidth: '22rem',
    boxShadow: palette.shadow,
    pointerEvents: 'auto',
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

const bodyStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.75rem',
  padding: '0.9rem 1rem',
};

function estimateStyle(palette: Palette): CSSProperties {
  return {
    margin: 0,
    color: palette.textSecondary,
    fontSize: '0.82rem',
    fontVariantNumeric: 'tabular-nums',
  };
}

function progressTrackStyle(palette: Palette): CSSProperties {
  return {
    width: '100%',
    height: '0.55rem',
    borderRadius: '0.3rem',
    background: palette.inset,
    overflow: 'hidden',
  };
}

function progressFillStyle(palette: Palette, progress: number): CSSProperties {
  return {
    width: `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%`,
    height: '100%',
    background: palette.accent,
    transition: 'width 120ms linear',
  };
}

function messageStyle(palette: Palette): CSSProperties {
  return { margin: 0, color: palette.green, fontSize: '0.82rem' };
}

function closeButtonStyle(palette: Palette): CSSProperties {
  return {
    width: '1.7rem',
    height: '1.7rem',
    borderRadius: '0.4rem',
    border: `1px solid ${palette.border}`,
    background: palette.panelAlt,
    fontSize: '1.2rem',
    lineHeight: 1,
    cursor: 'pointer',
    color: palette.textSecondary,
  };
}
