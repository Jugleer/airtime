// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
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
});
