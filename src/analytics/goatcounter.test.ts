// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  applyAnalytics,
  buildGoatCounterScriptAttrs,
  GOATCOUNTER_CODE,
  GOATCOUNTER_SCRIPT_ID,
  initAnalytics,
} from './goatcounter';

describe('buildGoatCounterScriptAttrs (pure)', () => {
  it('builds the standard async GoatCounter include for a given site code', () => {
    const attrs = buildGoatCounterScriptAttrs('mysite');
    expect(attrs.src).toBe('//gc.zgo.at/count.js');
    expect(attrs.dataGoatcounter).toBe('https://mysite.goatcounter.com/count');
    expect(attrs.async).toBe(true);
  });

  it('interpolates the code into the subdomain only (no other code paths)', () => {
    const attrs = buildGoatCounterScriptAttrs('another-code');
    expect(attrs.dataGoatcounter).toBe('https://another-code.goatcounter.com/count');
  });
});

describe('the shipped default site code', () => {
  it('defaults to empty (analytics disabled until the owner configures a code)', () => {
    expect(GOATCOUNTER_CODE).toBe('');
  });
});

describe('applyAnalytics (deterministic shell core)', () => {
  function freshDoc(): Document {
    return document.implementation.createHTMLDocument('test');
  }

  it('is a no-op when disabled, even with a real code (nothing appended to head)', () => {
    const doc = freshDoc();
    applyAnalytics({ enabled: false, code: 'realcode' }, doc);
    expect(doc.getElementById(GOATCOUNTER_SCRIPT_ID)).toBeNull();
    expect(doc.head.querySelector('script')).toBeNull();
  });

  it('is a no-op when enabled but the code is empty', () => {
    const doc = freshDoc();
    applyAnalytics({ enabled: true, code: '' }, doc);
    expect(doc.getElementById(GOATCOUNTER_SCRIPT_ID)).toBeNull();
    expect(doc.head.querySelector('script')).toBeNull();
  });

  it('injects a correctly-configured async script when enabled with a code', () => {
    const doc = freshDoc();
    applyAnalytics({ enabled: true, code: 'jugglecode' }, doc);
    const script = doc.getElementById(GOATCOUNTER_SCRIPT_ID) as HTMLScriptElement | null;
    expect(script).not.toBeNull();
    expect(script?.tagName).toBe('SCRIPT');
    expect(script?.src).toContain('//gc.zgo.at/count.js');
    expect(script?.async).toBe(true);
    expect(script?.getAttribute('data-goatcounter')).toBe(
      'https://jugglecode.goatcounter.com/count',
    );
    expect(doc.head.contains(script)).toBe(true);
  });

  it('guards against double-injection: a second call appends no second script', () => {
    const doc = freshDoc();
    applyAnalytics({ enabled: true, code: 'jugglecode' }, doc);
    applyAnalytics({ enabled: true, code: 'jugglecode' }, doc);
    expect(doc.head.querySelectorAll('script').length).toBe(1);
  });
});

describe('initAnalytics (real env-reading entry point)', () => {
  it('is a no-op under the test/dev build (not PROD) with the shipped empty default code', () => {
    // The gate runs under vitest, never a production build, and the shipped
    // GOATCOUNTER_CODE defaults to '' — so both halves of the enable check are
    // false here, belt-and-suspenders with the real (non-jsdom-swapped) document.
    initAnalytics(document);
    expect(document.getElementById(GOATCOUNTER_SCRIPT_ID)).toBeNull();
  });
});
