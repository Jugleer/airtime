// src/ui/ExportDialog — the "Export animation" dialog body (DESIGN.md §1 deferred
// GIF/video export, now built). This is the HEAVY half of the export UI: it statically
// imports src/export (gifenc + the WebM muxer + the offline capture loop), so it is
// code-split behind React.lazy in ui/ExportPanel and only downloaded when the user
// opens the dialog — keeping the rarely-used export path out of the main bundle.
//
// A small floating card that does NOT dim the scene (the user sees exactly what they
// are exporting). It mounts only while open, owns the export form / progress / blob
// download, and calls `onClose` to dismiss (the parent owns the open flag). Escape and
// an outside click close it too, but never mid-export — Cancel handles that.

import {
  useEffect,
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
import { useModalFocus } from './useModalFocus';
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

/** The export dialog. Mounted only while open; `onClose` dismisses it (never while running). */
export default function ExportDialog({ onClose }: { onClose(): void }): ReactElement {
  const palette = usePalette();
  const [options, setOptions] = useState<ExportOptions>(DEFAULT_EXPORT_OPTIONS);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const cancelRef = useRef<ExportCancel>({ cancelled: false });
  // Move focus into the card on mount, restore it to the "Export GIF…" button on unmount.
  const dialogRef = useModalFocus<HTMLDivElement>(true);

  // WebM availability needs an async codec probe (VideoEncoder.isConfigSupported):
  // iOS Safari exposes the WebCodecs types but cannot actually encode VP8/VP9, so
  // presence-only detection would show a WebM tab that fails at encode time. Probe
  // once when the dialog opens; start hidden (GIF-only) until the probe resolves.
  const [webmSupported, setWebmSupported] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void isWebmExportSupported().then((supported) => {
      if (!cancelled) {
        setWebmSupported(supported);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Live "≈ N frames" estimate from the spatial period (one loop = periodBeats·τ_b).
  const spatialPeriodBeats = useAppStore((state) => state.sim.spatialPeriodBeats);
  const beatPeriod = useAppStore((state) => state.baseParams.beatPeriod);
  const loopDuration = spatialPeriodBeats * beatPeriod;
  const frameEstimate = estimateFrameCount(loopDuration, options.loops, options.fps);
  const secondsEstimate = loopDuration * options.loops;

  // Escape closes the dialog (but never mid-export — Cancel handles that).
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && phase !== 'running') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, onClose]);

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
    // Non-darkening: a transparent full-screen layer that only catches an outside
    // click; the scene stays fully visible behind the card.
    <div
      style={overlayStyle}
      onClick={() => {
        if (phase !== 'running') {
          onClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="false"
        aria-label="Export animation"
        tabIndex={-1}
        style={cardStyle(palette)}
        onClick={(event) => event.stopPropagation()}
      >
        <div style={headerStyle(palette)}>
          <SectionLabel>Export animation</SectionLabel>
          <button
            type="button"
            onClick={onClose}
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
    maxHeight: '85vh',
    display: 'flex',
    flexDirection: 'column',
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
  overflowY: 'auto',
  minHeight: 0,
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
