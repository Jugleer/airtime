// src/ui/Controls — the LEFT SIDEBAR (redesign 2026-07-10, owner layout override).
//
// Tightly grouped: pattern entry (live validation + ball-count / error line),
// the pattern library, the Tempo & physics group (beat period, dwell, gravity,
// hold depth, carry path — all future-only via kinematics epochs, DESIGN.md §4.6),
// and the Hands & geometry group (n_h stepper with line/circle presets + the
// numeric hand-positions editor). Full words in labels (NOTATION.md); the dwell
// readout turns amber when the effective-dwell clamp is active.
//
// Relocated by the redesign (see BUILD_LOG): play/pause + restart → ui/Transport
// (docked in the timeline strip); playback speed, ball radius/color, per-ball
// coloring, timeline window, trail length, ghosts → the Settings drawer. Tempo
// (physics) stays here; playback speed (viewing) lives in Settings — the two are
// never on the same panel, so they can't be confused (DESIGN.md §6).

import { useEffect, useState, type CSSProperties, type ReactElement } from 'react';
import { spatialPeriodBeats, validatePattern } from '../core/siteswap';
import {
  BEAT_PERIOD_MAX,
  BEAT_PERIOD_MIN,
  DEFAULT_BEAT_PERIOD,
  DEFAULT_CARRY_PATH_KIND,
  DEFAULT_DWELL_TIME,
  DEFAULT_GRAVITY_VALUE,
  DEFAULT_HOLD_DEPTH_VALUE,
  DWELL_CLAMP_BETA,
  DWELL_MIN,
  GRAVITY_MAX,
  GRAVITY_MIN,
  HAND_COUNT_MAX,
  HAND_COUNT_MIN,
  HOLD_DEPTH_MAX,
  HOLD_DEPTH_MIN,
  dwellCap,
  useAppStore,
  type CarryPathKind,
  type HandPreset,
  type HandPointKind,
} from '../state';
import { PATTERN_LIBRARY, type LibraryEntry } from './library';
import { usePalette, type Palette } from './theme';
import {
  Button,
  CheckToggle,
  SectionLabel,
  Segmented,
  Slider,
  Stepper,
  insetInputStyle,
} from './widgets';

/** Verbatim first-line error text from core, plus any further collision lines. */
function errorText(messages: readonly string[]): string {
  return messages.join('  —  ');
}

/**
 * Whether t_d_eff clamping is active for any airborne throw in the pattern
 * (NOTATION identity 4, DESIGN.md §4.1): the tightest bound is the smallest
 * airborne throw value h. Clamp is active iff t_d > β·h_min·τ_b.
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

/** The x/z numeric editor for one hand's catch + throw points (y stays fixed). */
function HandPositionsTable(): ReactElement {
  const palette = usePalette();
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
        style={{ ...insetInputStyle(palette), width: '3.6rem', fontSize: '0.78rem' }}
      />
    );
  };

  const rows: ReactElement[] = [];
  for (let hand = 0; hand < handCount; hand++) {
    rows.push(
      <tr key={hand}>
        <td style={tdStyle(palette)}>{hand}</td>
        <td style={tdStyle(palette)}>{cell(hand, 'catch', 'x')}</td>
        <td style={tdStyle(palette)}>{cell(hand, 'catch', 'z')}</td>
        <td style={tdStyle(palette)}>{cell(hand, 'throw', 'x')}</td>
        <td style={tdStyle(palette)}>{cell(hand, 'throw', 'z')}</td>
      </tr>,
    );
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: '0.78rem', color: palette.textPrimary }}>
        <thead>
          <tr>
            <th style={thStyle(palette)}>Hand</th>
            <th style={thStyle(palette)}>Catch x</th>
            <th style={thStyle(palette)}>Catch z</th>
            <th style={thStyle(palette)}>Throw x</th>
            <th style={thStyle(palette)}>Throw z</th>
          </tr>
        </thead>
        <tbody>{rows}</tbody>
      </table>
      <p style={{ margin: '0.35rem 0 0', color: palette.textMuted, fontSize: '0.72rem', lineHeight: 1.4 }}>
        Drag the green (catch) / orange (throw) markers in the 3D scene (0C = hand 0 catch, 0T =
        hand 0 throw), or edit x/z here (meters; height y stays 1.00 m). In-flight balls keep the
        path they were aimed with — edits affect future throws only.
      </p>
    </div>
  );
}

export function Controls(): ReactElement {
  const palette = usePalette();
  const pattern = useAppStore((state) => state.pattern);
  const beatPeriod = useAppStore((state) => state.beatPeriod);
  const dwellTime = useAppStore((state) => state.dwellTime);
  const gravity = useAppStore((state) => state.gravity);
  const holdDepth = useAppStore((state) => state.holdDepth);
  const carryPathKind = useAppStore((state) => state.carryPathKind);
  const handCount = useAppStore((state) => state.handCount);
  const handPreset = useAppStore((state) => state.handPreset);
  const positionsEditorOpen = useAppStore((state) => state.positionsEditorOpen);
  const sim = useAppStore((state) => state.sim);

  const setPattern = useAppStore((state) => state.setPattern);
  const setBeatPeriod = useAppStore((state) => state.setBeatPeriod);
  const setDwellTime = useAppStore((state) => state.setDwellTime);
  const setGravity = useAppStore((state) => state.setGravity);
  const setHoldDepth = useAppStore((state) => state.setHoldDepth);
  const setCarryPathKind = useAppStore((state) => state.setCarryPathKind);
  const setHandCount = useAppStore((state) => state.setHandCount);
  const setHandPreset = useAppStore((state) => state.setHandPreset);
  const togglePositionsEditor = useAppStore((state) => state.togglePositionsEditor);

  // --- Draft pattern entry (redesign 2026-07-11, owner requirement) -----------
  // Typing edits a LOCAL draft with live validation; the running sim only changes
  // on Enter or the Go button (both route through setPattern → navigateToPattern,
  // exactly as before). The store's `pattern` is the single source of the applied
  // text; this effect re-seeds the input whenever it changes from OUTSIDE the box
  // (library pick, graph click, hard reset, applied URL). It is a no-op right after
  // our own apply (draft already equals pattern), and never fires mid-typing since
  // typing does not touch the store.
  const [draft, setDraft] = useState(pattern);
  useEffect(() => {
    setDraft(pattern);
  }, [pattern]);

  const draftValidation = validatePattern(draft);
  const draftValid = draftValidation.ok;
  const dirty = draft !== pattern;
  const applyDraft = (): void => {
    if (draft !== pattern) {
      setPattern(draft);
    }
  };

  const clampActive = dwellClampActive(sim.values, dwellTime, beatPeriod);
  const heldTwoWarning = handCount !== 2 && sim.values.includes(2);

  // A friendly nudge when the draft uses notation Airtime v1 does not support:
  // synchronous ( ), multiplex [ ], or passing < > (DESIGN.md §1 deferred list).
  // These characters never occur in a valid vanilla siteswap (digits 0–9, letters
  // a–z), so detecting them is unambiguous — it explains the "unrecognized
  // character" error with the *why* and the supported subset. (x, p etc. are valid
  // high throws, so they are deliberately not flagged.)
  const looksLikeUnsupportedNotation = /[()[\],<>*!]/.test(draft);

  // Tempo & physics reset (owner requirement): each control has a ↺ (via the
  // widgets), and the whole group resets to the DEFAULT_* constants at once.
  const tempoDirty =
    beatPeriod !== DEFAULT_BEAT_PERIOD ||
    dwellTime !== DEFAULT_DWELL_TIME ||
    gravity !== DEFAULT_GRAVITY_VALUE ||
    holdDepth !== DEFAULT_HOLD_DEPTH_VALUE ||
    carryPathKind !== DEFAULT_CARRY_PATH_KIND;
  const resetTempo = (): void => {
    setBeatPeriod(DEFAULT_BEAT_PERIOD); // re-clamps dwell against the fresh cap
    setDwellTime(DEFAULT_DWELL_TIME);
    setGravity(DEFAULT_GRAVITY_VALUE);
    setHoldDepth(DEFAULT_HOLD_DEPTH_VALUE);
    setCarryPathKind(DEFAULT_CARRY_PATH_KIND);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
      {/* Pattern group. */}
      <section style={groupStyle(palette)}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
          <span style={{ fontWeight: 700, fontSize: '0.82rem', color: palette.textPrimary }}>
            Pattern (siteswap)
          </span>
          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'stretch' }}>
            <input
              type="text"
              value={draft}
              aria-label="Pattern (siteswap)"
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  applyDraft();
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  setDraft(pattern); // revert the draft to the running pattern
                }
              }}
              style={{
                flex: 1,
                minWidth: 0,
                font: '700 1.15rem ui-monospace, SFMono-Regular, Menlo, monospace',
                padding: '0.45rem 0.55rem',
                borderRadius: '0.45rem',
                border: `1px solid ${
                  !draftValid ? palette.red : dirty ? palette.accent : palette.border
                }`,
                background: palette.inset,
                color: palette.textPrimary,
                outline: 'none',
              }}
            />
            <Button
              variant={dirty ? 'primary' : 'default'}
              onClick={applyDraft}
              ariaLabel="Apply pattern"
              title="Apply pattern (Enter)"
            >
              Go
            </Button>
          </div>
        </div>

        {draftValid ? (
          <p style={{ ...statusStyle, color: palette.green }}>
            Valid · {draftValidation.ballCount} balls · repeats every{' '}
            {(spatialPeriodBeats(draftValidation.values, handCount) * beatPeriod).toFixed(2)} s
          </p>
        ) : (
          <p role="alert" style={{ ...statusStyle, color: palette.red }}>
            {errorText(draftValidation.errors.map((error) => error.message))}
          </p>
        )}

        {looksLikeUnsupportedNotation ? (
          <p role="note" style={{ ...statusStyle, color: palette.amber }}>
            Airtime v1 animates vanilla (asynchronous) siteswap only — synchronous ( ), multiplex [ ],
            and passing &lt; &gt; notation aren&apos;t supported yet. Use digits 0–9 or letters a–z (10–35).
          </p>
        ) : null}

        {dirty ? (
          <p style={{ margin: 0, color: palette.textMuted, fontSize: '0.72rem', lineHeight: 1.35 }}>
            Press Enter or Go to apply · Esc to revert.
          </p>
        ) : null}

        {heldTwoWarning ? (
          <p role="note" style={{ ...statusStyle, color: palette.amber }}>
            Held 2s are only physically meaningful with 2 hands (pending design decision).
          </p>
        ) : null}

        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <span style={{ fontWeight: 600, fontSize: '0.78rem', color: palette.textSecondary }}>
            Library
          </span>
          <select
            aria-label="Pattern library"
            value=""
            onChange={(event) => {
              if (event.target.value) {
                setPattern(event.target.value);
              }
            }}
            style={{
              ...insetInputStyle(palette),
              padding: '0.4rem 0.5rem',
              fontSize: '0.85rem',
              cursor: 'pointer',
            }}
          >
            <option value="">Choose a pattern…</option>
            {groupByBallCount(PATTERN_LIBRARY).map(([count, entries]) => (
              <optgroup key={count} label={`${count} balls`}>
                {entries.map((entry) => (
                  <option key={entry.pattern} value={entry.pattern}>
                    {entry.pattern} — {entry.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
      </section>

      {/* Tempo & physics group (DESIGN.md §4). */}
      <section style={groupStyle(palette)}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
          <SectionLabel>Tempo &amp; physics</SectionLabel>
          <Button
            variant="ghost"
            onClick={resetTempo}
            disabled={!tempoDirty}
            ariaLabel="Reset all tempo and physics"
            style={resetAllStyle}
          >
            ↺ Reset all
          </Button>
        </div>
        <Slider
          label="Beat period (tempo)"
          value={beatPeriod}
          min={BEAT_PERIOD_MIN}
          max={BEAT_PERIOD_MAX}
          scale="log"
          readout={`${beatPeriod.toFixed(3)} s`}
          defaultValue={DEFAULT_BEAT_PERIOD}
          onChange={setBeatPeriod}
        />
        <Slider
          label="Dwell time"
          value={dwellTime}
          min={DWELL_MIN}
          max={dwellCap(handCount, beatPeriod)}
          scale="linear"
          readout={clampActive ? `${dwellTime.toFixed(3)} s · clamped` : `${dwellTime.toFixed(3)} s`}
          readoutColor={clampActive ? palette.amber : undefined}
          defaultValue={DEFAULT_DWELL_TIME}
          onChange={setDwellTime}
        />
        <Slider
          label="Gravity"
          value={gravity}
          min={GRAVITY_MIN}
          max={GRAVITY_MAX}
          scale="linear"
          readout={`${gravity.toFixed(2)} m/s²`}
          defaultValue={DEFAULT_GRAVITY_VALUE}
          onChange={setGravity}
        />
        <Slider
          label="Hold depth"
          value={holdDepth}
          min={HOLD_DEPTH_MIN}
          max={HOLD_DEPTH_MAX}
          scale="linear"
          readout={`${(holdDepth * 100).toFixed(1)} cm`}
          defaultValue={DEFAULT_HOLD_DEPTH_VALUE}
          onChange={setHoldDepth}
        />
        <Segmented<CarryPathKind>
          label="Carry path"
          value={carryPathKind}
          options={[
            { value: 'quintic', label: 'Quintic' },
            { value: 'cubic', label: 'Cubic' },
          ]}
          defaultValue={DEFAULT_CARRY_PATH_KIND}
          onChange={setCarryPathKind}
        />
        {carryPathKind === 'cubic' ? (
          <p style={{ margin: 0, color: palette.amber, fontSize: '0.72rem', lineHeight: 1.4 }}>
            Cubic is the comparison path: velocity-matched only (acceleration jumps at events) and
            has no hold dip. Quintic is the physical default.
          </p>
        ) : null}
      </section>

      {/* Hands & geometry group. */}
      <section style={groupStyle(palette)}>
        <SectionLabel>Hands &amp; geometry</SectionLabel>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
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
        </div>
        <CheckToggle
          label="Edit hand positions"
          checked={positionsEditorOpen}
          onChange={togglePositionsEditor}
        />
        {positionsEditorOpen ? <HandPositionsTable /> : null}
      </section>
    </div>
  );
}

/** Group library entries by (parser-derived) ball count, ascending — one
 *  <optgroup> per count in the sidebar dropdown. */
function groupByBallCount(entries: readonly LibraryEntry[]): [number, LibraryEntry[]][] {
  const groups = new Map<number, LibraryEntry[]>();
  for (const entry of entries) {
    const list = groups.get(entry.ballCount) ?? [];
    list.push(entry);
    groups.set(entry.ballCount, list);
  }
  return [...groups.entries()].sort((a, b) => a[0] - b[0]);
}

// --- Styling -----------------------------------------------------------------

/** The small "Reset all" section button (Tempo & physics header). */
const resetAllStyle: CSSProperties = { fontSize: '0.7rem', padding: '0.15rem 0.4rem' };

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

const statusStyle: CSSProperties = {
  margin: 0,
  fontSize: '0.78rem',
  fontVariantNumeric: 'tabular-nums',
  minHeight: '1.1rem',
  lineHeight: 1.35,
};

function thStyle(palette: Palette): CSSProperties {
  return {
    textAlign: 'left',
    padding: '0.2rem 0.35rem',
    color: palette.textMuted,
    fontWeight: 600,
    borderBottom: `1px solid ${palette.border}`,
  };
}

function tdStyle(palette: Palette): CSSProperties {
  return { padding: '0.18rem 0.35rem', fontVariantNumeric: 'tabular-nums', color: palette.textPrimary };
}
