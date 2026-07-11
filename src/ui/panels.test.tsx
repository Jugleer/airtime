// @vitest-environment jsdom
// The resizable-panel primitives (owner 2026-07-11): persisted sizes/collapse via
// useLayout (localStorage only — never the store or URL codec), the draggable
// Splitter (pointer + keyboard, clamped), and the collapse/expand affordances.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useState, type ReactElement } from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import {
  CollapseButton,
  CollapsedStrip,
  DEFAULT_LAYOUT,
  KEYBOARD_STEP,
  LAYOUT_STORAGE_KEY,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  Splitter,
  readLayout,
  useLayout,
} from './panels';

// jsdom lacks a clientX-carrying PointerEvent; back it with MouseEvent (mirrors the
// TimelineBar scrub test). Pointer capture is unused (drag listens on window).
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

/** Widen the viewport so useLayout's stage-protection clamp doesn't pin panels. */
function setViewport(width: number): void {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
}

beforeEach(() => {
  localStorage.clear();
  setViewport(2000);
});
afterEach(cleanup);

describe('useLayout persistence + clamping', () => {
  it('starts at the defaults (reproduces the pre-splitter layout)', () => {
    const { result } = renderHook(() => useLayout());
    expect(result.current.sidebarWidth).toBe(DEFAULT_LAYOUT.sidebarWidth);
    expect(result.current.ladderWidth).toBe(DEFAULT_LAYOUT.ladderWidth);
    expect(result.current.dockHeight).toBeNull();
    expect(result.current.leftCollapsed).toBe(false);
  });

  it('persists a size change to localStorage and reads it back', () => {
    const first = renderHook(() => useLayout());
    act(() => first.result.current.setSidebarWidth(420));
    expect(first.result.current.sidebarWidth).toBe(420);

    const stored = JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) ?? '{}');
    expect(stored.sidebarWidth).toBe(420);

    // A fresh mount reads the persisted value.
    const second = renderHook(() => useLayout());
    expect(second.result.current.sidebarWidth).toBe(420);
  });

  it('clamps sizes to their static bounds', () => {
    const { result } = renderHook(() => useLayout());
    act(() => result.current.setSidebarWidth(99999));
    expect(result.current.sidebarWidth).toBe(SIDEBAR_MAX);
    act(() => result.current.setSidebarWidth(1));
    expect(result.current.sidebarWidth).toBe(SIDEBAR_MIN);
  });

  it('toggles collapse flags', () => {
    const { result } = renderHook(() => useLayout());
    act(() => result.current.toggleLeftCollapsed());
    expect(result.current.leftCollapsed).toBe(true);
    act(() => result.current.toggleLadderCollapsed());
    expect(result.current.ladderCollapsed).toBe(true);
  });

  it('readLayout falls back to defaults on garbage', () => {
    localStorage.setItem(LAYOUT_STORAGE_KEY, '{not json');
    expect(readLayout()).toEqual(DEFAULT_LAYOUT);
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({ sidebarWidth: 'wide' }));
    expect(readLayout().sidebarWidth).toBe(DEFAULT_LAYOUT.sidebarWidth);
  });
});

function SplitterHarness({
  initial,
  sign,
  min = SIDEBAR_MIN,
  max = SIDEBAR_MAX,
  disabled = false,
}: {
  readonly initial: number;
  readonly sign: 1 | -1;
  readonly min?: number;
  readonly max?: number;
  readonly disabled?: boolean;
}): ReactElement {
  const [value, setValue] = useState(initial);
  return (
    <>
      <Splitter
        orientation="vertical"
        value={value}
        min={min}
        max={max}
        sign={sign}
        ariaLabel="Resize sidebar"
        disabled={disabled}
        onChange={setValue}
      />
      <output data-testid="v">{value}</output>
    </>
  );
}

describe('Splitter keyboard resize', () => {
  it('ArrowRight grows / ArrowLeft shrinks a sign=+1 splitter (clamped)', () => {
    render(<SplitterHarness initial={300} sign={1} />);
    const bar = screen.getByRole('separator');
    fireEvent.keyDown(bar, { key: 'ArrowRight' });
    expect(Number(screen.getByTestId('v').textContent)).toBe(300 + KEYBOARD_STEP);
    fireEvent.keyDown(bar, { key: 'ArrowLeft' });
    expect(Number(screen.getByTestId('v').textContent)).toBe(300);
  });

  it('inverts for a sign=-1 splitter (ArrowRight shrinks the panel)', () => {
    render(<SplitterHarness initial={400} sign={-1} />);
    const bar = screen.getByRole('separator');
    fireEvent.keyDown(bar, { key: 'ArrowRight' });
    expect(Number(screen.getByTestId('v').textContent)).toBe(400 - KEYBOARD_STEP);
  });

  it('clamps at the maximum and exposes separator semantics', () => {
    render(<SplitterHarness initial={SIDEBAR_MAX} sign={1} />);
    const bar = screen.getByRole('separator');
    expect(bar.getAttribute('aria-orientation')).toBe('vertical');
    expect(bar.getAttribute('aria-valuemax')).toBe(String(SIDEBAR_MAX));
    fireEvent.keyDown(bar, { key: 'ArrowRight' });
    expect(Number(screen.getByTestId('v').textContent)).toBe(SIDEBAR_MAX);
  });

  it('is inert when disabled (no keyboard change, not focusable)', () => {
    render(<SplitterHarness initial={300} sign={1} disabled />);
    const bar = screen.getByRole('separator');
    expect(bar.getAttribute('tabindex')).toBe('-1');
    fireEvent.keyDown(bar, { key: 'ArrowRight' });
    expect(Number(screen.getByTestId('v').textContent)).toBe(300);
  });
});

describe('Splitter pointer drag', () => {
  it('drags the panel to track the cursor (absolute from press)', () => {
    render(<SplitterHarness initial={300} sign={1} />);
    const bar = screen.getByRole('separator');
    fireEvent.pointerDown(bar, { clientX: 100, pointerId: 1 });
    // Move on window (the drag listener is global so a gesture survives leaving the bar).
    fireEvent.pointerMove(window, { clientX: 160, pointerId: 1 });
    expect(Number(screen.getByTestId('v').textContent)).toBe(360);
    fireEvent.pointerUp(window, { clientX: 160, pointerId: 1 });
    // After release, further moves do nothing.
    fireEvent.pointerMove(window, { clientX: 260, pointerId: 1 });
    expect(Number(screen.getByTestId('v').textContent)).toBe(360);
  });
});

describe('collapse affordances', () => {
  it('CollapsedStrip fires onExpand', () => {
    let expanded = false;
    render(<CollapsedStrip side="left" label="controls" onExpand={() => (expanded = true)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Expand controls' }));
    expect(expanded).toBe(true);
  });

  it('CollapseButton fires onCollapse', () => {
    let collapsed = false;
    render(<CollapseButton side="right" label="ladder column" onCollapse={() => (collapsed = true)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse ladder column' }));
    expect(collapsed).toBe(true);
  });
});
