// src/ui/Help — the help overlay (DESIGN.md §6; PLAN.md Phase 9). A "?" button in
// the header opens a modal explaining siteswap basics and the app's controls. Text
// only (no images); self-contained so the SPA stays asset-free (CLAUDE.md).

import { useEffect, useState, type CSSProperties, type ReactElement } from 'react';
import { usePalette, type Palette } from './theme';

interface Section {
  readonly heading: string;
  readonly items: readonly (readonly [string, string])[];
}

const SITESWAP_SECTIONS: readonly Section[] = [
  {
    heading: 'Reading siteswap',
    items: [
      [
        'Throw value',
        'Each digit is one beat and says how many beats until that ball is thrown again — a 3 comes back in 3 beats, a 5 in 5 (higher = higher and longer). Digits 0–9 then a–z (10–35).',
      ],
      [
        'Which hand',
        'One throw per beat, hands alternating (with 2 hands): odd values cross to the other hand, even values stay. A pattern is valid when no two throws land on the same beat and the digits average to a whole number — the ball count b.',
      ],
      [
        '0 and 2',
        'A 0 is an empty hand that beat (a gap). A 2 is a ball held in the hand across the beat rather than thrown — consecutive 2s merge into one longer hold.',
      ],
    ],
  },
  {
    heading: 'The state graph',
    items: [
      [
        'States',
        'A state is which of the next N beats already have a ball arriving. Every valid pattern is a loop through these states; the little marker hops one state each beat.',
      ],
      [
        'Navigating',
        'Click any state or pattern (or type a same-ball-count pattern) and the app plans the shortest legal throw sequence to get there and splices it in live — the balls already in the air keep flying.',
      ],
    ],
  },
];

const CONTROL_SECTIONS: readonly Section[] = [
  {
    heading: 'Tempo & physics',
    items: [
      ['Beat period', 'The tempo (seconds per beat). Changes are slew-limited, so the pattern rises and slows smoothly.'],
      ['Dwell time', 'How long a ball sits in the hand between catch and throw. Turns amber when a fast throw forces it shorter.'],
      ['Gravity / Hold depth', 'g in m/s², and how deep the hand dips while carrying a ball. Carry path toggles the physical quintic vs a cubic comparison.'],
    ],
  },
  {
    heading: 'Playback & view',
    items: [
      ['Playback speed', 'Slows or speeds the VIEWING only — it never changes the physics (unlike beat period).'],
      ['Ball radius / color', 'Sphere size, and each ball keeps its own color (matching the ladder) — untick "Colour balls individually" for a single configurable color.'],
      ['Timeline window / trail / ghosts', 'The visible span of the timeline bar, the length of the trailing streak, and the dashed future path.'],
    ],
  },
  {
    heading: 'Hands, graph, share',
    items: [
      ['Hand count & geometry', '1–8 hands with line/circle presets; open the editor to drag catch (green) and throw (orange) points in 3D.'],
      ['State graph N', 'The graph depth; auto-expands to fit tall patterns (warns at 9+).'],
      ['Save & share', 'Copy a link that reproduces the whole scene, save named presets, export/import JSON, grab a PNG, and toggle audio ticks.'],
    ],
  },
  {
    heading: 'Keyboard & mouse',
    items: [
      ['Space', 'Play or pause — works anywhere except while typing in a field or focused on a button.'],
      ['Enter · Esc (pattern box)', 'Enter applies the typed pattern; Esc reverts it to the running one.'],
      ['Esc (dialogs)', 'Closes the Settings drawer or this help.'],
      ['Scroll wheel', 'Hover any slider and scroll to nudge it one fine step (no page scroll).'],
      ['Drag · scroll (3D scene)', 'Drag to orbit the camera, scroll to zoom, right-drag to pan.'],
    ],
  },
];

function SectionList({
  sections,
  palette,
}: {
  readonly sections: readonly Section[];
  readonly palette: Palette;
}): ReactElement {
  return (
    <>
      {sections.map((section) => (
        <div key={section.heading} style={{ marginBottom: '0.75rem' }}>
          <h4 style={subHeadingStyle(palette)}>{section.heading}</h4>
          <dl style={{ margin: 0 }}>
            {section.items.map(([term, description]) => (
              <div key={term} style={{ marginBottom: '0.35rem' }}>
                <dt style={{ fontWeight: 600, color: palette.textPrimary }}>{term}</dt>
                <dd style={{ margin: 0, color: palette.textSecondary, fontSize: '0.9rem', lineHeight: 1.45 }}>
                  {description}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </>
  );
}

/** The "?" help button + its modal overlay. Self-contained (owns its open state). */
export function Help(): ReactElement {
  const palette = usePalette();
  const [open, setOpen] = useState(false);

  // Escape closes the modal, mirroring the Settings drawer (consistent dialog
  // dismissal). Only listens while open, so it never competes with the global
  // Space/other handlers otherwise.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Help"
        title="Help — siteswap and controls"
        style={helpButtonStyle(palette)}
      >
        ?
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Help"
          style={backdropStyle(palette)}
          onClick={() => setOpen(false)}
        >
          <div style={modalStyle(palette)} onClick={(event) => event.stopPropagation()}>
            <div style={modalHeaderStyle(palette)}>
              <h3 style={{ margin: 0, color: palette.textPrimary }}>How Airtime works</h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close help"
                style={closeButtonStyle(palette)}
              >
                ×
              </button>
            </div>
            <div style={{ padding: '1rem 1.25rem', overflowY: 'auto' }}>
              <h4 style={{ ...subHeadingStyle(palette), marginTop: 0, fontSize: '0.95rem' }}>
                Siteswap
              </h4>
              <SectionList sections={SITESWAP_SECTIONS} palette={palette} />
              <h4 style={{ ...subHeadingStyle(palette), fontSize: '0.95rem' }}>Controls</h4>
              <SectionList sections={CONTROL_SECTIONS} palette={palette} />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

// --- Inline styling (theme-aware, dark-first) --------------------------------

function helpButtonStyle(palette: Palette): CSSProperties {
  return {
    width: '2.1rem',
    height: '2.1rem',
    borderRadius: '50%',
    border: `1px solid ${palette.border}`,
    background: palette.panelAlt,
    fontWeight: 700,
    fontSize: '1rem',
    color: palette.textPrimary,
    cursor: 'pointer',
    lineHeight: 1,
    flexShrink: 0,
  };
}

function backdropStyle(palette: Palette): CSSProperties {
  return {
    position: 'fixed',
    inset: 0,
    background: palette.overlayBackdrop,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '1.5rem',
    zIndex: 300,
  };
}

function modalStyle(palette: Palette): CSSProperties {
  return {
    background: palette.panel,
    borderRadius: '0.7rem',
    border: `1px solid ${palette.border}`,
    maxWidth: '40rem',
    width: '100%',
    maxHeight: '85vh',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: palette.shadow,
  };
}

function modalHeaderStyle(palette: Palette): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '1rem 1.25rem',
    borderBottom: `1px solid ${palette.border}`,
  };
}

function subHeadingStyle(palette: Palette): CSSProperties {
  return {
    margin: '0.5rem 0 0.4rem',
    fontSize: '0.8rem',
    fontWeight: 700,
    letterSpacing: '0.03em',
    textTransform: 'uppercase',
    color: palette.textMuted,
  };
}

function closeButtonStyle(palette: Palette): CSSProperties {
  return {
    width: '1.9rem',
    height: '1.9rem',
    borderRadius: '0.4rem',
    border: `1px solid ${palette.border}`,
    background: palette.panelAlt,
    fontSize: '1.3rem',
    lineHeight: 1,
    cursor: 'pointer',
    color: palette.textSecondary,
  };
}
