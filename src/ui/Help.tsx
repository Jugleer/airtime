// src/ui/Help — the help overlay (DESIGN.md §6; PLAN.md Phase 9). A "?" button in
// the header opens a modal explaining siteswap basics and the app's controls. Text
// only (no images); self-contained so the SPA stays asset-free (CLAUDE.md).

import { useState, type CSSProperties, type ReactElement } from 'react';

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
      ['Ball radius / color / orbit coloring', 'Sphere size, single color, or a palette color per ball orbit.'],
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
];

function SectionList({ sections }: { readonly sections: readonly Section[] }): ReactElement {
  return (
    <>
      {sections.map((section) => (
        <div key={section.heading} style={{ marginBottom: '0.75rem' }}>
          <h4 style={subHeadingStyle}>{section.heading}</h4>
          <dl style={{ margin: 0 }}>
            {section.items.map(([term, description]) => (
              <div key={term} style={{ marginBottom: '0.35rem' }}>
                <dt style={{ fontWeight: 600, color: '#3b4252' }}>{term}</dt>
                <dd style={{ margin: '0 0 0 0', color: '#5b6472', fontSize: '0.9rem' }}>
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
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Help"
        title="Help — siteswap and controls"
        style={helpButtonStyle}
      >
        ?
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Help"
          style={backdropStyle}
          onClick={() => setOpen(false)}
        >
          <div style={modalStyle} onClick={(event) => event.stopPropagation()}>
            <div style={modalHeaderStyle}>
              <h3 style={{ margin: 0 }}>How Airtime works</h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close help"
                style={closeButtonStyle}
              >
                ×
              </button>
            </div>
            <div style={modalBodyStyle}>
              <h4 style={{ ...subHeadingStyle, marginTop: 0, fontSize: '0.95rem' }}>Siteswap</h4>
              <SectionList sections={SITESWAP_SECTIONS} />
              <h4 style={{ ...subHeadingStyle, fontSize: '0.95rem' }}>Controls</h4>
              <SectionList sections={CONTROL_SECTIONS} />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

// --- Inline styling ----------------------------------------------------------

const helpButtonStyle: CSSProperties = {
  width: '1.9rem',
  height: '1.9rem',
  borderRadius: '50%',
  border: '1px solid #c8cdd6',
  background: '#ffffff',
  fontWeight: 700,
  fontSize: '1rem',
  color: '#3b4252',
  cursor: 'pointer',
  lineHeight: 1,
};

const backdropStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(20, 24, 31, 0.45)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '1.5rem',
  zIndex: 100,
};

const modalStyle: CSSProperties = {
  background: '#ffffff',
  borderRadius: '0.7rem',
  border: '1px solid #dfe3ea',
  maxWidth: '40rem',
  width: '100%',
  maxHeight: '85vh',
  display: 'flex',
  flexDirection: 'column',
  boxShadow: '0 10px 40px rgba(20, 24, 31, 0.3)',
};

const modalHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '1rem 1.25rem',
  borderBottom: '1px solid #eceef2',
};

const modalBodyStyle: CSSProperties = {
  padding: '1rem 1.25rem',
  overflowY: 'auto',
};

const subHeadingStyle: CSSProperties = {
  margin: '0.5rem 0 0.4rem',
  fontSize: '0.8rem',
  fontWeight: 700,
  letterSpacing: '0.03em',
  textTransform: 'uppercase',
  color: '#6b7280',
};

const closeButtonStyle: CSSProperties = {
  width: '1.9rem',
  height: '1.9rem',
  borderRadius: '0.4rem',
  border: '1px solid #c8cdd6',
  background: '#ffffff',
  fontSize: '1.3rem',
  lineHeight: 1,
  cursor: 'pointer',
  color: '#5b6472',
};
