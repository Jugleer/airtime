// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useAppStore } from '../state';
import { Settings } from './Settings';

// The 3D view controls (ball radius, ball color, per-ball coloring) and playback
// speed moved from the sidebar (Controls) into this drawer in the redesign
// (2026-07-10). Their assertions moved here with them — the test simply opens the
// drawer first (an honest relocation, not a weakened check).
beforeEach(() => {
  useAppStore.setState({ theme: 'dark', orbitColoring: false });
  useAppStore.getState().setPattern('3');
});
afterEach(cleanup);

describe('Settings drawer (ui layer)', () => {
  it('opens the drawer and exposes the relocated view controls', () => {
    render(<Settings />);
    // Closed: the view controls are not mounted.
    expect(screen.queryByLabelText('Ball radius')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));

    // Open: playback speed (viewing) + the 3D view controls now render here.
    expect(screen.getByLabelText('Playback speed')).toBeTruthy();
    expect(screen.getByLabelText('Ball radius')).toBeTruthy();
    expect(screen.getByLabelText('Ball color')).toBeTruthy();
    // Save / Share + audio ride in the same drawer (via SharePanel).
    expect(screen.getByRole('button', { name: 'Copy share link' })).toBeTruthy();
    expect(screen.getByLabelText('Enable ticks')).toBeTruthy();
  });

  it('toggles per-ball coloring through the store', () => {
    render(<Settings />);
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));

    const toggle = screen.getByLabelText('Colour balls individually');
    expect(useAppStore.getState().orbitColoring).toBe(false); // fixture baseline
    fireEvent.click(toggle);
    expect(useAppStore.getState().orbitColoring).toBe(true);
  });

  it('switches the theme (dark ↔ light) through the store', () => {
    render(<Settings />);
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
    expect(useAppStore.getState().theme).toBe('dark');
    fireEvent.click(screen.getByRole('button', { name: 'Theme: Light' }));
    expect(useAppStore.getState().theme).toBe('light');
    fireEvent.click(screen.getByRole('button', { name: 'Theme: Dark' }));
    expect(useAppStore.getState().theme).toBe('dark');
  });
});
