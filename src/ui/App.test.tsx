// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useAppStore } from '../state';
import { App } from './App';

/** Install a matchMedia mock reporting a fixed `matches` (drives useIsNarrow). */
function mockMatchMedia(matches: boolean): void {
  window.matchMedia = ((query: string) =>
    ({
      matches,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
}

// App mounts the charts panel, whose canvases call getContext('2d'); jsdom has no
// canvas 2D backend, so stub it to null (the charts guard null and skip drawing).
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

afterEach(cleanup);

describe('App (ui layer)', () => {
  it('renders the Airtime heading and the default pattern from the store', () => {
    const { container } = render(<App />);
    expect(container.textContent).toContain('Airtime');
    expect(container.textContent).toContain('3');
  });

  it('Space toggles play/pause, but not while typing in the pattern input', () => {
    render(<App />);
    useAppStore.setState({ playing: false });

    // Space anywhere on the page (not a typing control) toggles play/pause.
    fireEvent.keyDown(document.body, { code: 'Space', key: ' ' });
    expect(useAppStore.getState().playing).toBe(true);
    fireEvent.keyDown(document.body, { code: 'Space', key: ' ' });
    expect(useAppStore.getState().playing).toBe(false);

    // Space inside the pattern input keeps its typing meaning (no toggle).
    const input = screen.getByLabelText('Pattern (siteswap)');
    fireEvent.keyDown(input, { code: 'Space', key: ' ' });
    expect(useAppStore.getState().playing).toBe(false);
  });
});

describe('App (narrow / mobile shell)', () => {
  afterEach(() => {
    // Restore jsdom's default (matchMedia absent) so other suites see the desktop shell.
    // @ts-expect-error clearing the mock between suites
    delete window.matchMedia;
  });

  it('renders the tabbed mobile shell (scene + tab bar) when the viewport is narrow', () => {
    mockMatchMedia(true);
    render(<App />);

    // The stage (with its docked timeline) is always visible atop the column.
    expect(screen.getByLabelText('Timeline bar')).toBeTruthy();
    // The bottom tab bar and all five opt-in panel tabs are present.
    expect(screen.getByRole('group', { name: 'Panels' })).toBeTruthy();
    for (const label of ['Controls', 'Ladder', 'Charts', 'Explorer', 'Share']) {
      expect(screen.getByLabelText(`Panel: ${label}`)).toBeTruthy();
    }

    // Selecting a tab swaps the panel body: the Explorer tab shows its results grid.
    fireEvent.click(screen.getByLabelText('Panel: Explorer'));
    expect(screen.getByLabelText('Siteswap results')).toBeTruthy();
  });

  it('does NOT render the mobile tab bar on a wide viewport (desktop grid)', () => {
    mockMatchMedia(false);
    render(<App />);
    expect(screen.queryByRole('group', { name: 'Panels' })).toBeNull();
  });
});
