// src/ui/Settings — the Settings drawer (redesign 2026-07-10, owner requirement 8).
//
// A labeled "Settings" button (in the top bar) opens a right-side drawer holding
// everything that does not belong in the always-visible sidebar:
//   • Theme (dark default; light toggle).
//   • View: playback speed (VIEWING rescale — not tempo, DESIGN.md §2), ball
//     radius, per-ball coloring + single ball color, timeline window, trail
//     length, future ghosts.
//   • Save / Share + Audio: the existing SharePanel (URL copy, presets, JSON,
//     PNG, audio toggles + volume), rendered unchanged inside the drawer.
//
// Playback speed lives HERE while tempo/physics live in the sidebar, so the two
// are never on the same panel and can't be confused (DESIGN.md §6). The relocated
// view-control tests moved to Settings.test with these controls.

import { useState, type CSSProperties, type ReactElement } from 'react';
import {
  BALL_RADIUS_MAX,
  BALL_RADIUS_MIN,
  PLAYBACK_MAX,
  PLAYBACK_MIN,
  TRAIL_LENGTH_MAX,
  TRAIL_LENGTH_MIN,
  useAppStore,
} from '../state';
import { TIMELINE_WINDOW_MAX, TIMELINE_WINDOW_MIN } from '../state/simulation';
import { SharePanel } from './SharePanel';
import { usePalette, type Palette } from './theme';
import { Button, CheckToggle, SectionLabel, Segmented, Slider } from './widgets';

/** The view-settings body (also the unit of the Settings test). */
function ViewSettings(): ReactElement {
  const palette = usePalette();
  const playbackSpeed = useAppStore((state) => state.playbackSpeed);
  const ballRadius = useAppStore((state) => state.ballRadius);
  const orbitColoring = useAppStore((state) => state.orbitColoring);
  const ballColor = useAppStore((state) => state.ballColor);
  const timelineWindow = useAppStore((state) => state.timelineWindow);
  const trailLength = useAppStore((state) => state.trailLength);
  const ghostsEnabled = useAppStore((state) => state.ghostsEnabled);

  const setPlaybackSpeed = useAppStore((state) => state.setPlaybackSpeed);
  const setBallRadius = useAppStore((state) => state.setBallRadius);
  const toggleOrbitColoring = useAppStore((state) => state.toggleOrbitColoring);
  const setBallColor = useAppStore((state) => state.setBallColor);
  const setTimelineWindow = useAppStore((state) => state.setTimelineWindow);
  const setTrailLength = useAppStore((state) => state.setTrailLength);
  const toggleGhosts = useAppStore((state) => state.toggleGhosts);

  return (
    <section style={groupStyle(palette)}>
      <SectionLabel>View</SectionLabel>
      <Slider
        label="Playback speed"
        value={playbackSpeed}
        min={PLAYBACK_MIN}
        max={PLAYBACK_MAX}
        scale="linear"
        readout={`${playbackSpeed.toFixed(2)}× (viewing)`}
        onChange={setPlaybackSpeed}
      />
      <Slider
        label="Ball radius"
        value={ballRadius}
        min={BALL_RADIUS_MIN}
        max={BALL_RADIUS_MAX}
        scale="linear"
        readout={`${(ballRadius * 100).toFixed(1)} cm`}
        onChange={setBallRadius}
      />
      <Slider
        label="Timeline window"
        value={timelineWindow}
        min={TIMELINE_WINDOW_MIN}
        max={TIMELINE_WINDOW_MAX}
        scale="linear"
        readout={`${timelineWindow.toFixed(1)} s`}
        onChange={setTimelineWindow}
      />
      <Slider
        label="Trail length"
        value={trailLength}
        min={TRAIL_LENGTH_MIN}
        max={TRAIL_LENGTH_MAX}
        scale="linear"
        readout={`${trailLength.toFixed(2)} s`}
        onChange={setTrailLength}
      />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem 1rem', alignItems: 'center' }}>
        <CheckToggle
          label="Colour balls individually"
          checked={orbitColoring}
          onChange={toggleOrbitColoring}
        />
        <CheckToggle label="Future ghosts" checked={ghostsEnabled} onChange={toggleGhosts} />
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem',
            fontWeight: 600,
            fontSize: '0.8rem',
            color: palette.textPrimary,
          }}
        >
          <span>Ball color</span>
          <input
            type="color"
            value={ballColor}
            aria-label="Ball color"
            disabled={orbitColoring}
            onChange={(event) => setBallColor(event.target.value)}
            style={{ width: '2.4rem', height: '1.7rem', padding: 0, cursor: 'pointer', background: 'none', border: 'none' }}
          />
        </label>
      </div>
    </section>
  );
}

/** The Settings button + its right-side drawer (owns its open state). */
export function Settings(): ReactElement {
  const palette = usePalette();
  const theme = useAppStore((state) => state.theme);
  const toggleTheme = useAppStore((state) => state.toggleTheme);
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)} ariaLabel="Open settings" title="Settings">
        ⚙ Settings
      </Button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Settings"
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: palette.overlayBackdrop,
            display: 'flex',
            justifyContent: 'flex-end',
            zIndex: 200,
          }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              width: 'min(28rem, 100%)',
              height: '100%',
              background: palette.appBg,
              borderLeft: `1px solid ${palette.border}`,
              boxShadow: palette.shadow,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '0.5rem',
                padding: '0.8rem 1rem',
                borderBottom: `1px solid ${palette.border}`,
              }}
            >
              <h2 style={{ margin: 0, fontSize: '1rem', color: palette.textPrimary }}>Settings</h2>
              <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                <Segmented<'dark' | 'light'>
                  label="Theme"
                  value={theme}
                  options={[
                    { value: 'dark', label: 'Dark' },
                    { value: 'light', label: 'Light' },
                  ]}
                  onChange={(value) => {
                    if (value !== theme) {
                      toggleTheme();
                    }
                  }}
                />
                <Button onClick={() => setOpen(false)} ariaLabel="Close settings" variant="ghost">
                  ✕
                </Button>
              </div>
            </div>

            <div
              style={{
                padding: '0.9rem 1rem',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.8rem',
              }}
            >
              <ViewSettings />
              <SharePanel />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function groupStyle(palette: Palette): CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
    padding: '0.7rem 0.75rem',
    background: palette.panel,
    borderRadius: '0.55rem',
    border: `1px solid ${palette.border}`,
  };
}
