// src/ui/App — the app shell (DESIGN.md §6): pattern input + controls, the 3D
// scene (the main view, Phase 4), the ladder diagram (the engine's debug view),
// the charts + energy panel, the state graph, and the timeline bar — all rendered
// from the one global clock (DESIGN.md §2).

import type { ReactElement } from 'react';
import { Scene } from '../render3d';
import { Charts } from './Charts';
import { Controls } from './Controls';
import { Help } from './Help';
import { Ladder } from './Ladder';
import { SharePanel } from './SharePanel';
import { StateGraph } from './StateGraph';
import { TimelineBar } from './TimelineBar';
import { useAudio } from './useAudio';
import { useClock } from './useClock';

export function App(): ReactElement {
  // Mount the single wall-clock loop that drives simTime (DESIGN.md §2) and the
  // WebAudio tick scheduler (DESIGN.md §6; a no-op until audio is enabled / where
  // WebAudio is unavailable).
  useClock();
  useAudio();

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
      <header
        style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem' }}
      >
        <div>
          <h1 style={{ margin: '0 0 0.15rem' }}>Airtime</h1>
          <p style={{ margin: 0, color: '#5b6472' }}>
            Siteswap 3D visualizer. Try <code>3</code>, <code>441</code>, <code>531</code>,{' '}
            <code>40</code>, <code>522</code>.
          </p>
        </div>
        <Help />
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
        <h2 style={{ margin: '0 0 0.5rem', fontSize: '1rem', color: '#3b4252' }}>3D scene</h2>
        <Scene />
      </section>

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

      {/* Charts + energy panel (DESIGN.md §6): per-hand |v|/|a|/|j| over the same
          window as the timeline bar, plus the per-hand energy table. Collapsible;
          hidden ⇒ no per-frame sampling. */}
      <Charts />

      {/* State graph (DESIGN.md §5): the (b, N) landing-schedule graph with the
          current pattern's cycle highlighted and the beat-hopping marker. Click a
          node (or type a same-b pattern above) to transition via BFS — the
          running timeline is spliced, so the past stays bit-identical. */}
      <StateGraph />

      {/* Timeline bar: DESIGN.md §6 "bottom, full width" — here, the full width of
          the app's content column. Scrubbing it moves the one clock, so the 3D
          scene, ladder, and tracers all follow (DESIGN.md §2). */}
      <TimelineBar />

      {/* Save / share + audio (DESIGN.md §6): shareable URL, presets, JSON, PNG,
          and synthesized ticks. */}
      <SharePanel />
    </main>
  );
}
