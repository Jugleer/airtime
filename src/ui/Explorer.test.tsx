// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useAppStore } from '../state';
import { Explorer } from './Explorer';

beforeEach(() => {
  // A clean, known store: the 3-ball cascade so the explorer seeds b = 3.
  useAppStore.getState().setHandCount(2);
  useAppStore.getState().setPattern('3');
});
afterEach(cleanup);

describe('Explorer (ui layer)', () => {
  it('renders the query steppers and filter toggles', () => {
    render(<Explorer />);
    expect(screen.getByLabelText('Balls')).toBeTruthy();
    expect(screen.getByLabelText('Period')).toBeTruthy();
    expect(screen.getByLabelText('Max throw')).toBeTruthy();
    expect(screen.getByLabelText('No 0s')).toBeTruthy();
    expect(screen.getByLabelText('No 2s')).toBeTruthy();
    expect(screen.getByLabelText('Prime only')).toBeTruthy();
  });

  it('lists the classic 3-ball period-3 max-5 set as clickable buttons', () => {
    render(<Explorer />);
    const results = within(screen.getByLabelText('Siteswap results'));
    for (const text of ['423', '441', '504', '522', '531']) {
      expect(results.getByLabelText(`Juggle ${text}`)).toBeTruthy();
    }
  });

  it('navigates to the clicked pattern through the store (same path as the pattern box)', () => {
    render(<Explorer />);
    const results = within(screen.getByLabelText('Siteswap results'));
    fireEvent.click(results.getByLabelText('Juggle 531'));
    // navigateToPattern ran: same b (3), so a smooth transition and pattern = 531.
    expect(useAppStore.getState().pattern).toBe('531');
    expect(useAppStore.getState().sim.patternText).toBe('531');
  });

  it('marks the running pattern with aria-current after navigating to it', () => {
    render(<Explorer />);
    let results = within(screen.getByLabelText('Siteswap results'));
    fireEvent.click(results.getByLabelText('Juggle 441'));
    results = within(screen.getByLabelText('Siteswap results'));
    expect(results.getByLabelText('Juggle 441').getAttribute('aria-current')).toBe('true');
    expect(results.getByLabelText('Juggle 531').getAttribute('aria-current')).toBeNull();
  });

  it('applies the No 2s / No 0s filters to the list', () => {
    render(<Explorer />);
    // No 2s drops 423 and 522.
    fireEvent.click(screen.getByLabelText('No 2s'));
    let results = within(screen.getByLabelText('Siteswap results'));
    expect(results.queryByLabelText('Juggle 423')).toBeNull();
    expect(results.queryByLabelText('Juggle 522')).toBeNull();
    expect(results.getByLabelText('Juggle 531')).toBeTruthy();
    // Adding No 0s also drops 504, leaving {441, 531}.
    fireEvent.click(screen.getByLabelText('No 0s'));
    results = within(screen.getByLabelText('Siteswap results'));
    expect(results.queryByLabelText('Juggle 504')).toBeNull();
    expect(results.getByLabelText('Juggle 441')).toBeTruthy();
    expect(results.getByLabelText('Juggle 531')).toBeTruthy();
  });

  it('shows a truncation notice when the result cap is hit', () => {
    render(<Explorer />);
    // Cheapest path to a truncating query: raise max throw first (period-3 counts
    // stay tiny), then raise the period to 7 where 3-ball/max-12 blows past the cap.
    // (Avoids re-rendering hundreds of chips on every intermediate step.)
    for (let i = 5; i < 12; i++) {
      fireEvent.click(screen.getByLabelText('Max throw increase'));
    }
    for (let i = 3; i < 7; i++) {
      fireEvent.click(screen.getByLabelText('Period increase'));
    }
    expect(screen.getByText(/capped at/i)).toBeTruthy();
  }, 30000);

  it('reports an empty result set honestly for an impossible query', () => {
    render(<Explorer />);
    // Max throw 3, period 3 for 3 balls: only 3 (period 1) exists, nothing period-3.
    fireEvent.click(screen.getByLabelText('Max throw decrease')); // 5 -> 4
    fireEvent.click(screen.getByLabelText('Max throw decrease')); // 4 -> 3
    expect(screen.getByText(/No valid siteswaps/i)).toBeTruthy();
  });

  it('caps the results box height only while the dock is at natural height', () => {
    // Undragged dock (capNaturalHeight): a bounded max-height so a large domain
    // scrolls internally instead of growing the dock and crushing the 3D stage.
    const { rerender } = render(<Explorer capNaturalHeight />);
    let results = screen.getByLabelText('Siteswap results') as HTMLElement;
    expect(results.style.maxHeight).toBe('clamp(12rem, 30vh, 22rem)');
    expect(results.style.overflowY).toBe('auto');

    // Dragged dock (fixed height): no cap, so the box flexes to fill the dock and
    // the splitter fully overrides.
    rerender(<Explorer capNaturalHeight={false} />);
    results = screen.getByLabelText('Siteswap results') as HTMLElement;
    expect(results.style.maxHeight).toBe('');
    expect(results.style.overflowY).toBe('auto');
  });

  it('defaults to no height cap when the prop is omitted', () => {
    render(<Explorer />);
    const results = screen.getByLabelText('Siteswap results') as HTMLElement;
    expect(results.style.maxHeight).toBe('');
  });
});
