// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useAppStore } from '../state';
import { DEFAULT_TIMELINE_WINDOW } from '../state/simulation';
import { TimelineBar } from './TimelineBar';

// jsdom lacks PointerEvent + pointer capture; polyfill just enough for the scrub
// gesture (a MouseEvent-backed PointerEvent carries clientX; capture is a no-op).
class TestPointerEvent extends MouseEvent {
  readonly pointerId: number;
  constructor(type: string, params: MouseEventInit & { pointerId?: number } = {}) {
    super(type, params);
    this.pointerId = params.pointerId ?? 1;
  }
}
const globalWithPointer = globalThis as unknown as { PointerEvent?: unknown };
if (typeof globalWithPointer.PointerEvent === 'undefined') {
  globalWithPointer.PointerEvent = TestPointerEvent;
}
const proto = Element.prototype as unknown as {
  setPointerCapture?: (id: number) => void;
  releasePointerCapture?: (id: number) => void;
};
if (typeof proto.setPointerCapture !== 'function') {
  proto.setPointerCapture = () => {};
}
if (typeof proto.releasePointerCapture !== 'function') {
  proto.releasePointerCapture = () => {};
}

// jsdom does no layout, so every element's `clientWidth` is always 0 and there is no
// ResizeObserver at all — poor fits for TimelineBar's measured-width behavior. Stub
// both: `clientWidth` reads a mutable module variable each test controls, and a fake
// ResizeObserver records its instances so a test can fire its callback manually to
// simulate a live panel resize (no real layout engine needed to exercise the wiring).
let stubbedClientWidth = 1000;
Object.defineProperty(Element.prototype, 'clientWidth', {
  configurable: true,
  get: () => stubbedClientWidth,
});

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  private readonly callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    FakeResizeObserver.instances.push(this);
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  /** Simulate the browser firing this observer's callback (a resize occurred). */
  trigger(): void {
    this.callback([], this as unknown as ResizeObserver);
  }
}
const globalWithResizeObserver = globalThis as unknown as { ResizeObserver?: unknown };
if (typeof globalWithResizeObserver.ResizeObserver === 'undefined') {
  globalWithResizeObserver.ResizeObserver = FakeResizeObserver;
}

beforeEach(() => {
  useAppStore.setState({
    simTime: 0,
    playing: false,
    timelineWindow: DEFAULT_TIMELINE_WINDOW,
    trailLength: 0.8,
  });
  useAppStore.getState().setPattern('3');
  // Default to the same 1000 px width the pre-fix bar used as its fixed logical
  // span, so the existing pointer-math tests below need no numeric changes.
  stubbedClientWidth = 1000;
  FakeResizeObserver.instances = [];
});
afterEach(cleanup);

describe('TimelineBar (ui layer)', () => {
  it('renders the bar SVG and the separate period readout', () => {
    render(<TimelineBar />);
    expect(screen.getByRole('img')).toBeTruthy();
    expect(screen.getByText(/pattern repeats every/)).toBeTruthy();
    // 3 at n_h=2 repeats every 2 beats × 0.25 s = 0.50 s.
    expect(screen.getByText(/repeats every 0\.50 s/)).toBeTruthy();
  });

  it('draws the mini-ladder background (per-hand lanes + event ticks)', () => {
    const { container } = render(<TimelineBar />);
    // Two hand lanes at n_h = 2, plus beat gridlines and throw ticks.
    expect(container.querySelectorAll('line').length).toBeGreaterThan(2);
    // Catch ticks are hollow rings — at least one is inside the startup window.
    expect(container.querySelectorAll('circle').length).toBeGreaterThan(0);
  });

  it('scrubbing the bar sets simTime directly (pointer drag)', () => {
    render(<TimelineBar />);
    const svg = screen.getByRole('img') as unknown as SVGSVGElement;
    // Fixed logical→pixel map: 1000 logical units over a 1000 px wide element.
    svg.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 1000, height: 96, right: 1000, bottom: 96, x: 0, y: 0 }) as DOMRect;

    // Window is frozen at grab time: originStart = simTime(0) − pastSpan(0.9) = −0.9.
    // Click at clientX = 500 ⇒ logicalX 500 ⇒ t = −0.9 + ((500−10)/980)·3 = 0.6 s.
    fireEvent.pointerDown(svg, { clientX: 500, pointerId: 1 });
    expect(useAppStore.getState().simTime).toBeCloseTo(0.6, 6);

    fireEvent.pointerUp(svg, { clientX: 500, pointerId: 1 });
  });

  it('clamps a scrub before t = 0 to zero', () => {
    render(<TimelineBar />);
    const svg = screen.getByRole('img') as unknown as SVGSVGElement;
    svg.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 1000, height: 96, right: 1000, bottom: 96, x: 0, y: 0 }) as DOMRect;
    // clientX = 10 ⇒ logicalX 10 ⇒ t = windowStart = −0.9 ⇒ clamped to 0.
    fireEvent.pointerDown(svg, { clientX: 10, pointerId: 1 });
    expect(useAppStore.getState().simTime).toBe(0);
    fireEvent.pointerUp(svg, { clientX: 10, pointerId: 1 });
  });

  // Regression coverage for the text-stretch bug: the bar used to render a fixed
  // 1000×96 viewBox at width="100%" with preserveAspectRatio="none", so any
  // container narrower/wider than 1000 px scaled x and y independently and
  // stretched/squashed the "H<N>" lane tags and time labels. It now lays out 1:1 in
  // the wrapper's measured width (real CSS px), so the viewBox/width track that
  // measurement instead of a fixed logical span.
  it('lays out the plot from the measured container width, not a fixed logical span', () => {
    stubbedClientWidth = 640;
    const { container } = render(<TimelineBar />);
    const svg = screen.getByRole('img');
    // viewBox width == rendered width == the measured container width: a 1:1
    // coordinate space, so text glyphs are never non-uniformly scaled.
    expect(svg.getAttribute('viewBox')).toBe('0 0 640 96');
    expect(svg.getAttribute('width')).toBe('640');
    // The right-edge time label sits at the measured plot's right margin (640 − 10 px
    // gutter − 2 px inset = 628), not the old hardcoded 990 − 2 = 988.
    const endLabel = container.querySelector('text[text-anchor="end"]');
    expect(endLabel?.getAttribute('x')).toBe('628');
  });

  it('re-lays-out live when the wrapper resizes (panel-splitter drag or window resize)', () => {
    const { container } = render(<TimelineBar />);
    const svg = screen.getByRole('img');
    expect(svg.getAttribute('width')).toBe('1000');

    // A panel-splitter drag resizes the wrapper element without ever firing a
    // window 'resize' event — only a ResizeObserver notices it. Simulate exactly
    // that: the measured width changes, then the observer's callback fires.
    stubbedClientWidth = 500;
    const observer = FakeResizeObserver.instances[FakeResizeObserver.instances.length - 1];
    expect(observer).toBeDefined();
    act(() => observer?.trigger());

    expect(svg.getAttribute('width')).toBe('500');
    expect(svg.getAttribute('viewBox')).toBe('0 0 500 96');
    const endLabel = container.querySelector('text[text-anchor="end"]');
    expect(endLabel?.getAttribute('x')).toBe('488'); // 500 − 10 px gutter − 2 px inset
  });
});
