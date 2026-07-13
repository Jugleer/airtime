// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useAppStore } from '../state';
import { App } from './App';
import { FeedbackButtons } from './Feedback';

// App mounts the charts panel, whose canvases call getContext('2d'); jsdom has no
// canvas 2D backend, so stub it to null (mirrors App.test.tsx).
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() =>
    null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

beforeEach(() => {
  localStorage.clear();
  useAppStore.getState().hardReset();
  useAppStore.getState().setPattern('531');
});
afterEach(cleanup);

/** GitHub's new-issue endpoint, before the prefill query. */
const NEW_ISSUE = 'https://github.com/Jugleer/airtime/issues/new';

/** Decode a rendered feedback anchor into its endpoint + prefill params. */
function readIssueLink(link: HTMLAnchorElement): {
  endpoint: string;
  labels: string | null;
  title: string | null;
  body: string;
} {
  const url = new URL(link.href);
  return {
    endpoint: `${url.origin}${url.pathname}`,
    labels: url.searchParams.get('labels'),
    title: url.searchParams.get('title'),
    body: url.searchParams.get('body') ?? '',
  };
}

describe('Feedback buttons (ui layer)', () => {
  it('renders the bug + feature links next to Help in the top bar', () => {
    const { container } = render(<App />);
    const header = container.querySelector('header');
    expect(header).not.toBeNull();

    const bug = screen.getByRole('link', { name: /report a bug/i });
    const feature = screen.getByRole('link', { name: /suggest a feature/i });
    const help = screen.getByRole('button', { name: 'Help' });

    // All three live in the top bar, grouped in the same right-hand cluster.
    expect(header!.contains(bug)).toBe(true);
    expect(header!.contains(feature)).toBe(true);
    expect(header!.contains(help)).toBe(true);
    expect(help.parentElement?.contains(bug)).toBe(true);
    expect(help.parentElement?.contains(feature)).toBe(true);

    // Both feedback controls open a new tab safely.
    for (const link of [bug, feature] as HTMLAnchorElement[]) {
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    }
  });

  it('bug link opens a prefilled GitHub bug issue with a reproduction share link', () => {
    render(<FeedbackButtons />);
    const bug = screen.getByRole('link', { name: /report a bug/i }) as HTMLAnchorElement;

    expect(bug.getAttribute('target')).toBe('_blank');
    expect(bug.getAttribute('rel')).toBe('noopener noreferrer');

    const { endpoint, labels, body } = readIssueLink(bug);
    expect(endpoint).toBe(NEW_ISSUE);
    expect(labels).toBe('bug');

    // The environment block carries the reproduction (a versioned share link with
    // the running pattern), the user agent, and a scaffold to fill in.
    expect(body).toContain('What happened');
    expect(body).toContain('Reproduction link:');
    expect(body).toContain('?v=1');
    expect(body).toContain('p=531');
    expect(body).toContain(navigator.userAgent);
  });

  it('feature link carries labels=enhancement and opens in a new tab', () => {
    render(<FeedbackButtons />);
    const feature = screen.getByRole('link', {
      name: /suggest a feature/i,
    }) as HTMLAnchorElement;

    expect(feature.getAttribute('target')).toBe('_blank');
    expect(feature.getAttribute('rel')).toBe('noopener noreferrer');

    const { endpoint, labels, body } = readIssueLink(feature);
    expect(endpoint).toBe(NEW_ISSUE);
    expect(labels).toBe('enhancement');
    expect(body).toContain('What');
    expect(body).toContain('Why');
  });

  it('rebuilds the reproduction link from live state at interaction time', () => {
    // Standalone FeedbackButtons does not subscribe to the pattern, so the
    // render-time href stays at 531; the interaction handler must refresh it.
    render(<FeedbackButtons />);
    const bug = screen.getByRole('link', { name: /report a bug/i }) as HTMLAnchorElement;
    expect(readIssueLink(bug).body).toContain('p=531');

    useAppStore.getState().setPattern('3');
    fireEvent.mouseDown(bug);
    expect(readIssueLink(bug).body).toContain('p=3');
  });
});
