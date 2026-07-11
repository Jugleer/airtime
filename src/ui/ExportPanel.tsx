// src/ui/ExportPanel — the "Export GIF…" trigger button and the lazy boundary in
// front of the heavy export dialog (DESIGN.md §1 GIF/video export).
//
// This file is intentionally lightweight: it does NOT import src/export, so the
// rarely-used export path (gifenc + WebM muxer + the offline capture loop) stays out
// of the main bundle. Clicking "Export GIF…" mounts ui/ExportDialog via React.lazy,
// which pulls the export code as a separate chunk on first open. The button itself is
// always present (the primary/always-available format is GIF; the dialog offers WebM
// too when the browser supports WebCodecs). Labeled "Export GIF…" so it is not
// confused with the adjacent "Export JSON" in SharePanel.

import { lazy, Suspense, useState, type CSSProperties, type ReactElement } from 'react';
import { usePalette, type Palette } from './theme';
import { Button } from './widgets';

// Code-split: the export dialog and its src/export dependencies become their own
// chunk, downloaded only when the user first opens the dialog.
const ExportDialog = lazy(() => import('./ExportDialog'));

export function ExportPanel(): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Export GIF…</Button>
      {open ? (
        <Suspense fallback={<ExportDialogFallback />}>
          <ExportDialog onClose={() => setOpen(false)} />
        </Suspense>
      ) : null}
    </>
  );
}

/** Minimal non-darkening placeholder shown for the (brief) chunk load on first open. */
function ExportDialogFallback(): ReactElement {
  const palette = usePalette();
  return (
    <div style={overlayStyle} role="status" aria-label="Loading export">
      <div style={fallbackCardStyle(palette)}>Preparing export…</div>
    </div>
  );
}

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '1.5rem',
  background: 'transparent',
  zIndex: 320,
};

function fallbackCardStyle(palette: Palette): CSSProperties {
  return {
    background: palette.panel,
    borderRadius: '0.7rem',
    border: `1px solid ${palette.borderStrong}`,
    boxShadow: palette.shadow,
    padding: '0.9rem 1.1rem',
    color: palette.textSecondary,
    fontSize: '0.85rem',
  };
}
