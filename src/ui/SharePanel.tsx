// src/ui/SharePanel — save / share + audio controls (DESIGN.md §6, Phase 9).
//
// - Copy share link: builds the versioned URL from the current config (including
//   the live camera), copies it to the clipboard (with a visible fallback field),
//   and syncs the address bar via history.replaceState. Button-only sync (no live
//   per-frame URL churn) — cheaper and documented in the codec module.
// - Save PNG: grabs the WebGL canvas (via the scene bridge) and downloads it.
// - Presets: named localStorage saves (save / load / delete) storing the same
//   config payload, plus JSON file export and import (with a clear error on bad
//   JSON). All localStorage access stays in the state layer.
// - Audio: master toggle, catch-tick toggle, and a volume slider.

import { useRef, useState, type CSSProperties, type ReactElement } from 'react';
import {
  AUDIO_VOLUME_MAX,
  AUDIO_VOLUME_MIN,
  useAppStore,
} from '../state';
import { encodeConfig, isShareConfigLike } from '../state/codec';
import { getCanvasElement } from '../state/sceneBridge';

/** Trigger a browser download of a Blob (a client-side download, not server output). */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoke on the next tick so the click's navigation has consumed the URL.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function SharePanel(): ReactElement {
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
    // Button-only address-bar sync (documented in codec): reflect the shared state
    // in the URL without live per-frame history churn.
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
    // preserveDrawingBuffer (set on the Canvas) keeps the last frame readable.
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
    <section style={panelStyle} aria-label="Save, share and audio">
      <h2 style={{ margin: 0, fontSize: '1rem', color: '#3b4252' }}>Save, share &amp; audio</h2>

      {/* Share / capture actions. */}
      <div style={rowStyle}>
        <button type="button" onClick={copyLink} style={buttonStyle}>
          Copy share link
        </button>
        <button type="button" onClick={savePng} style={buttonStyle}>
          Save PNG
        </button>
        <button type="button" onClick={exportJson} style={buttonStyle}>
          Export JSON
        </button>
        <button type="button" onClick={() => fileInputRef.current?.click()} style={buttonStyle}>
          Import JSON
        </button>
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
            event.target.value = ''; // allow re-importing the same file
          }}
        />
      </div>

      {shareUrl !== null ? (
        <input
          type="text"
          readOnly
          value={shareUrl}
          aria-label="Share link"
          onFocus={(event) => event.target.select()}
          style={urlFieldStyle}
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
          style={nameFieldStyle}
        />
        <button type="button" onClick={onSavePreset} style={buttonStyle}>
          Save preset
        </button>
      </div>

      {presetNames.length > 0 ? (
        <ul style={presetListStyle}>
          {presetNames.map((name) => (
            <li key={name} style={presetItemStyle}>
              <span style={{ fontWeight: 600 }}>{name}</span>
              <span style={{ display: 'flex', gap: '0.35rem' }}>
                <button
                  type="button"
                  onClick={() => {
                    loadPreset(name);
                    setMessage(`Loaded preset "${name}".`);
                  }}
                  style={smallButtonStyle}
                >
                  Load
                </button>
                <button
                  type="button"
                  aria-label={`Delete preset ${name}`}
                  onClick={() => {
                    deletePreset(name);
                    setMessage(`Deleted preset "${name}".`);
                  }}
                  style={smallButtonStyle}
                >
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p style={{ margin: 0, color: '#8a93a2', fontSize: '0.85rem' }}>
          No saved presets yet.
        </p>
      )}

      {/* Audio ticks. */}
      <h3 style={sectionHeadingStyle}>Audio ticks</h3>
      <div style={rowStyle}>
        <label style={checkboxLabelStyle}>
          <input type="checkbox" checked={audioEnabled} onChange={toggleAudio} />
          <span>Enable ticks</span>
        </label>
        <label style={checkboxLabelStyle}>
          <input
            type="checkbox"
            checked={catchTickEnabled}
            disabled={!audioEnabled}
            onChange={toggleCatchTick}
          />
          <span>Catch tick</span>
        </label>
        <label style={{ ...checkboxLabelStyle, flex: '1 1 12rem' }}>
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
        <p role="status" style={{ margin: 0, color: '#3b7d4f', fontSize: '0.85rem' }}>
          {message}
        </p>
      ) : null}
    </section>
  );
}

// --- Inline styling ----------------------------------------------------------

const panelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.6rem',
  padding: '0.75rem',
  background: '#ffffff',
  borderRadius: '0.6rem',
  border: '1px solid #dfe3ea',
  width: '100%',
};

const rowStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.5rem',
  alignItems: 'center',
};

const buttonStyle: CSSProperties = {
  padding: '0.4rem 0.9rem',
  borderRadius: '0.4rem',
  border: '1px solid #c8cdd6',
  background: '#ffffff',
  fontWeight: 600,
  fontSize: '0.85rem',
  cursor: 'pointer',
};

const smallButtonStyle: CSSProperties = {
  padding: '0.2rem 0.6rem',
  borderRadius: '0.35rem',
  border: '1px solid #c8cdd6',
  background: '#ffffff',
  fontWeight: 600,
  fontSize: '0.8rem',
  cursor: 'pointer',
};

const urlFieldStyle: CSSProperties = {
  width: '100%',
  padding: '0.4rem 0.5rem',
  borderRadius: '0.4rem',
  border: '1px solid #c8cdd6',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: '0.8rem',
  color: '#3b4252',
};

const nameFieldStyle: CSSProperties = {
  padding: '0.4rem 0.5rem',
  borderRadius: '0.4rem',
  border: '1px solid #c8cdd6',
  fontSize: '0.9rem',
  flex: '1 1 10rem',
};

const presetListStyle: CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '0.3rem',
};

const presetItemStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.5rem',
  padding: '0.3rem 0.5rem',
  borderRadius: '0.4rem',
  background: '#f4f6f9',
  fontSize: '0.9rem',
};

const sectionHeadingStyle: CSSProperties = {
  margin: '0.25rem 0 0',
  fontSize: '0.8rem',
  fontWeight: 700,
  letterSpacing: '0.03em',
  textTransform: 'uppercase',
  color: '#6b7280',
};

const checkboxLabelStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.4rem',
  fontWeight: 600,
  fontSize: '0.9rem',
};
