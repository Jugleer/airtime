// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { validatePattern } from '../core/siteswap';
import { useAppStore } from '../state';
import { Controls } from './Controls';

beforeEach(() => {
  useAppStore.setState({ simTime: 0, playing: true, epochs: [], orbitColoring: false });
  useAppStore.getState().setPattern('3');
});
afterEach(cleanup);

describe('Controls (ui layer)', () => {
  it('shows the core beat-accurate error verbatim and keeps the last valid sim', () => {
    render(<Controls />);
    const input = screen.getByLabelText('Pattern (siteswap)');
    fireEvent.change(input, { target: { value: '52' } });

    const parsed = validatePattern('52');
    const expectedMessage = parsed.ok ? '' : (parsed.errors[0]?.message ?? '');
    expect(expectedMessage).not.toBe('');
    expect(screen.getByRole('alert').textContent).toContain(expectedMessage);

    // Invalid input keeps the last valid simulation running (DESIGN.md §6).
    expect(useAppStore.getState().sim.patternText).toBe('3');
  });

  it('toggles play/pause through the store', () => {
    render(<Controls />);
    // Starts playing → button reads "Pause".
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(useAppStore.getState().playing).toBe(false);
    expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy();
  });

  it('renders the ball-count readout for a valid pattern', () => {
    render(<Controls />);
    expect(screen.getByText(/3 balls/)).toBeTruthy();
  });

  it('exposes the 3D scene controls and toggles orbit coloring through the store', () => {
    render(<Controls />);
    expect(screen.getByLabelText('Ball radius')).toBeTruthy();
    expect(screen.getByLabelText('Ball color')).toBeTruthy();

    const toggle = screen.getByLabelText('Orbit coloring');
    expect(useAppStore.getState().orbitColoring).toBe(false);
    fireEvent.click(toggle);
    expect(useAppStore.getState().orbitColoring).toBe(true);
  });
});
