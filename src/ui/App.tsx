// src/ui/App — the Phase 3 shell (DESIGN.md §6): pattern input + controls and the
// ladder diagram (the engine's debug view), both rendered from the one global
// clock. The 3D scene, timeline bar, charts, and state graph arrive in later
// phases. Light styling — function over beauty for the debug view.

import type { ReactElement } from 'react';
import { Controls } from './Controls';
import { Ladder } from './Ladder';
import { useClock } from './useClock';

export function App(): ReactElement {
  // Mount the single wall-clock loop that drives simTime (DESIGN.md §2).
  useClock();

  return (
    <main
      style={{
        fontFamily: 'system-ui, -apple-system, sans-serif',
        maxWidth: '72rem',
        margin: '0 auto',
        padding: '1.5rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
        color: '#1f2530',
      }}
    >
      <header>
        <h1 style={{ margin: '0 0 0.15rem' }}>Airtime</h1>
        <p style={{ margin: 0, color: '#5b6472' }}>
          Siteswap engine · ladder debug view. Try <code>3</code>, <code>531</code>, <code>40</code>
          , <code>522</code>.
        </p>
      </header>

      <Controls />

      <section
        style={{
          padding: '0.75rem',
          background: '#ffffff',
          borderRadius: '0.6rem',
          border: '1px solid #dfe3ea',
        }}
      >
        <h2 style={{ margin: '0 0 0.5rem', fontSize: '1rem', color: '#3b4252' }}>Ladder diagram</h2>
        <Ladder />
      </section>
    </main>
  );
}
