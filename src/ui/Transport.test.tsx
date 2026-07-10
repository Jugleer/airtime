// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useAppStore } from '../state';
import { Transport } from './Transport';

// The play/pause store-wiring assertion moved here from Controls.test when the
// transport was relocated out of the sidebar into the timeline strip (redesign
// 2026-07-10). Same behavior, exercised where the control now lives.
beforeEach(() => {
  useAppStore.setState({ simTime: 0, playing: true });
});
afterEach(cleanup);

describe('Transport (ui layer)', () => {
  it('toggles play/pause through the store', () => {
    render(<Transport />);
    // Starts playing → the button's accessible name is "Pause".
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(useAppStore.getState().playing).toBe(false);
    // Now paused → the same button reads "Play".
    expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy();
  });

  it('restart zeroes simTime through the store', () => {
    useAppStore.setState({ simTime: 2.4 });
    render(<Transport />);
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }));
    expect(useAppStore.getState().simTime).toBe(0);
  });
});
