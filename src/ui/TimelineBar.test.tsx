// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

beforeEach(() => {
  useAppStore.setState({
    simTime: 0,
    playing: false,
    timelineWindow: DEFAULT_TIMELINE_WINDOW,
    trailLength: 0.8,
  });
  useAppStore.getState().setPattern('3');
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
});
