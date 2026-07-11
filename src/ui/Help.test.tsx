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
    // Post-Settings-drawer copy: Esc documents the help, and the wheel nudge matches
    // widgets.tsx (WHEEL_STEP = 10 of SLIDER_STEPS = 1000 → 1% per notch), not the
    // old "one fine step" / "three steps" / "Settings drawer".
    expect(screen.getByText(/Closes this help/i)).toBeTruthy();
    expect(screen.getByText(/1% of its range per notch/i)).toBeTruthy();
    expect(screen.queryByText(/Settings drawer/i)).toBeNull();
    // Extended notation is documented (sync + multiplex), not vanilla-only.
    expect(screen.getByText('Sync & multiplex')).toBeTruthy();
    expect(screen.getByText(/both hands at once/i)).toBeTruthy();
    expect(screen.getByText(/several balls from one hand/i)).toBeTruthy();
    // Save & share mentions the animated GIF/WebM export.
    expect(screen.getByText(/animated GIF/i)).toBeTruthy();
  });

  it('closes on the Escape key (standard dialog dismissal)', () => {
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
