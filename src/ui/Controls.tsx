// src/ui/Controls — the shell controls (DESIGN.md §6 settings).
//
// Pattern input with live validation (the core's beat-accurate error is shown
// verbatim; invalid input keeps the last valid simulation running), play/pause +
// restart, and the sliders wired through the store to core. Phase 6 adds the
// runtime physics: gravity + hold depth + carry-path toggle (all future-only via
// kinematics epochs, DESIGN.md §4.6), the n_h stepper with line/circle presets
// (full rebuild), and the hand-positions editor (numeric table + 3D gizmos). The
// UI is grouped so "Tempo (physics)" and "Playback speed (viewing)" are never
// confused. Full words in labels (NOTATION.md).

import type { CSSProperties, ReactElement } from 'react';
import {
  BALL_RADIUS_MAX,
  BALL_RADIUS_MIN,
  BEAT_PERIOD_MAX,
  BEAT_PERIOD_MIN,
  DWELL_CLAMP_BETA,
  DWELL_MIN,
  GRAVITY_MAX,
  GRAVITY_MIN,
  HAND_COUNT_MAX,
  HAND_COUNT_MIN,
  HOLD_DEPTH_MAX,
  HOLD_DEPTH_MIN,
  PLAYBACK_MAX,
  PLAYBACK_MIN,
  TRAIL_LENGTH_MAX,
  TRAIL_LENGTH_MIN,
  dwellCap,
  useAppStore,
  type CarryPathKind,
  type HandPreset,
  type HandPointKind,
} from '../state';
import { TIMELINE_WINDOW_MAX, TIMELINE_WINDOW_MIN } from '../state/simulation';
import { PATTERN_LIBRARY } from './library';

const SLIDER_STEPS = 1000;
const AMBER = '#b7791f';

interface SliderProps {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly scale?: 'linear' | 'log';
  readonly readout: string;
  readonly readoutColor?: string;
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
  readoutColor = '#5b6472',
  onChange,
}: SliderProps): ReactElement {
  const position = Math.round(positionOf(value, min, max, scale) * SLIDER_STEPS);
  return (
    <label style={sliderStyle}>
      <span style={sliderLabelRow}>
        <span>{label}</span>
        <span style={{ color: readoutColor, fontVariantNumeric: 'tabular-nums' }}>{readout}</span>
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

/**
 * Whether t_d_eff clamping is active for any airborne throw in the pattern
 * (NOTATION identity 4, DESIGN.md §4.1): the tightest bound is the smallest
 * airborne throw value h (value 1 or ≥ 3; a 2 is held, a 0 idle). Clamp is active
 * iff t_d > β·h_min·τ_b. Cheap detection — the readout turns amber when true.
 */
function dwellClampActive(values: readonly number[], dwellTime: number, beatPeriod: number): boolean {
  let hMin = Infinity;
  for (const value of values) {
    if (value !== 0 && value !== 2 && value < hMin) {
      hMin = value;
    }
  }
  if (!Number.isFinite(hMin)) {
    return false;
  }
  return dwellTime > DWELL_CLAMP_BETA * hMin * beatPeriod;
}

/** A ±stepper for an integer setting (used by the n_h control). */
function Stepper({
  label,
  value,
  min,
  max,
  onChange,
}: {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  onChange(value: number): void;
}): ReactElement {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.9rem' }}>
      <span style={{ fontWeight: 600 }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
        <button
          type="button"
          aria-label={`${label} decrease`}
          disabled={value <= min}
          onClick={() => onChange(value - 1)}
          style={stepperButtonStyle}
        >
          −
        </button>
        <span
          aria-label={label}
          style={{ minWidth: '1.5rem', textAlign: 'center', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}
        >
          {value}
        </span>
        <button
          type="button"
          aria-label={`${label} increase`}
          disabled={value >= max}
          onClick={() => onChange(value + 1)}
          style={stepperButtonStyle}
        >
          +
        </button>
      </div>
    </div>
  );
}

/** A two-option segmented toggle (preset picker, carry-path picker). */
function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  readonly label: string;
  readonly value: T;
  readonly options: readonly { readonly value: T; readonly label: string }[];
  onChange(value: T): void;
}): ReactElement {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.9rem' }}>
      <span style={{ fontWeight: 600 }}>{label}</span>
      <div style={{ display: 'flex', gap: '0.35rem' }}>
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              aria-label={`${label}: ${option.label}`}
              aria-pressed={active}
              onClick={() => onChange(option.value)}
              style={{ ...toggleButtonStyle, ...(active ? toggleButtonActiveStyle : null) }}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The x/z numeric editor for one hand's catch + throw points (y stays fixed). */
function HandPositionsTable(): ReactElement {
  const handCount = useAppStore((state) => state.handCount);
  const throwPoints = useAppStore((state) => state.handThrowPoints);
  const catchPoints = useAppStore((state) => state.handCatchPoints);
  const setHandPoint = useAppStore((state) => state.setHandPoint);

  const cell = (hand: number, kind: HandPointKind, axis: 'x' | 'z'): ReactElement => {
    const point = (kind === 'throw' ? throwPoints : catchPoints)[hand];
    const value = point ? point[axis] : 0;
    return (
      <input
        type="number"
        step={0.01}
        value={Number.isFinite(value) ? Number(value.toFixed(3)) : 0}
        aria-label={`Hand ${hand} ${kind} ${axis}`}
        onChange={(event) => {
          const next = event.target.valueAsNumber;
          if (!Number.isFinite(next) || !point) {
            return;
          }
          const x = axis === 'x' ? next : point.x;
          const z = axis === 'z' ? next : point.z;
          setHandPoint(hand, kind, x, z);
        }}
        style={numberInputStyle}
      />
    );
  };

  const rows: ReactElement[] = [];
  for (let hand = 0; hand < handCount; hand++) {
    rows.push(
      <tr key={hand}>
        <td style={tdStyle}>{hand}</td>
        <td style={tdStyle}>{cell(hand, 'catch', 'x')}</td>
        <td style={tdStyle}>{cell(hand, 'catch', 'z')}</td>
        <td style={tdStyle}>{cell(hand, 'throw', 'x')}</td>
        <td style={tdStyle}>{cell(hand, 'throw', 'z')}</td>
      </tr>,
    );
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: '0.85rem' }}>
        <thead>
          <tr>
            <th style={thStyle}>Hand</th>
            <th style={thStyle}>Catch x</th>
            <th style={thStyle}>Catch z</th>
            <th style={thStyle}>Throw x</th>
            <th style={thStyle}>Throw z</th>
          </tr>
        </thead>
        <tbody>{rows}</tbody>
      </table>
      <p style={{ margin: '0.35rem 0 0', color: '#5b6472', fontSize: '0.8rem' }}>
        Drag the green (catch) and orange (throw) markers in the 3D scene (labeled per hand:
        0C = hand 0 catch, 0T = hand 0 throw), or edit x/z here (meters; height y stays 1.00 m).
        In-flight balls keep the path they were aimed with — edits affect future throws only;
        the dashed ghost paths (always shown while this editor is open) preview the change.
      </p>
    </div>
  );
}

export function Controls(): ReactElement {
  const pattern = useAppStore((state) => state.pattern);
  const validation = useAppStore((state) => state.validation);
  const beatPeriod = useAppStore((state) => state.beatPeriod);
  const dwellTime = useAppStore((state) => state.dwellTime);
  const playbackSpeed = useAppStore((state) => state.playbackSpeed);
  const gravity = useAppStore((state) => state.gravity);
  const holdDepth = useAppStore((state) => state.holdDepth);
  const carryPathKind = useAppStore((state) => state.carryPathKind);
  const handCount = useAppStore((state) => state.handCount);
  const handPreset = useAppStore((state) => state.handPreset);
  const positionsEditorOpen = useAppStore((state) => state.positionsEditorOpen);
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
  const setGravity = useAppStore((state) => state.setGravity);
  const setHoldDepth = useAppStore((state) => state.setHoldDepth);
  const setCarryPathKind = useAppStore((state) => state.setCarryPathKind);
  const setHandCount = useAppStore((state) => state.setHandCount);
  const setHandPreset = useAppStore((state) => state.setHandPreset);
  const togglePositionsEditor = useAppStore((state) => state.togglePositionsEditor);
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
  const clampActive = dwellClampActive(sim.values, dwellTime, beatPeriod);
  // Held 2s are only physically meaningful at n_h = 2 (BUILD_LOG Phase 2 pending
  // decision). Surface a non-blocking note when a pattern with a 2 runs elsewhere.
  const heldTwoWarning = handCount !== 2 && sim.values.includes(2);

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

        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', flex: '0 1 14rem' }}>
          <span style={{ fontWeight: 600 }}>Library</span>
          <select
            aria-label="Pattern library"
            value=""
            onChange={(event) => {
              if (event.target.value) {
                setPattern(event.target.value);
              }
            }}
            style={selectStyle}
          >
            <option value="">Choose a pattern…</option>
            {PATTERN_LIBRARY.map((entry) => (
              <option key={entry.pattern} value={entry.pattern}>
                {entry.pattern} — {entry.name} ({entry.ballCount}-ball)
              </option>
            ))}
          </select>
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

      {heldTwoWarning ? (
        <p role="note" style={{ ...statusStyle, color: AMBER }}>
          Held 2s are only physically meaningful with 2 hands (pending design decision).
        </p>
      ) : null}

      {/* Tempo (physics): beat period, dwell, gravity, hold depth, carry path.
          These change the physical motion (DESIGN.md §4). */}
      <h3 style={sectionHeadingStyle}>Tempo &amp; physics</h3>
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
          readout={clampActive ? `${dwellTime.toFixed(3)} s · clamped` : `${dwellTime.toFixed(3)} s`}
          readoutColor={clampActive ? AMBER : undefined}
          onChange={setDwellTime}
        />
        <Slider
          label="Gravity"
          value={gravity}
          min={GRAVITY_MIN}
          max={GRAVITY_MAX}
          scale="linear"
          readout={`${gravity.toFixed(2)} m/s²`}
          onChange={setGravity}
        />
        <Slider
          label="Hold depth"
          value={holdDepth}
          min={HOLD_DEPTH_MIN}
          max={HOLD_DEPTH_MAX}
          scale="linear"
          readout={`${(holdDepth * 100).toFixed(1)} cm`}
          onChange={setHoldDepth}
        />
        <Segmented<CarryPathKind>
          label="Carry path"
          value={carryPathKind}
          options={[
            { value: 'quintic', label: 'Quintic' },
            { value: 'cubic', label: 'Cubic' },
          ]}
          onChange={setCarryPathKind}
        />
      </div>
      {carryPathKind === 'cubic' ? (
        <p style={{ margin: 0, color: AMBER, fontSize: '0.8rem' }}>
          Cubic is the comparison path: velocity-matched only (acceleration jumps at events) and
          has no hold dip. Quintic is the physical default.
        </p>
      ) : null}

      {/* Playback speed (viewing): a pure wall→sim rescale, NOT a physical change
          (DESIGN.md §2), grouped separately so it is never confused with tempo. */}
      <h3 style={sectionHeadingStyle}>Playback speed &amp; view</h3>
      <div style={slidersRowStyle}>
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
      </div>

      {/* Hands: n_h stepper + preset (full rebuild) and the positions editor. */}
      <h3 style={sectionHeadingStyle}>Hands &amp; geometry</h3>
      <div style={rowStyle}>
        <Stepper
          label="Hand count"
          value={handCount}
          min={HAND_COUNT_MIN}
          max={HAND_COUNT_MAX}
          onChange={setHandCount}
        />
        <Segmented<HandPreset>
          label="Preset"
          value={handPreset}
          options={[
            { value: 'line', label: 'Line' },
            { value: 'circle', label: 'Circle' },
          ]}
          onChange={setHandPreset}
        />
        <label
          style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600, alignSelf: 'flex-end' }}
        >
          <input type="checkbox" checked={positionsEditorOpen} onChange={togglePositionsEditor} />
          <span>Edit hand positions</span>
        </label>
      </div>
      {positionsEditorOpen ? <HandPositionsTable /> : null}

      <div style={rowStyle}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600 }}>
          <input type="checkbox" checked={orbitColoring} onChange={toggleOrbitColoring} />
          <span>Colour balls individually</span>
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

const sectionHeadingStyle: CSSProperties = {
  margin: '0.25rem 0 0',
  fontSize: '0.8rem',
  fontWeight: 700,
  letterSpacing: '0.03em',
  textTransform: 'uppercase',
  color: '#6b7280',
};

const buttonStyle: CSSProperties = {
  padding: '0.45rem 1rem',
  borderRadius: '0.4rem',
  border: '1px solid #c8cdd6',
  background: '#ffffff',
  fontWeight: 600,
  cursor: 'pointer',
};

const stepperButtonStyle: CSSProperties = {
  width: '1.9rem',
  height: '1.9rem',
  borderRadius: '0.4rem',
  border: '1px solid #c8cdd6',
  background: '#ffffff',
  fontWeight: 700,
  fontSize: '1rem',
  cursor: 'pointer',
  lineHeight: 1,
};

const toggleButtonStyle: CSSProperties = {
  padding: '0.35rem 0.7rem',
  borderRadius: '0.4rem',
  border: '1px solid #c8cdd6',
  background: '#ffffff',
  fontWeight: 600,
  fontSize: '0.85rem',
  color: '#3b4252',
  cursor: 'pointer',
};

const toggleButtonActiveStyle: CSSProperties = {
  background: '#2f6fed',
  borderColor: '#2f6fed',
  color: '#ffffff',
};

const numberInputStyle: CSSProperties = {
  width: '4.5rem',
  padding: '0.2rem 0.3rem',
  borderRadius: '0.3rem',
  border: '1px solid #c8cdd6',
  fontVariantNumeric: 'tabular-nums',
};

const selectStyle: CSSProperties = {
  padding: '0.4rem 0.5rem',
  borderRadius: '0.4rem',
  border: '1px solid #c8cdd6',
  background: '#ffffff',
  fontSize: '0.95rem',
  cursor: 'pointer',
};

const thStyle: CSSProperties = {
  textAlign: 'left',
  padding: '0.25rem 0.4rem',
  color: '#5b6472',
  fontWeight: 600,
  borderBottom: '1px solid #dfe3ea',
};

const tdStyle: CSSProperties = {
  padding: '0.2rem 0.4rem',
  fontVariantNumeric: 'tabular-nums',
};
