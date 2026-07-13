// src/ui/Feedback — the top-bar feedback controls (owner round 8; a narrow,
// owner-authorized exception to the "no external requests" rule: OUTBOUND
// navigation only, no fetch/beacon). Two links — "Report a bug" and "Suggest a
// feature" — open GitHub's new-issue form in a new tab, PREFILLED and ready to
// submit (account-required path, no backend).
//
// The valuable part is one-click reproduction: the bug body carries the current
// scene as a fresh share link, rebuilt from the LIVE store at CLICK time (the
// address bar is only synced when the user clicks Copy, so it is stale — we never
// read window.location.href). GitHub's query-param prefill (title/body/labels on
// /issues/new) opens a blank prefilled editor as long as blank issues stay
// enabled, so .github/ISSUE_TEMPLATE ships WITHOUT a config.yml disabling them.

import { type CSSProperties, type ReactElement, type ReactNode, type SyntheticEvent } from 'react';
import { useAppStore } from '../state';
import { usePalette, type Palette } from './theme';
import { shareUrlFor } from './shareUrl';

/** GitHub's blank-issue endpoint; query params (title/body/labels) prefill it. */
const NEW_ISSUE_URL = 'https://github.com/Jugleer/airtime/issues/new';

/**
 * Assemble a prefilled GitHub new-issue URL. Every value is percent-encoded with
 * encodeURIComponent so the (multi-line, symbol-rich) body and the embedded share
 * link survive intact — the share link's own `?…&…=` never leaks into GitHub's
 * query string.
 */
function newIssueHref(labels: string, title: string, body: string): string {
  const query =
    `title=${encodeURIComponent(title)}` +
    `&labels=${encodeURIComponent(labels)}` +
    `&body=${encodeURIComponent(body)}`;
  return `${NEW_ISSUE_URL}?${query}`;
}

/** Read the environment facts a maintainer needs to reproduce (guarded for SSR/tests). */
function environment(): { userAgent: string; viewport: string } {
  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown';
  const viewport =
    typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : 'unknown';
  return { userAgent, viewport };
}

/** Build the bug-report href from the LIVE store config (call inside a handler). */
function buildBugHref(): string {
  const config = useAppStore.getState().currentConfig();
  const repro = shareUrlFor(config);
  const { userAgent, viewport } = environment();
  const body = [
    '## What happened',
    '',
    '<!-- Describe the bug. What did you see? -->',
    '',
    '## What you expected',
    '',
    '<!-- What should have happened instead? -->',
    '',
    '---',
    '### Environment (auto-filled — please keep the link so the bug can be reproduced)',
    '',
    `- Reproduction link: ${repro}`,
    `- Pattern: ${config.pattern}`,
    `- User agent: ${userAgent}`,
    `- Viewport: ${viewport}`,
  ].join('\n');
  return newIssueHref('bug', 'Bug: ', body);
}

/** Build the feature-request href; the share link rides along as optional context. */
function buildFeatureHref(): string {
  const config = useAppStore.getState().currentConfig();
  const repro = shareUrlFor(config);
  const body = [
    '## What',
    '',
    '<!-- The feature or change you would like. -->',
    '',
    '## Why',
    '',
    '<!-- The problem it solves or the value it adds. -->',
    '',
    '## Who benefits',
    '',
    '<!-- Beginners, performers, developers…? -->',
    '',
    '---',
    `Current scene (optional context): ${repro}`,
  ].join('\n');
  return newIssueHref('enhancement', 'Feature: ', body);
}

/**
 * One feedback link, styled as a compact top-bar button. The href is built at
 * render for right-/middle-click "open in new tab", then rebuilt on every real
 * interaction (pointer press, keyboard focus, click) so the outgoing link always
 * reflects the state at the moment of the click.
 */
function FeedbackLink({
  build,
  ariaLabel,
  title,
  palette,
  children,
}: {
  readonly build: () => string;
  readonly ariaLabel: string;
  readonly title: string;
  readonly palette: Palette;
  readonly children: ReactNode;
}): ReactElement {
  const refresh = (event: SyntheticEvent<HTMLAnchorElement>): void => {
    event.currentTarget.href = build();
  };
  return (
    <a
      href={build()}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={ariaLabel}
      title={title}
      style={feedbackButtonStyle(palette)}
      onFocus={refresh}
      onMouseDown={refresh}
      onClick={refresh}
    >
      {children}
    </a>
  );
}

/** The two feedback links, rendered as siblings of the Help button in the top bar. */
export function FeedbackButtons(): ReactElement {
  const palette = usePalette();
  return (
    <>
      <FeedbackLink
        build={buildBugHref}
        ariaLabel="Report a bug on GitHub (opens a prefilled issue in a new tab)"
        title="Report a bug — opens a prefilled GitHub issue with a link to this scene"
        palette={palette}
      >
        Report a bug
      </FeedbackLink>
      <FeedbackLink
        build={buildFeatureHref}
        ariaLabel="Suggest a feature on GitHub (opens a prefilled issue in a new tab)"
        title="Suggest a feature — opens a prefilled GitHub issue"
        palette={palette}
      >
        Suggest a feature
      </FeedbackLink>
    </>
  );
}

// --- Inline styling (theme-aware, dark-first; mirrors Help's helpButtonStyle) ---

function feedbackButtonStyle(palette: Palette): CSSProperties {
  return {
    height: '2.1rem',
    padding: '0 0.7rem',
    display: 'inline-flex',
    alignItems: 'center',
    borderRadius: '0.5rem',
    border: `1px solid ${palette.border}`,
    background: palette.panelAlt,
    fontWeight: 600,
    fontSize: '0.8rem',
    color: palette.textPrimary,
    cursor: 'pointer',
    lineHeight: 1,
    whiteSpace: 'nowrap',
    textDecoration: 'none',
    flexShrink: 0,
  };
}
