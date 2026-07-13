// src/analytics/goatcounter — cookieless visitor-count beacon (owner round 8).
//
// GoatCounter (https://www.goatcounter.com) is a free, open-source, cookieless
// analytics service: it stores no personal data and reports only aggregate
// counts (visits, referrers, country-level geography from IP, which it does not
// retain). One beacon request per page load is unavoidable on GitHub Pages —
// there is no server to log hits. That single outbound GET is the entire
// footprint: no cookies, no fingerprinting, no consent banner required.
//
// This module splits a PURE builder (no DOM, no env, no side effects) from a
// thin shell that reads env + touches `document`, so the interesting logic is
// unit-testable without a real browser or a real network.
//
// Airtime is a single page (all state lives in the URL query string; DESIGN.md
// §6/§7 — no path routes). GoatCounter's default "one count per full page load"
// behavior is therefore exactly right: scrubbing the timeline or editing a
// share-link query must NOT each register as a separate visit, and this module
// does not wire any per-query-change re-counting.

/** Attributes for the standard GoatCounter async include (their documented snippet). */
export interface GoatCounterScriptAttrs {
  readonly src: string;
  readonly dataGoatcounter: string;
  readonly async: true;
}

/** `id` set on the injected `<script>` so re-invocation can detect it's already there. */
export const GOATCOUNTER_SCRIPT_ID = 'goatcounter-analytics';

/**
 * PURE: the attrs for a GoatCounter include script for a given site `code`
 * (the subdomain the owner registers at goatcounter.com, e.g. `code` for
 * `https://code.goatcounter.com`). No DOM access, no env access, no I/O —
 * just data, so it's trivially testable.
 */
export function buildGoatCounterScriptAttrs(code: string): GoatCounterScriptAttrs {
  return {
    src: '//gc.zgo.at/count.js',
    dataGoatcounter: `https://${code}.goatcounter.com/count`,
    async: true,
  };
}

/**
 * Fallback site code baked into the source. The owner registered this
 * GoatCounter site (https://airtime.goatcounter.com) in round 8
 * (2026-07-13), so analytics is now LIVE in production builds: the PROD
 * gate in `resolveAnalyticsConfig` is the only thing keeping dev/test
 * beacon-free. Prefer setting `VITE_GOATCOUNTER_CODE` at build time over
 * editing this constant (e.g. to point a fork or preview deploy elsewhere).
 */
export const GOATCOUNTER_CODE = 'airtime';

/** Resolved enable/code decision — the thing `applyAnalytics` needs to act. */
export interface AnalyticsConfig {
  readonly enabled: boolean;
  readonly code: string;
}

/**
 * Resolve the config from the Vite build env. Analytics is enabled only when
 * BOTH: this is a production build (`import.meta.env.PROD`) AND a non-empty
 * site code is configured (env var, falling back to the source constant).
 * Dev/test builds and unconfigured prod builds both resolve to `enabled: false`.
 */
export function resolveAnalyticsConfig(): AnalyticsConfig {
  const code = (import.meta.env.VITE_GOATCOUNTER_CODE as string | undefined) || GOATCOUNTER_CODE;
  return { enabled: import.meta.env.PROD === true && code.length > 0, code };
}

/**
 * SHELL core, but deterministic and DOM-only (no env reads): given a resolved
 * config and a `Document`, inject the GoatCounter script iff enabled — and
 * guard against double-injection (StrictMode double-invoke, HMR, repeated
 * calls) by checking for the marker id first. Takes `doc` as a parameter (not
 * a hidden `document` reference) so tests are deterministic with no real
 * network and no reliance on NODE_ENV/env mocking.
 */
export function applyAnalytics(config: AnalyticsConfig, doc: Document): void {
  if (!config.enabled || config.code.length === 0) {
    return;
  }
  if (doc.getElementById(GOATCOUNTER_SCRIPT_ID)) {
    return;
  }
  const attrs = buildGoatCounterScriptAttrs(config.code);
  const script = doc.createElement('script');
  script.id = GOATCOUNTER_SCRIPT_ID;
  script.src = attrs.src;
  script.async = attrs.async;
  script.setAttribute('data-goatcounter', attrs.dataGoatcounter);
  doc.head.appendChild(script);
}

/**
 * Call once at app boot (src/main.tsx). No-op in dev/test (the PROD gate);
 * live in production builds against the owner's registered site code — see
 * GOATCOUNTER_CODE / VITE_GOATCOUNTER_CODE above.
 */
export function initAnalytics(doc: Document = document): void {
  applyAnalytics(resolveAnalyticsConfig(), doc);
}
