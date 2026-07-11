// src/ui/Transport — the prominent play/pause + restart transport (redesign
// 2026-07-10, owner requirement 9: "prominent, near the scene/timeline"). Docked
// at the left of the timeline strip below the 3D scene. Relocated from Controls;
// the play/pause store-wiring test moved to Transport.test with it.

import type { ReactElement } from 'react';
import { useAppStore } from '../state';
import { usePalette } from './theme';
import { buttonStyle } from './widgets';

export function Transport(): ReactElement {
  const palette = usePalette();
  const playing = useAppStore((state) => state.playing);
  const togglePlaying = useAppStore((state) => state.togglePlaying);
  const restart = useAppStore((state) => state.restart);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
      <button
        type="button"
        onClick={togglePlaying}
        aria-label={playing ? 'Pause' : 'Play'}
        aria-pressed={playing}
        title={playing ? 'Pause' : 'Play'}
        style={{
          ...buttonStyle(palette, 'primary'),
          width: '2.3rem',
          height: '2.1rem',
          padding: 0,
          fontSize: '0.95rem',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span aria-hidden>{playing ? '❚❚' : '►'}</span>
      </button>
      <button
        type="button"
        onClick={restart}
        aria-label="Restart"
        title="Restart from current settings (rebuild at t = 0)"
        style={{
          ...buttonStyle(palette, 'default'),
          width: '2.3rem',
          height: '2.1rem',
          padding: 0,
          fontSize: '1.05rem',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span aria-hidden>↺</span>
      </button>
    </div>
  );
}
