// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { App } from './App';

afterEach(cleanup);

describe('App (ui layer)', () => {
  it('renders the Airtime heading and the default pattern from the store', () => {
    const { container } = render(<App />);
    expect(container.textContent).toContain('Airtime');
    expect(container.textContent).toContain('3');
  });
});
