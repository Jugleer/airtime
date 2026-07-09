// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useAppStore } from '../state';
import { Charts } from './Charts';

// jsdom has no canvas 2D backend; stub getContext to return null cleanly (the
// component guards null and skips drawing). We assert the DOM/values, not pixels.
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

beforeEach(() => {
  useAppStore.setState({ simTime: 0, playing: false, chartsVisible: true, chartAxisMode: 'magnitude' });
  useAppStore.getState().setHandCount(2);
  useAppStore.getState().setPattern('3');
});
afterEach(cleanup);

describe('Charts (ui layer)', () => {
  it('renders the collapsible section heading and the three canvas charts', () => {
    render(<Charts />);
    expect(screen.getByText('Charts & energy')).toBeTruthy();
    expect(screen.getByLabelText('Hand speed chart')).toBeTruthy();
    expect(screen.getByLabelText('Hand acceleration chart')).toBeTruthy();
    expect(screen.getByLabelText('Hand jerk chart')).toBeTruthy();
  });

  it('shows a legend entry per hand', () => {
    render(<Charts />);
    const legend = within(screen.getByRole('group', { name: 'Chart legend' }));
    expect(legend.getByText('Hand 0')).toBeTruthy();
    expect(legend.getByText('Hand 1')).toBeTruthy();
  });

  it('renders the energy table with full-word headers and a totals row', () => {
    render(<Charts />);
    expect(screen.getByText('Throw work')).toBeTruthy();
    expect(screen.getByText('Catch absorption')).toBeTruthy();
    expect(screen.getByText('Average power')).toBeTruthy();
    expect(screen.getByText('Total')).toBeTruthy();
  });

  it('hides the charts (unmounts the canvases) when the toggle is clicked', () => {
    render(<Charts />);
    expect(screen.queryByLabelText('Hand speed chart')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Toggle charts and energy panel'));
    expect(useAppStore.getState().chartsVisible).toBe(false);
    // Body unmounted: no canvases, no energy table ⇒ no per-frame sampling.
    expect(screen.queryByLabelText('Hand speed chart')).toBeNull();
    expect(screen.queryByText('Throw work')).toBeNull();
  });

  it('switches the axis mode via the component selector', () => {
    render(<Charts />);
    expect(useAppStore.getState().chartAxisMode).toBe('magnitude');
    fireEvent.click(screen.getByLabelText('Chart component: X'));
    expect(useAppStore.getState().chartAxisMode).toBe('x');
    fireEvent.click(screen.getByLabelText('Chart component: Y'));
    expect(useAppStore.getState().chartAxisMode).toBe('y');
  });

  it('mounts without throwing even though canvas 2D is unavailable (guarded)', () => {
    // The draw effect calls getContext (stubbed to null); the guard must no-op.
    expect(() => render(<Charts />)).not.toThrow();
  });
});
