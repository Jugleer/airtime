// @vitest-environment jsdom
// Accessibility smoke tests for the app shell (a11y pass 2026-07-11): a shared
// focus-visible ring exists, tab order is natural (no positive tabindex hijack),
// key controls are keyboard-reachable and in a sensible DOM order, and the popup
// dialogs move focus in on open and restore it to the launcher on close.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { App } from './App';
import { THEME_CSS } from './theme';

// jsdom has no canvas 2D/WebGL; stub getContext to null (Scene/Charts guard it).
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});
afterEach(cleanup);

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

describe('accessibility: shared focus ring', () => {
  it('ships a single theme-aware :focus-visible ring in the global stylesheet', () => {
    expect(THEME_CSS).toContain(':focus-visible');
    expect(THEME_CSS).toContain('var(--at-accent)');
  });
});

describe('accessibility: tab order', () => {
  it('uses no positive tabindex anywhere (natural DOM tab order)', () => {
    const { container } = render(<App />);
    const withTabIndex = [...container.querySelectorAll('[tabindex]')];
    expect(withTabIndex.length).toBeGreaterThan(0); // the splitters set tabindex
    for (const el of withTabIndex) {
      expect(Number(el.getAttribute('tabindex'))).toBeLessThanOrEqual(0);
    }
  });

  it('reaches the top-bar Help, then the pattern box, Go, and library in order', () => {
    const { container } = render(<App />);
    const order = [...container.querySelectorAll(FOCUSABLE)];
    const idx = (el: Element): number => order.indexOf(el);

    const help = screen.getByLabelText('Help');
    const patternInput = screen.getByLabelText('Pattern (siteswap)');
    const go = screen.getByLabelText('Apply pattern');
    const library = screen.getByLabelText('Pattern library');

    for (const el of [help, patternInput, go, library]) {
      expect(idx(el)).toBeGreaterThanOrEqual(0); // all are keyboard-reachable
    }
    expect(idx(help)).toBeLessThan(idx(patternInput));
    expect(idx(patternInput)).toBeLessThan(idx(go));
    expect(idx(go)).toBeLessThan(idx(library));
  });

  it('lets key controls take focus programmatically (keyboard-operable)', () => {
    render(<App />);
    const patternInput = screen.getByLabelText('Pattern (siteswap)') as HTMLInputElement;
    patternInput.focus();
    expect(document.activeElement).toBe(patternInput);
    const restart = screen.getByLabelText('Restart'); // fixed label (Play/Pause flips)
    restart.focus();
    expect(document.activeElement).toBe(restart);
  });
});

describe('accessibility: dialog focus management', () => {
  it('moves focus into the Help dialog on open and restores it to the launcher on close', () => {
    render(<App />);
    const helpButton = screen.getByLabelText('Help');
    helpButton.focus();
    expect(document.activeElement).toBe(helpButton);

    fireEvent.click(helpButton);
    const dialog = screen.getByRole('dialog', { name: 'Help' });
    // Focus landed inside the dialog (on the dialog container itself here).
    expect(dialog.contains(document.activeElement)).toBe(true);

    fireEvent.click(screen.getByLabelText('Close help'));
    // Dialog unmounted; focus restored to the "?" launcher.
    expect(screen.queryByRole('dialog', { name: 'Help' })).toBeNull();
    expect(document.activeElement).toBe(helpButton);
  });
});
