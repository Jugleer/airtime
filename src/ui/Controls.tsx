// src/ui/Controls — the shell controls (DESIGN.md §6 settings, minimal subset).
//
// Pattern input with live validation (the core's beat-accurate error is shown
// verbatim; invalid input keeps the last valid simulation running), play/pause +
// restart, and the three sliders wired through the store to core: beat period
// (τ_b, log-scaled per DESIGN.md §7), dwell time (t_d, capped at 0.9·n_h·τ_b),
// and playback speed (a wall→sim rescale, distinct from tempo). Full words in
// labels (NOTATION.md).

import type { CSSProperties, ReactElement } from 'react';
import {
  BALL_RADIUS_MAX,
  BALL_RADIUS_MIN,
  BEAT_PERIOD_MAX,
  BEAT_PERIOD_MIN,
  DWELL_MIN,
  PLAYBACK_MAX,
  PLAYBACK_MIN,
  TRAIL_LENGTH_MAX,
  TRAIL_LENGTH_MIN,
  dwellCap,
  useAppStore,
} from '../state';
import { TIMELINE_WINDOW_MAX, TIMELINE_WINDOW_MIN } from '../state/simulation';

const SLIDER_STEPS = 1000;

interface SliderProps {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly scale?: 'linear' | 'log';
  readonly readout: string;
  onChange(value: number): void;
}

function positionOf(value: number, min: number, max: number, scale: 'linear' | 'log'): number {
  const v = Math.min(Math.max(value, min), max);
  if (scale === 'log') {
    return (Math.log(v) - Math.log(min)) / (Math.log(max) - Math.log(min));
  }
  return (v - min) / (max - min);
}

function valueOf(position: number, min: number, max: number, scale: 'linear' | 'log'): number {
  if (scale === 'log') {
    return Math.exp(Math.log(min) + position * (Math.log(max) - Math.log(min)));
  }
  return min + position * (max - min);
}

function Slider({
  label,
  value,
  min,
  max,
  scale = 'linear',
  readout,
  onChange,
}: SliderProps): ReactElement {
  const position = Math.round(positionOf(value, min, max, scale) * SLIDER_STEPS);
  return (
    <label style={sliderStyle}>
      <span style={sliderLabelRow}>
        <span>{label}</span>
        <span style={{ color: '#5b6472', fontVariantNumeric: 'tabular-nums' }}>{readout}</span>
      </span>
      <input
        type="range"
        min={0}
        max={SLIDER_STEPS}
        step={1}
        value={position}
        aria-label={label}
        onChange={(event) =>
          onChange(valueOf(event.target.valueAsNumber / SLIDER_STEPS, min, max, scale))
        }
        style={{ width: '100%' }}
      />
    </label>
  );
}

/** Verbatim first-line error text from core, plus any further collision lines. */
function errorText(messages: readonly string[]): string {
  return messages.join('  —  ');
}

export function Controls(): ReactElement {
  const pattern = useAppStore((state) => state.pattern);
  const validation = useAppStore((state) => state.validation);
  const beatPeriod = useAppStore((state) => state.beatPeriod);
  const dwellTime = useAppStore((state) => state.dwellTime);
  const playbackSpeed = useAppStore((state) => state.playbackSpeed);
  const handCount = useAppStore((state) => state.handCount);
  const ballRadius = useAppStore((state) => state.ballRadius);
  const orbitColoring = useAppStore((state) => state.orbitColoring);
  const ballColor = useAppStore((state) => state.ballColor);
  const timelineWindow = useAppStore((state) => state.timelineWindow);
  const trailLength = useAppStore((state) => state.trailLength);
  const ghostsEnabled = useAppStore((state) => state.ghostsEnabled);
  const playing = useAppStore((state) => state.playing);
  const sim = useAppStore((state) => state.sim);

  const setPattern = useAppStore((state) => state.setPattern);
  const setBeatPeriod = useAppStore((state) => state.setBeatPeriod);
  const setDwellTime = useAppStore((state) => state.setDwellTime);
  const setPlaybackSpeed = useAppStore((state) => state.setPlaybackSpeed);
  const setBallRadius = useAppStore((state) => state.setBallRadius);
  const toggleOrbitColoring = useAppStore((state) => state.toggleOrbitColoring);
  const setBallColor = useAppStore((state) => state.setBallColor);
  const setTimelineWindow = useAppStore((state) => state.setTimelineWindow);
  const setTrailLength = useAppStore((state) => state.setTrailLength);
  const toggleGhosts = useAppStore((state) => state.toggleGhosts);
  const togglePlaying = useAppStore((state) => state.togglePlaying);
  const restart = useAppStore((state) => state.restart);

  const valid = validation.ok;
  const repeatSeconds = sim.spatialPeriodBeats * beatPeriod;

  return (
    <section style={panelStyle}>
      <div style={rowStyle}>
        <label
          style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', flex: '1 1 12rem' }}
        >
          <span style={{ fontWeight: 600 }}>Pattern (siteswap)</span>
          <input
            type="text"
            value={pattern}
            aria-label="Pattern (siteswap)"
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => setPattern(event.target.value)}
            style={{
              font: '600 1.1rem ui-monospace, SFMono-Regular, Menlo, monospace',
              padding: '0.4rem 0.5rem',
              borderRadius: '0.4rem',
              border: `1px solid ${valid ? '#c8cdd6' : '#e5484d'}`,
              outline: 'none',
            }}
          />
        </label>

        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
          <button type="button" onClick={togglePlaying} aria-pressed={playing} style={buttonStyle}>
            {playing ? 'Pause' : 'Play'}
          </button>
          <button type="button" onClick={restart} style={buttonStyle}>
            Restart
          </button>
        </div>
      </div>

      {valid ? (
        <p style={{ ...statusStyle, color: '#3b7d4f' }}>
          Valid · {sim.ballCount} balls · repeats every {repeatSeconds.toFixed(2)} s
        </p>
      ) : (
        <p role="alert" style={{ ...statusStyle, color: '#c0392b' }}>
          {errorText(validation.errors.map((error) => error.message))}
        </p>
      )}

      <div style={slidersRowStyle}>
        <Slider
          label="Beat period (tempo)"
          value={beatPeriod}
          min={BEAT_PERIOD_MIN}
          max={BEAT_PERIOD_MAX}
          scale="log"
          readout={`${beatPeriod.toFixed(3)} s`}
          onChange={setBeatPeriod}
        />
        <Slider
          label="Dwell time"
          value={dwellTime}
          min={DWELL_MIN}
          max={dwellCap(handCount, beatPeriod)}
          scale="linear"
          readout={`${dwellTime.toFixed(3)} s`}
          onChange={setDwellTime}
        />
        <Slider
          label="Playback speed"
          value={playbackSpeed}
          min={PLAYBACK_MIN}
          max={PLAYBACK_MAX}
          scale="linear"
          readout={`${playbackSpeed.toFixed(2)}×`}
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
      </div>

      <div style={rowStyle}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600 }}>
          <input type="checkbox" checked={orbitColoring} onChange={toggleOrbitColoring} />
          <span>Orbit coloring</span>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600 }}>
          <input type="checkbox" checked={ghostsEnabled} onChange={toggleGhosts} />
          <span>Future ghosts</span>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600 }}>
          <span>Ball color</span>
          <input
            type="color"
            value={ballColor}
            aria-label="Ball color"
            disabled={orbitColoring}
            onChange={(event) => setBallColor(event.target.value)}
            style={{ width: '2.4rem', height: '1.6rem', padding: 0, cursor: 'pointer' }}
          />
        </label>
      </div>
    </section>
  );
}

// --- Inline styling (light, function-over-beauty; this is the debug view) ----

const panelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.6rem',
  padding: '1rem',
  background: '#f4f6f9',
  borderRadius: '0.6rem',
  border: '1px solid #dfe3ea',
};

const rowStyle: CSSProperties = {
  display: 'flex',
  gap: '1rem',
  alignItems: 'flex-end',
  flexWrap: 'wrap',
};

const slidersRowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))',
  gap: '1rem',
};

const sliderStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.3rem',
  fontSize: '0.9rem',
};

const sliderLabelRow: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '0.5rem',
  fontWeight: 600,
};

const statusStyle: CSSProperties = {
  margin: 0,
  fontSize: '0.9rem',
  fontVariantNumeric: 'tabular-nums',
  minHeight: '1.2rem',
};

const buttonStyle: CSSProperties = {
  padding: '0.45rem 1rem',
  borderRadius: '0.4rem',
  border: '1px solid #c8cdd6',
  background: '#ffffff',
  fontWeight: 600,
  cursor: 'pointer',
};
