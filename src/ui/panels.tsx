// src/ui/panels — resizable-panel layout primitives for the app shell (owner
// requirement 2026-07-11: "set the sizes of each panel/window … expanding or
// hiding the ladder diagram or left-hand banner").
//
// This module owns three things:
//   • {@link useLayout} — the persisted sizes + collapsed flags. These are a pure
//     VIEW preference (like the theme), so they live in localStorage ONLY — not in
//     the zustand store and NOT in the URL codec (a shared link never carries the
//     viewer's panel sizes). Defaults reproduce the pre-splitter layout exactly.
//   • {@link Splitter} — a draggable divider (role="separator") with pointer drag
//     AND keyboard (arrow-key) resize. The "handle-position" model: moving the
//     handle right/down shrinks the panel on that side, grows the stage.
//   • {@link CollapsedStrip} — the thin strip a collapsed panel shrinks to, with a
//     chevron button to reopen it.
//
// Sizes are clamped so no panel can crush the 3D scene (STAGE_MIN / dynamic window
// clamp), and so a persisted-then-resized window never traps a panel off-screen.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from 'react';
import { usePalette } from './theme';

// --- Layout constants (px) ---------------------------------------------------

export const SIDEBAR_MIN = 200;
export const SIDEBAR_MAX = 560;
export const SIDEBAR_DEFAULT = 300;

export const LADDER_MIN = 260;
export const LADDER_MAX = 680;
export const LADDER_DEFAULT = 440;

export const DOCK_MIN = 120;
export const DOCK_MAX = 640;

/** Minimum width reserved for the 3D stage so no panel can crush it. */
export const STAGE_MIN = 380;
/** Width of a splitter gutter track. */
export const GUTTER = 6;
/** Width a collapsed side panel shrinks to (holds only the reopen chevron). */
export const COLLAPSED_STRIP = 30;
/** Arrow-key resize increment when a splitter is focused. */
export const KEYBOARD_STEP = 16;

export const LAYOUT_STORAGE_KEY = 'airtime.layout.v1';

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

// --- Persisted layout state --------------------------------------------------

export interface LayoutState {
  /** Left controls sidebar width (px). */
  readonly sidebarWidth: number;
  /** Right ladder column width (px). */
  readonly ladderWidth: number;
  /** Bottom dock height (px), or null = natural/auto height (the default). */
  readonly dockHeight: number | null;
  readonly leftCollapsed: boolean;
  readonly ladderCollapsed: boolean;
}

export const DEFAULT_LAYOUT: LayoutState = {
  sidebarWidth: SIDEBAR_DEFAULT,
  ladderWidth: LADDER_DEFAULT,
  dockHeight: null,
  leftCollapsed: false,
  ladderCollapsed: false,
};

/** Read + validate the persisted layout; any garbage falls back to defaults. */
export function readLayout(): LayoutState {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(LAYOUT_STORAGE_KEY) : null;
    if (!raw) {
      return DEFAULT_LAYOUT;
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const num = (value: unknown, fallback: number, lo: number, hi: number): number =>
      typeof value === 'number' && Number.isFinite(value) ? clamp(value, lo, hi) : fallback;
    const dockRaw = parsed.dockHeight;
    return {
      sidebarWidth: num(parsed.sidebarWidth, SIDEBAR_DEFAULT, SIDEBAR_MIN, SIDEBAR_MAX),
      ladderWidth: num(parsed.ladderWidth, LADDER_DEFAULT, LADDER_MIN, LADDER_MAX),
      dockHeight:
        typeof dockRaw === 'number' && Number.isFinite(dockRaw)
          ? clamp(dockRaw, DOCK_MIN, DOCK_MAX)
          : null,
      leftCollapsed: parsed.leftCollapsed === true,
      ladderCollapsed: parsed.ladderCollapsed === true,
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

function writeLayout(state: LayoutState): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(state));
    }
  } catch {
    // Storage full / disabled — sizes simply won't persist this session.
  }
}

function viewportWidth(): number {
  return typeof window !== 'undefined' && window.innerWidth > 0 ? window.innerWidth : 2000;
}

function viewportHeight(): number {
  return typeof window !== 'undefined' && window.innerHeight > 0 ? window.innerHeight : 1300;
}

export interface LayoutController extends LayoutState {
  setSidebarWidth(width: number): void;
  setLadderWidth(width: number): void;
  setDockHeight(height: number): void;
  toggleLeftCollapsed(): void;
  toggleLadderCollapsed(): void;
}

/**
 * The persisted panel-sizing controller. Sizes clamp to their static bounds AND to
 * the live viewport so the 3D stage always keeps at least {@link STAGE_MIN} px; the
 * two panels are clamped against each other's current track so they can never sum
 * past the window.
 */
export function useLayout(): LayoutController {
  const [state, setState] = useState<LayoutState>(() => readLayout());

  useEffect(() => {
    writeLayout(state);
  }, [state]);

  const setSidebarWidth = useCallback((width: number): void => {
    setState((previous) => {
      const rightTrack = previous.ladderCollapsed ? COLLAPSED_STRIP : previous.ladderWidth;
      const roomMax = viewportWidth() - rightTrack - STAGE_MIN - 2 * GUTTER;
      const max = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, roomMax));
      return { ...previous, sidebarWidth: clamp(width, SIDEBAR_MIN, max) };
    });
  }, []);

  const setLadderWidth = useCallback((width: number): void => {
    setState((previous) => {
      const leftTrack = previous.leftCollapsed ? COLLAPSED_STRIP : previous.sidebarWidth;
      const roomMax = viewportWidth() - leftTrack - STAGE_MIN - 2 * GUTTER;
      const max = Math.max(LADDER_MIN, Math.min(LADDER_MAX, roomMax));
      return { ...previous, ladderWidth: clamp(width, LADDER_MIN, max) };
    });
  }, []);

  const setDockHeight = useCallback((height: number): void => {
    setState((previous) => {
      const roomMax = viewportHeight() - STAGE_MIN;
      const max = Math.max(DOCK_MIN, Math.min(DOCK_MAX, roomMax));
      return { ...previous, dockHeight: clamp(height, DOCK_MIN, max) };
    });
  }, []);

  const toggleLeftCollapsed = useCallback((): void => {
    setState((previous) => ({ ...previous, leftCollapsed: !previous.leftCollapsed }));
  }, []);

  const toggleLadderCollapsed = useCallback((): void => {
    setState((previous) => ({ ...previous, ladderCollapsed: !previous.ladderCollapsed }));
  }, []);

  return {
    ...state,
    setSidebarWidth,
    setLadderWidth,
    setDockHeight,
    toggleLeftCollapsed,
    toggleLadderCollapsed,
  };
}

// --- Splitter ----------------------------------------------------------------

export interface SplitterProps {
  /** 'vertical' = a vertical bar dividing left/right (resizes width, drags on X). */
  readonly orientation: 'vertical' | 'horizontal';
  /** The current size of the panel this splitter resizes (px) — also aria-valuenow. */
  readonly value: number;
  readonly min: number;
  readonly max: number;
  /** valueDelta = pointerDelta · sign. +1 grows the panel as the handle moves right/down. */
  readonly sign: 1 | -1;
  readonly ariaLabel: string;
  readonly disabled?: boolean;
  onChange(value: number): void;
}

/**
 * A draggable divider. Pointer drag is absolute (snapshots the value at press, so
 * the panel tracks the cursor 1:1 and recovers exactly when dragged past a bound);
 * arrow keys nudge by {@link KEYBOARD_STEP}. Semantics via `sign`: moving the handle
 * right/down changes the value by `pointerDelta · sign`.
 */
export function Splitter({
  orientation,
  value,
  min,
  max,
  sign,
  ariaLabel,
  disabled = false,
  onChange,
}: SplitterProps): ReactElement {
  const palette = usePalette();
  const vertical = orientation === 'vertical';
  const [dragging, setDragging] = useState(false);
  const [hover, setHover] = useState(false);

  // Latest props for the window-level drag listeners (attached once; read fresh).
  const latest = useRef({ min, max, sign, onChange });
  latest.current = { min, max, sign, onChange };
  const drag = useRef<{ start: number; startValue: number } | null>(null);

  useEffect(() => {
    const move = (event: PointerEvent): void => {
      const current = drag.current;
      if (!current) {
        return;
      }
      const client = vertical ? event.clientX : event.clientY;
      const props = latest.current;
      props.onChange(clamp(current.startValue + (client - current.start) * props.sign, props.min, props.max));
    };
    const end = (): void => {
      if (drag.current) {
        drag.current = null;
        setDragging(false);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, [vertical]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (disabled) {
      return;
    }
    event.preventDefault();
    drag.current = { start: vertical ? event.clientX : event.clientY, startValue: value };
    setDragging(true);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (disabled) {
      return;
    }
    let step = 0;
    if (vertical) {
      if (event.key === 'ArrowRight') step = KEYBOARD_STEP;
      else if (event.key === 'ArrowLeft') step = -KEYBOARD_STEP;
    } else {
      if (event.key === 'ArrowDown') step = KEYBOARD_STEP;
      else if (event.key === 'ArrowUp') step = -KEYBOARD_STEP;
    }
    if (step === 0) {
      return;
    }
    event.preventDefault();
    onChange(clamp(value + step * sign, min, max));
  };

  const highlighted = dragging || hover;
  return (
    <div
      role="separator"
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      aria-label={ariaLabel}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      style={{
        width: vertical ? `${GUTTER}px` : '100%',
        height: vertical ? '100%' : `${GUTTER}px`,
        alignSelf: 'stretch',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: disabled ? 'default' : vertical ? 'col-resize' : 'row-resize',
        touchAction: 'none',
        outline: 'none',
      }}
    >
      {/* The visible grab line; brightens on hover / drag / keyboard focus. */}
      <div
        style={{
          width: vertical ? '2px' : '2.5rem',
          height: vertical ? '2.5rem' : '2px',
          borderRadius: '2px',
          background: disabled ? 'transparent' : highlighted ? palette.accent : palette.borderStrong,
          opacity: disabled ? 0 : 1,
          transition: 'background 120ms ease',
        }}
      />
    </div>
  );
}

// --- Collapsed strip + chevron -----------------------------------------------

/**
 * A thin vertical strip a collapsed side panel shrinks to; the chevron reopens it.
 * `side` is which side of the app the panel lives on (the chevron points inward,
 * toward where the panel will reappear).
 */
export function CollapsedStrip({
  side,
  label,
  onExpand,
}: {
  readonly side: 'left' | 'right';
  readonly label: string;
  onExpand(): void;
}): ReactElement {
  const palette = usePalette();
  return (
    <div
      style={{
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '0.6rem',
        padding: '0.5rem 0',
        borderRadius: '0.55rem',
        border: `1px solid ${palette.border}`,
        background: palette.panel,
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        aria-label={`Expand ${label}`}
        title={`Expand ${label}`}
        onClick={onExpand}
        style={{
          width: '1.5rem',
          height: '1.5rem',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: `1px solid ${palette.border}`,
          borderRadius: '0.35rem',
          background: palette.panelAlt,
          color: palette.textPrimary,
          cursor: 'pointer',
          fontSize: '0.9rem',
          lineHeight: 1,
        }}
      >
        {/* Point inward: a left strip opens to the right (›), a right strip opens left (‹). */}
        {side === 'left' ? '›' : '‹'}
      </button>
      <span
        aria-hidden="true"
        style={{
          writingMode: 'vertical-rl',
          transform: side === 'left' ? 'rotate(180deg)' : undefined,
          fontSize: '0.68rem',
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: palette.textMuted,
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
    </div>
  );
}

/**
 * The collapse chevron a panel header shows to shrink itself to a {@link CollapsedStrip}.
 * `side` is the panel's side (the chevron points outward, toward where it collapses).
 */
export function CollapseButton({
  side,
  label,
  onCollapse,
}: {
  readonly side: 'left' | 'right';
  readonly label: string;
  onCollapse(): void;
}): ReactElement {
  const palette = usePalette();
  return (
    <button
      type="button"
      aria-label={`Collapse ${label}`}
      title={`Collapse ${label}`}
      onClick={onCollapse}
      style={{
        width: '1.4rem',
        height: '1.4rem',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: `1px solid ${palette.border}`,
        borderRadius: '0.35rem',
        background: palette.panelAlt,
        color: palette.textSecondary,
        cursor: 'pointer',
        fontSize: '0.85rem',
        lineHeight: 1,
        padding: 0,
      }}
    >
      {/* Point outward: a left panel collapses left (‹), a right panel collapses right (›). */}
      {side === 'left' ? '‹' : '›'}
    </button>
  );
}
