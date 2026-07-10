// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useAppStore } from '../state';
import { App } from './App';

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
