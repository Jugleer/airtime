import type { ReactElement } from 'react';
import { useAppStore } from '../state';

// Phase 0 placeholder page (DESIGN.md §6). Real panels, the 3D scene, the ladder
// diagram, and the timeline bar arrive in later phases; for now this proves the
// ui -> state -> core wiring renders.
export function App(): ReactElement {
  const pattern = useAppStore((state) => state.pattern);

  return (
    <main
      style={{
        fontFamily: 'system-ui, -apple-system, sans-serif',
        maxWidth: '40rem',
        margin: '0 auto',
        padding: '2rem',
        lineHeight: 1.5,
      }}
    >
      <h1>Airtime</h1>
      <p>Interactive 3D siteswap visualizer and kinematics lab.</p>
      <p>
        Scaffold running. Default pattern: <code>{pattern}</code>.
      </p>
    </main>
  );
}
