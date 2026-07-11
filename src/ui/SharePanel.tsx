// src/ui/SharePanel — save / share + audio controls (DESIGN.md §6, Phase 9).
// Docked in the right column beneath the ladder diagram (owner 2026-07-11: the
// Settings drawer was removed so nothing hides behind a menu); the component and
// all its labels are unchanged so its standalone test still holds — only the
// styling is theme-aware (dark-first).
//
// - Copy share link: builds the versioned URL from the current config (including
//   the live camera), copies it to the clipboard (with a visible fallback field),
//   and syncs the address bar via history.replaceState.
// - Save PNG: grabs the WebGL canvas (via the scene bridge) and downloads it.
// - Presets: named localStorage saves + JSON export/import.
// - Audio: master toggle, catch-tick toggle, and a volume slider.

import { useRef, useState, type CSSProperties, type ReactElement } from 'react';
import {
  AUDIO_VOLUME_MAX,
  AUDIO_VOLUME_MIN,
  useAppStore,
} from '../state';
import { encodeConfig, isShareConfigLike } from '../state/codec';
import { getCanvasElement } from '../state/sceneBridge';
import { usePalette, type Palette } from './theme';
import { Button, SectionLabel } from './widgets';
import { ExportPanel } from './ExportPanel';

/** Trigger a browser download of a Blob (a client-side download, not server output). */
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

export function SharePanel(): ReactElement {
  const palette = usePalette();
  const currentConfig = useAppStore((state) => state.currentConfig);
  const applyConfig = useAppStore((state) => state.applyConfig);
  const savePreset = useAppStore((state) => state.savePreset);
  const loadPreset = useAppStore((state) => state.loadPreset);
  const deletePreset = useAppStore((state) => state.deletePreset);
  const presetNames = useAppStore((state) => state.presetNames);

  const audioEnabled = useAppStore((state) => state.audioEnabled);
  const catchTickEnabled = useAppStore((state) => state.catchTickEnabled);
  const audioVolume = useAppStore((state) => state.audioVolume);
  const toggleAudio = useAppStore((state) => state.toggleAudio);
  const toggleCatchTick = useAppStore((state) => state.toggleCatchTick);
  const setAudioVolume = useAppStore((state) => state.setAudioVolume);

  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [presetName, setPresetName] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const buildUrl = (): string => {
    const query = encodeConfig(currentConfig());
    const base =
      typeof window !== 'undefined'
        ? `${window.location.origin}${window.location.pathname}`
        : '';
    return `${base}?${query}`;
  };

  const copyLink = (): void => {
    const url = buildUrl();
    setShareUrl(url);
    try {
      const query = url.slice(url.indexOf('?'));
      window.history.replaceState(null, '', query);
    } catch {
      // history unavailable (rare) — the copied link still works.
    }
    const clipboard = navigator.clipboard;
    if (clipboard && typeof clipboard.writeText === 'function') {
      clipboard.writeText(url).then(
        () => setMessage('Share link copied to the clipboard.'),
        () => setMessage('Copy the link from the field below.'),
      );
    } else {
      setMessage('Copy the link from the field below.');
    }
  };

  const savePng = (): void => {
    const canvas = getCanvasElement();
    if (canvas === null) {
      setMessage('The 3D scene is not ready for capture.');
      return;
    }
    canvas.toBlob((blob) => {
      if (blob === null) {
        setMessage('PNG capture failed.');
        return;
      }
      downloadBlob(blob, 'airtime.png');
      setMessage('Saved airtime.png.');
    }, 'image/png');
  };

  const exportJson = (): void => {
    const blob = new Blob([JSON.stringify(currentConfig(), null, 2)], {
      type: 'application/json',
    });
    downloadBlob(blob, 'airtime-preset.json');
    setMessage('Exported airtime-preset.json.');
  };

  const importJson = (file: File): void => {
    file
      .text()
      .then((text) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          setMessage('Import failed: the file is not valid JSON.');
          return;
        }
        if (!isShareConfigLike(parsed)) {
          setMessage('Import failed: not a recognizable Airtime preset.');
          return;
        }
        applyConfig(parsed);
        setMessage('Imported preset applied.');
      })
      .catch(() => setMessage('Import failed: could not read the file.'));
  };

  const onSavePreset = (): void => {
    const name = presetName.trim();
    if (name === '') {
      setMessage('Enter a preset name first.');
      return;
    }
    savePreset(name);
    setPresetName('');
    setMessage(`Saved preset "${name}".`);
  };

  return (
    <section style={panelStyle(palette)} aria-label="Save, share and audio">
      <SectionLabel>Save, share &amp; audio</SectionLabel>

      {/* Link + data (JSON) actions, then the visual-capture pair. "Export GIF…" is
          grouped next to "Save PNG" (both capture the scene) and kept away from
          "Export JSON" so the two "Export" buttons don't read as siblings. */}
      <div style={rowStyle}>
        <Button onClick={copyLink}>Copy share link</Button>
        <Button onClick={exportJson}>Export JSON</Button>
        <Button onClick={() => fileInputRef.current?.click()}>Import JSON</Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          aria-label="Import preset JSON"
          style={{ display: 'none' }}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              importJson(file);
            }
            event.target.value = '';
          }}
        />
        {/* Visual-capture actions, adjacent. */}
        <Button onClick={savePng}>Save PNG</Button>
        <ExportPanel />
      </div>

      {shareUrl !== null ? (
        <input
          type="text"
          readOnly
          value={shareUrl}
          aria-label="Share link"
          onFocus={(event) => event.target.select()}
          style={urlFieldStyle(palette)}
        />
      ) : null}

      {/* Named presets (localStorage). */}
      <div style={rowStyle}>
        <input
          type="text"
          value={presetName}
          placeholder="Preset name"
          aria-label="Preset name"
          onChange={(event) => setPresetName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              onSavePreset();
            }
          }}
          style={nameFieldStyle(palette)}
        />
        <Button onClick={onSavePreset}>Save preset</Button>
      </div>

      {presetNames.length > 0 ? (
        <ul style={presetListStyle}>
          {presetNames.map((name) => (
            <li key={name} style={presetItemStyle(palette)}>
              <span style={{ fontWeight: 600, color: palette.textPrimary }}>{name}</span>
              <span style={{ display: 'flex', gap: '0.35rem' }}>
                <Button
                  onClick={() => {
                    loadPreset(name);
                    setMessage(`Loaded preset "${name}".`);
                  }}
                >
                  Load
                </Button>
                <Button
                  ariaLabel={`Delete preset ${name}`}
                  onClick={() => {
                    deletePreset(name);
                    setMessage(`Deleted preset "${name}".`);
                  }}
                >
                  Delete
                </Button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p style={{ margin: 0, color: palette.textMuted, fontSize: '0.82rem' }}>
          No saved presets yet.
        </p>
      )}

      {/* Audio ticks. */}
      <SectionLabel>Audio ticks</SectionLabel>
      <div style={rowStyle}>
        <label style={checkboxLabelStyle(palette)}>
          <input type="checkbox" checked={audioEnabled} onChange={toggleAudio} />
          <span>Enable ticks</span>
        </label>
        <label style={checkboxLabelStyle(palette, !audioEnabled)}>
          <input
            type="checkbox"
            checked={catchTickEnabled}
            disabled={!audioEnabled}
            onChange={toggleCatchTick}
          />
          <span>Catch tick</span>
        </label>
        <label style={{ ...checkboxLabelStyle(palette), flex: '1 1 11rem' }}>
          <span>Volume</span>
          <input
            type="range"
            min={AUDIO_VOLUME_MIN}
            max={AUDIO_VOLUME_MAX}
            step={0.01}
            value={audioVolume}
            disabled={!audioEnabled}
            aria-label="Audio volume"
            onChange={(event) => setAudioVolume(event.target.valueAsNumber)}
            style={{ flex: 1 }}
          />
        </label>
      </div>

      {message !== null ? (
        <p role="status" style={{ margin: 0, color: palette.green, fontSize: '0.82rem' }}>
          {message}
        </p>
      ) : null}
    </section>
  );
}

// --- Inline styling (theme-aware, dark-first) --------------------------------

function panelStyle(palette: Palette): CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.55rem',
    padding: '0.7rem 0.75rem',
    background: palette.panel,
    borderRadius: '0.55rem',
    border: `1px solid ${palette.border}`,
    width: '100%',
  };
}

const rowStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.5rem',
  alignItems: 'center',
};

function urlFieldStyle(palette: Palette): CSSProperties {
  return {
    width: '100%',
    padding: '0.4rem 0.5rem',
    borderRadius: '0.4rem',
    border: `1px solid ${palette.border}`,
    background: palette.inset,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '0.78rem',
    color: palette.textPrimary,
  };
}

function nameFieldStyle(palette: Palette): CSSProperties {
  return {
    padding: '0.4rem 0.5rem',
    borderRadius: '0.4rem',
    border: `1px solid ${palette.border}`,
    background: palette.inset,
    color: palette.textPrimary,
    fontSize: '0.88rem',
    flex: '1 1 9rem',
  };
}

const presetListStyle: CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '0.3rem',
};

function presetItemStyle(palette: Palette): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.5rem',
    padding: '0.3rem 0.5rem',
    borderRadius: '0.4rem',
    background: palette.panelAlt,
    fontSize: '0.88rem',
  };
}

function checkboxLabelStyle(palette: Palette, disabled = false): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
    fontWeight: 600,
    fontSize: '0.85rem',
    color: disabled ? palette.textMuted : palette.textPrimary,
  };
}
