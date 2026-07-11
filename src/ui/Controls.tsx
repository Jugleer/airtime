// src/ui/Controls — the LEFT SIDEBAR (redesign 2026-07-10; Settings drawer removed
// 2026-07-11, owner requirement — every control is now always visible, no menu).
//
// Tightly grouped, top to bottom: pattern entry (live validation + ball-count /
// error line), the pattern library, the Tempo & physics group (beat period, dwell,
// gravity, hold depth, carry path — all future-only via kinematics epochs,
// DESIGN.md §4.6), the Hands & geometry group (n_h stepper with line/circle presets
// + the numeric hand-positions editor), and — moved here from the deleted Settings
// drawer — the View group (theme, playback speed, ball radius/color, per-ball
// coloring, timeline window, trail length, ghosts, hand/graph overlays).
//
// Full words in labels (NOTATION.md); the dwell readout turns amber when the
// effective-dwell clamp is active. Tempo (physics) and playback speed (viewing)
// stay in distinct groups so they can't be confused (DESIGN.md §6). Save/Share &
// audio moved to the right column beneath the ladder (see App / SharePanel).

import { useEffect, useState, type CSSProperties, type ReactElement } from 'react';
import { spatialPeriodBeats, validatePattern } from '../core/siteswap';
import {
  BALL_RADIUS_MAX,
  BALL_RADIUS_MIN,
  BEAT_PERIOD_MAX,
  BEAT_PERIOD_MIN,
  DEFAULT_BALL_COLOR,
  DEFAULT_BALL_RADIUS,
  DEFAULT_BEAT_PERIOD,
  DEFAULT_CARRY_PATH_KIND,
  DEFAULT_DWELL_TIME,
  DEFAULT_GHOSTS_ENABLED,
  DEFAULT_GRAPH_MINIMAP,
  DEFAULT_GRAVITY_VALUE,
  DEFAULT_HOLD_DEPTH_VALUE,
  DEFAULT_ORBIT_COLORING,
  DEFAULT_PLAYBACK_SPEED,
  DEFAULT_SHOW_HANDS,
  DEFAULT_SHOW_HAND_PATHS,
  DEFAULT_TRAIL_LENGTH,
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
  type ThemeName,
} from '../state';
import {
  DEFAULT_TIMELINE_WINDOW,
  TIMELINE_WINDOW_MAX,
  TIMELINE_WINDOW_MIN,
} from '../state/simulation';
import { PATTERN_LIBRARY, type LibraryEntry } from './library';
import { usePalette, type Palette } from './theme';
import { WorkspaceButton } from './WorkspacePanel';
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

/**
 * The horizontal-plane numeric editor for one hand's catch + throw points.
 *
 * Display convention is Z-VERTICAL (owner 2026-07-11): X = the line the hands sit
 * along, Y = front–back horizontal, Z = up. The store is y-up internally, so the
 * internal key 'x' is display X (along) and the internal key 'z' (front–back) is
 * shown to the user as "Y". The height (internal y) is the up axis Z and stays
 * fixed at 1.00 m, so it isn't editable here. Display Y = −internal z (the
 * right-handed z-up display frame; see render3d/displayFrame.ts), so this table
 * negates on both read and write.
 */
function HandPositionsTable(): ReactElement {
  const palette = usePalette();
  const handCount = useAppStore((state) => state.handCount);
  const throwPoints = useAppStore((state) => state.handThrowPoints);
  const catchPoints = useAppStore((state) => state.handCatchPoints);
  const setHandPoint = useAppStore((state) => state.setHandPoint);

  const cell = (hand: number, kind: HandPointKind, axisKey: 'x' | 'z', display: string): ReactElement => {
    const point = (kind === 'throw' ? throwPoints : catchPoints)[hand];
    const rawValue = point ? point[axisKey] : 0;
    const value = axisKey === 'z' ? -rawValue : rawValue;
    return (
      <input
        type="number"
        step={0.01}
        value={Number.isFinite(value) ? Number(value.toFixed(3)) : 0}
        aria-label={`Hand ${hand} ${kind} ${display}`}
        onChange={(event) => {
          const next = event.target.valueAsNumber;
          if (!Number.isFinite(next) || !point) {
            return;
          }
          const x = axisKey === 'x' ? next : point.x;
          const z = axisKey === 'z' ? -next : point.z;
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
        <td style={tdStyle(palette)}>{cell(hand, 'catch', 'x', 'x')}</td>
        <td style={tdStyle(palette)}>{cell(hand, 'catch', 'z', 'y')}</td>
        <td style={tdStyle(palette)}>{cell(hand, 'throw', 'x', 'x')}</td>
        <td style={tdStyle(palette)}>{cell(hand, 'throw', 'z', 'y')}</td>
      </tr>,
    );
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: '0.78rem', color: palette.textPrimary }}>
        <thead>
          <tr>
            <th style={thStyle(palette)}>Hand</th>
            <th style={thStyle(palette)}>Catch X</th>
            <th style={thStyle(palette)}>Catch Y</th>
            <th style={thStyle(palette)}>Throw X</th>
            <th style={thStyle(palette)}>Throw Y</th>
          </tr>
        </thead>
        <tbody>{rows}</tbody>
      </table>
      <p style={{ margin: '0.35rem 0 0', color: palette.textMuted, fontSize: '0.72rem', lineHeight: 1.4 }}>
        Drag the green (catch) / orange (throw) markers in the 3D scene (0C = hand 0 catch, 0T =
        hand 0 throw), or edit X (along the hand line) / Y (front–back) here (meters; the up axis Z
        stays 1.00 m). In-flight balls keep the path they were aimed with — edits affect future
        throws only.
      </p>
    </div>
  );
}

/**
 * The View group (relocated from the deleted Settings drawer, 2026-07-11). Theme +
 * every VIEWING preference: playback-speed rescale (NOT tempo, DESIGN.md §2), ball
 * radius / coloring, timeline window, trail length, future ghosts, hand + graph
 * overlays. Each control has a ↺ (via the widgets); "Reset all" restores the whole
 * group. Theme has its own ↺ but is deliberately left OUT of the bulk reset so a
 * slider reset never flips the app light/dark unexpectedly (theme is not persisted).
 */
function ViewGroup(): ReactElement {
  const palette = usePalette();
  const theme = useAppStore((state) => state.theme);
  const playbackSpeed = useAppStore((state) => state.playbackSpeed);
  const ballRadius = useAppStore((state) => state.ballRadius);
  const orbitColoring = useAppStore((state) => state.orbitColoring);
  const ballColor = useAppStore((state) => state.ballColor);
  const showHands = useAppStore((state) => state.showHands);
  const showHandPaths = useAppStore((state) => state.showHandPaths);
  const graphMinimap = useAppStore((state) => state.graphMinimap);
  const timelineWindow = useAppStore((state) => state.timelineWindow);
  const trailLength = useAppStore((state) => state.trailLength);
  const ghostsEnabled = useAppStore((state) => state.ghostsEnabled);

  const toggleTheme = useAppStore((state) => state.toggleTheme);
  const setPlaybackSpeed = useAppStore((state) => state.setPlaybackSpeed);
  const setBallRadius = useAppStore((state) => state.setBallRadius);
  const toggleOrbitColoring = useAppStore((state) => state.toggleOrbitColoring);
  const setOrbitColoring = useAppStore((state) => state.setOrbitColoring);
  const setBallColor = useAppStore((state) => state.setBallColor);
  const toggleShowHands = useAppStore((state) => state.toggleShowHands);
  const setShowHands = useAppStore((state) => state.setShowHands);
  const toggleShowHandPaths = useAppStore((state) => state.toggleShowHandPaths);
  const setShowHandPaths = useAppStore((state) => state.setShowHandPaths);
  const toggleGraphMinimap = useAppStore((state) => state.toggleGraphMinimap);
  const setGraphMinimap = useAppStore((state) => state.setGraphMinimap);
  const setTimelineWindow = useAppStore((state) => state.setTimelineWindow);
  const setTrailLength = useAppStore((state) => state.setTrailLength);
  const toggleGhosts = useAppStore((state) => state.toggleGhosts);
  const setGhostsEnabled = useAppStore((state) => state.setGhostsEnabled);

  const viewDirty =
    playbackSpeed !== DEFAULT_PLAYBACK_SPEED ||
    ballRadius !== DEFAULT_BALL_RADIUS ||
    timelineWindow !== DEFAULT_TIMELINE_WINDOW ||
    trailLength !== DEFAULT_TRAIL_LENGTH ||
    orbitColoring !== DEFAULT_ORBIT_COLORING ||
    ghostsEnabled !== DEFAULT_GHOSTS_ENABLED ||
    showHands !== DEFAULT_SHOW_HANDS ||
    showHandPaths !== DEFAULT_SHOW_HAND_PATHS ||
    graphMinimap !== DEFAULT_GRAPH_MINIMAP ||
    ballColor !== DEFAULT_BALL_COLOR;
  const resetView = (): void => {
    setPlaybackSpeed(DEFAULT_PLAYBACK_SPEED);
    setBallRadius(DEFAULT_BALL_RADIUS);
    setTimelineWindow(DEFAULT_TIMELINE_WINDOW);
    setTrailLength(DEFAULT_TRAIL_LENGTH);
    setOrbitColoring(DEFAULT_ORBIT_COLORING);
    setGhostsEnabled(DEFAULT_GHOSTS_ENABLED);
    setShowHands(DEFAULT_SHOW_HANDS);
    setShowHandPaths(DEFAULT_SHOW_HAND_PATHS);
    setGraphMinimap(DEFAULT_GRAPH_MINIMAP);
    setBallColor(DEFAULT_BALL_COLOR);
  };

  return (
    <section style={groupStyle(palette)}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
        <SectionLabel>View</SectionLabel>
        <Button
          variant="ghost"
          onClick={resetView}
          disabled={!viewDirty}
          ariaLabel="Reset all view settings"
          style={resetAllStyle}
        >
          ↺ Reset all
        </Button>
      </div>
      <Segmented<ThemeName>
        label="Theme"
        value={theme}
        options={[
          { value: 'dark', label: 'Dark' },
          { value: 'light', label: 'Light' },
        ]}
        defaultValue="dark"
        onChange={(value) => {
          if (value !== theme) {
            toggleTheme();
          }
        }}
      />
      <Slider
        label="Playback speed"
        value={playbackSpeed}
        min={PLAYBACK_MIN}
        max={PLAYBACK_MAX}
        scale="linear"
        readout={`${playbackSpeed.toFixed(2)}× (viewing)`}
        defaultValue={DEFAULT_PLAYBACK_SPEED}
        onChange={setPlaybackSpeed}
      />
      <Slider
        label="Ball radius"
        value={ballRadius}
        min={BALL_RADIUS_MIN}
        max={BALL_RADIUS_MAX}
        scale="linear"
        readout={`${(ballRadius * 100).toFixed(1)} cm`}
        defaultValue={DEFAULT_BALL_RADIUS}
        onChange={setBallRadius}
      />
      <Slider
        label="Timeline window"
        value={timelineWindow}
        min={TIMELINE_WINDOW_MIN}
        max={TIMELINE_WINDOW_MAX}
        scale="linear"
        readout={`${timelineWindow.toFixed(1)} s`}
        defaultValue={DEFAULT_TIMELINE_WINDOW}
        onChange={setTimelineWindow}
      />
      <Slider
        label="Trail length"
        value={trailLength}
        min={TRAIL_LENGTH_MIN}
        max={TRAIL_LENGTH_MAX}
        scale="linear"
        readout={`${trailLength.toFixed(2)} s`}
        defaultValue={DEFAULT_TRAIL_LENGTH}
        onChange={setTrailLength}
      />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem 1rem', alignItems: 'center' }}>
        <CheckToggle
          label="Colour balls individually"
          checked={orbitColoring}
          defaultChecked={DEFAULT_ORBIT_COLORING}
          onChange={toggleOrbitColoring}
        />
        <CheckToggle
          label="Future ghosts"
          checked={ghostsEnabled}
          defaultChecked={DEFAULT_GHOSTS_ENABLED}
          onChange={toggleGhosts}
        />
        <CheckToggle
          label="Show hands"
          checked={showHands}
          defaultChecked={DEFAULT_SHOW_HANDS}
          onChange={toggleShowHands}
        />
        <CheckToggle
          label="Hand paths"
          checked={showHandPaths}
          defaultChecked={DEFAULT_SHOW_HAND_PATHS}
          onChange={toggleShowHandPaths}
        />
        <CheckToggle
          label="State-graph minimap"
          checked={graphMinimap}
          defaultChecked={DEFAULT_GRAPH_MINIMAP}
          onChange={toggleGraphMinimap}
        />
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
        {/* The hand-workspace editor (owner feature 2026-07-11): a configurable
            advisory bounding volume per hand. Opens a non-darkening popup. */}
        <WorkspaceButton />
      </section>

      {/* View group (theme + viewing preferences), relocated here from the deleted
          Settings drawer per the 2026-07-11 owner requirement. */}
      <ViewGroup />
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
