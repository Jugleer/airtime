// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, renderHook, screen } from '@testing-library/react';
import { useAppStore } from '../state';
import { ballPaletteColor } from '../state/ballColors';
import { useBallColorResolver } from '../render3d/useBallColors';
import { Ladder } from './Ladder';

beforeEach(() => {
  useAppStore.setState({ simTime: 0, playing: false });
  useAppStore.getState().setPattern('3');
});
afterEach(cleanup);

describe('Ladder (ui layer)', () => {
  it('renders an SVG with one labeled column per hand', () => {
    render(<Ladder />);
    expect(screen.getByRole('img')).toBeTruthy();
    // n_h = 2 → two hand columns, labeled with full words (compact HN above n_h=4).
    expect(screen.getByText('Hand 0')).toBeTruthy();
    expect(screen.getByText('Hand 1')).toBeTruthy();
  });

  it('renders beat-index labels along the (left) axis', () => {
    render(<Ladder />);
    // Beat 0 is at t = 0, inside the startup window.
    expect(screen.getByText('0')).toBeTruthy();
  });

  it('is laid out VERTICALLY: hand columns run top→bottom, the cursor is horizontal', () => {
    // Transposed geometry (owner override 2026-07-11): time is the vertical axis and
    // hands are columns, so the full-height lane lines are VERTICAL (x1 === x2 over
    // the whole plot band) and the shared simTime cursor is a HORIZONTAL line — the
    // opposite of the previous horizontal ladder.
    const { container } = render(<Ladder />);
    const lines = [...container.querySelectorAll('line')];
    const isVertical = (l: SVGLineElement): boolean => l.getAttribute('x1') === l.getAttribute('x2');
    const isHorizontal = (l: SVGLineElement): boolean => l.getAttribute('y1') === l.getAttribute('y2');
    // One full-height column line per hand (PLOT_TOP=30 → PLOT_BOTTOM=790).
    const handColumns = lines.filter(
      (l) => isVertical(l) && l.getAttribute('y1') === '30' && l.getAttribute('y2') === '790',
    );
    expect(handColumns.length).toBe(2);
    // At least one horizontal line exists (beat rows and/or the cursor).
    expect(lines.some(isHorizontal)).toBe(true);
  });
});

describe('ladder ↔ 3D per-ball color agreement (shared resolveBallColor)', () => {
  it('colors every arc and carry exactly as the 3D resolver colors that ballId', () => {
    for (const pattern of ['531', '97531', '633']) {
      useAppStore.getState().setPattern(pattern);
      useAppStore.setState({ simTime: 1.5, playing: false, orbitColoring: true });

      const view = render(<Ladder />);
      const hook = renderHook(() => useBallColorResolver());
      const colorOf = hook.result.current; // the exact function <Balls>/<Tracers> use

      const marks = view.container.querySelectorAll('[data-ball-id]');
      expect(marks.length).toBeGreaterThan(0);
      const ballIds = new Set<number>();
      marks.forEach((mark) => {
        const ballId = Number(mark.getAttribute('data-ball-id'));
        expect(Number.isInteger(ballId)).toBe(true);
        // Same string through both paths: ladder stroke === 3D resolver output.
        expect(mark.getAttribute('stroke')).toBe(colorOf(ballId));
        expect(colorOf(ballId)).toBe(ballPaletteColor(ballId));
        ballIds.add(ballId);
      });
      // Multi-ball patterns show several distinctly colored balls in the window.
      expect(ballIds.size).toBeGreaterThanOrEqual(2);
      expect(new Set([...ballIds].map(ballPaletteColor)).size).toBe(ballIds.size);

      hook.unmount();
      view.unmount();
    }
  });

  it('toggle off: the ladder and the 3D resolver both use the single ball color', () => {
    useAppStore.getState().setPattern('531');
    useAppStore.setState({
      simTime: 1.5,
      playing: false,
      orbitColoring: false,
      ballColor: '#123456',
    });

    const view = render(<Ladder />);
    const hook = renderHook(() => useBallColorResolver());

    const marks = view.container.querySelectorAll('[data-ball-id]');
    expect(marks.length).toBeGreaterThan(0);
    marks.forEach((mark) => {
      expect(mark.getAttribute('stroke')).toBe('#123456');
    });
    for (const ballId of [0, 1, 2, 7]) {
      expect(hook.result.current(ballId)).toBe('#123456');
    }
    hook.unmount();
  });
});
