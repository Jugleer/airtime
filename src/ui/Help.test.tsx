// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Help } from './Help';

afterEach(cleanup);

describe('Help modal (ui layer)', () => {
  it('opens from the ? button and documents siteswap, controls, and keyboard', () => {
    render(<Help />);
    // Closed: the modal body is not mounted.
    expect(screen.queryByRole('dialog', { name: 'Help' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    expect(screen.getByRole('dialog', { name: 'Help' })).toBeTruthy();

    // The keyboard affordances (Space play/pause, wheel-nudge) are now discoverable.
    expect(screen.getByText('Keyboard & mouse')).toBeTruthy();
    expect(screen.getByText('Space')).toBeTruthy();
    expect(screen.getByText(/Play or pause/i)).toBeTruthy();
  });

  it('closes on the Escape key, mirroring the Settings drawer', () => {
    render(<Help />);
    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    expect(screen.getByRole('dialog', { name: 'Help' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Help' })).toBeNull();
  });

  it('closes on the explicit close button', () => {
    render(<Help />);
    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close help' }));
    expect(screen.queryByRole('dialog', { name: 'Help' })).toBeNull();
  });
});
