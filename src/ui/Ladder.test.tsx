// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { useAppStore } from '../state';
import { Ladder } from './Ladder';

beforeEach(() => {
  useAppStore.setState({ simTime: 0, playing: false });
  useAppStore.getState().setPattern('3');
});
afterEach(cleanup);

describe('Ladder (ui layer)', () => {
  it('renders an SVG with one labeled lane per hand', () => {
    render(<Ladder />);
    expect(screen.getByRole('img')).toBeTruthy();
    // n_h = 2 → two hand lanes, labeled with full words.
    expect(screen.getByText('Hand 0')).toBeTruthy();
    expect(screen.getByText('Hand 1')).toBeTruthy();
  });

  it('renders beat-index labels along the axis', () => {
    render(<Ladder />);
    // Beat 0 is at t = 0, inside the startup window.
    expect(screen.getByText('0')).toBeTruthy();
  });
});
