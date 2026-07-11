// src/ui/widgets — the shared, dark-themed control kit for the redesigned shell
// (redesign 2026-07-10). These were previously defined inline in Controls; they
// are extracted here so the left sidebar (Controls, incl. its View group), the
// charts dock, and the state-graph overlay all render identical, palette-driven
// controls. Every widget reads {@link usePalette} — no color is hard-coded here.
//
// Full-word labels are preserved (NOTATION.md); the amber dwell-clamp readout is
// still expressed via the caller passing `readoutColor`.

import { useEffect, useRef, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { usePalette, type Palette } from './theme';

const SLIDER_STEPS = 1000;
/**
 * Internal steps a single wheel event nudges the slider (owner 2026-07-11: the old
 * ±1 was "prohibitively slow"; ~3× more sensitive). Still clamped to min/max.
 */
const WHEEL_STEP = 3;

/**
 * A subtle ↺ affordance that resets one control to its default. Rendered only when
 * the current value differs from the default (the caller decides), so its mere
 * presence signals "this control is off its default". Used inline in the Slider /
 * Segmented / CheckToggle label rows (redesign 2026-07-11, owner reset request).
 */
function ResetButton({
  label,
  onReset,
}: {
  readonly label: string;
  onReset(): void;
}): ReactElement {
  const palette = usePalette();
  return (
    <button
      type="button"
      aria-label={`Reset ${label}`}
      title={`Reset ${label} to default`}
      onClick={onReset}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '1.05rem',
        height: '1.05rem',
        padding: 0,
        border: 'none',
        borderRadius: '0.25rem',
        background: 'transparent',
        color: palette.textMuted,
        cursor: 'pointer',
        fontSize: '0.85rem',
        lineHeight: 1,
      }}
    >
      ↺
    </button>
  );
}

function positionOf(value: number, min: number, max: number, scale: 'linear' | 'log'): number {
  const v = Math.min(Math.max(value, min), max);
  if (scale === 'log') {
    return (Math.log(v) - Math.log(min)) / (Math.log(max) - Math.log(min));
  }
  return (v - min) / (max - min);
}

function valueOf(position: number, min: number, max: number, scale: 'linear' | 'log'): number {
  if (scale === 'log') {
    return Math.exp(Math.log(min) + position * (Math.log(max) - Math.log(min)));
  }
  return min + position * (max - min);
}

export interface SliderProps {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly scale?: 'linear' | 'log';
  readonly readout: string;
  /** Override the readout color (used for the amber dwell-clamp indication). */
  readonly readoutColor?: string;
  /**
   * The control's default; when provided and `value` differs from it, a subtle ↺
   * reset affordance appears in the label row (clicking it restores the default).
   */
  readonly defaultValue?: number;
  onChange(value: number): void;
}

/**
 * A compact labeled slider with a value readout on the right. Two extras beyond a
 * plain range input (redesign 2026-07-11, owner requests):
 *   • Wheel-scroll while hovering nudges the slider a few internal steps — wheel up /
 *     away increases (moves right), wheel down / toward decreases. The listener is
 *     attached non-passively so it can preventDefault (the page never scrolls).
 *   • A per-control ↺ reset appears when `value` ≠ `defaultValue`.
 */
export function Slider({
  label,
  value,
  min,
  max,
  scale = 'linear',
  readout,
  readoutColor,
  defaultValue,
  onChange,
}: SliderProps): ReactElement {
  const palette = usePalette();
  const position = Math.round(positionOf(value, min, max, scale) * SLIDER_STEPS);
  const showReset = defaultValue !== undefined && value !== defaultValue;

  // Latest props for the imperative wheel listener (attached once; reads current
  // values at event time so we never re-subscribe on every value change).
  const inputRef = useRef<HTMLInputElement>(null);
  const latest = useRef({ value, min, max, scale, onChange });
  latest.current = { value, min, max, scale, onChange };
  useEffect(() => {
    const element = inputRef.current;
    if (!element) {
      return;
    }
    const handler = (event: WheelEvent): void => {
      if (event.deltaY === 0) {
        return;
      }
      event.preventDefault(); // keep the page from scrolling while adjusting
      const current = latest.current;
      const pos = Math.round(positionOf(current.value, current.min, current.max, current.scale) * SLIDER_STEPS);
      // Scroll up / away (deltaY < 0) → increase (right); down / toward → decrease.
      const nextPos = Math.min(SLIDER_STEPS, Math.max(0, pos + (event.deltaY < 0 ? WHEEL_STEP : -WHEEL_STEP)));
      if (nextPos !== pos) {
        current.onChange(valueOf(nextPos / SLIDER_STEPS, current.min, current.max, current.scale));
      }
    };
    element.addEventListener('wheel', handler, { passive: false });
    return () => element.removeEventListener('wheel', handler);
  }, []);

  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', fontSize: '0.78rem' }}>
      <span
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: '0.5rem',
          fontWeight: 600,
          color: palette.textSecondary,
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
          <span>{label}</span>
          {showReset ? <ResetButton label={label} onReset={() => onChange(defaultValue)} /> : null}
        </span>
        <span style={{ color: readoutColor ?? palette.textPrimary, fontVariantNumeric: 'tabular-nums' }}>
          {readout}
        </span>
      </span>
      <input
        ref={inputRef}
        type="range"
        min={0}
        max={SLIDER_STEPS}
        step={1}
        value={position}
        aria-label={label}
        onChange={(event) =>
          onChange(valueOf(event.target.valueAsNumber / SLIDER_STEPS, min, max, scale))
        }
        style={{ width: '100%', height: '1.1rem', cursor: 'pointer' }}
      />
    </label>
  );
}

/** A ±stepper for an integer setting (hand count, graph N). */
export function Stepper({
  label,
  value,
  min,
  max,
  onChange,
}: {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  onChange(value: number): void;
}): ReactElement {
  const palette = usePalette();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.8rem' }}>
      <span style={{ fontWeight: 600, color: palette.textSecondary }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
        <button
          type="button"
          aria-label={`${label} decrease`}
          disabled={value <= min}
          onClick={() => onChange(value - 1)}
          style={stepperButtonStyle(palette, value <= min)}
        >
          −
        </button>
        <span
          aria-label={label}
          style={{
            minWidth: '1.6rem',
            textAlign: 'center',
            fontVariantNumeric: 'tabular-nums',
            fontWeight: 700,
            color: palette.textPrimary,
          }}
        >
          {value}
        </span>
        <button
          type="button"
          aria-label={`${label} increase`}
          disabled={value >= max}
          onClick={() => onChange(value + 1)}
          style={stepperButtonStyle(palette, value >= max)}
        >
          +
        </button>
      </div>
    </div>
  );
}

/** A segmented (2+ option) toggle: preset picker, carry-path picker, axis mode. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  defaultValue,
  onChange,
}: {
  readonly label: string;
  readonly value: T;
  readonly options: readonly { readonly value: T; readonly label: string }[];
  /** Default selection; a ↺ reset appears in the label row when `value` differs. */
  readonly defaultValue?: T;
  onChange(value: T): void;
}): ReactElement {
  const palette = usePalette();
  const showReset = defaultValue !== undefined && value !== defaultValue;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.8rem' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontWeight: 600, color: palette.textSecondary }}>
        <span>{label}</span>
        {showReset ? <ResetButton label={label} onReset={() => onChange(defaultValue)} /> : null}
      </span>
      <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              aria-label={`${label}: ${option.label}`}
              aria-pressed={active}
              onClick={() => onChange(option.value)}
              style={segmentButtonStyle(palette, active)}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A checkbox + label (getByLabelText matches on the label text). */
export function CheckToggle({
  label,
  checked,
  onChange,
  disabled,
  defaultChecked,
}: {
  readonly label: string;
  readonly checked: boolean;
  readonly disabled?: boolean;
  /** Default state; a ↺ reset (which toggles back to default) shows when differing. */
  readonly defaultChecked?: boolean;
  onChange(): void;
}): ReactElement {
  const palette = usePalette();
  // The reset sits OUTSIDE the <label> so clicking it does not also toggle the box.
  const showReset = defaultChecked !== undefined && !disabled && checked !== defaultChecked;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.4rem',
          fontWeight: 600,
          fontSize: '0.8rem',
          color: disabled ? palette.textMuted : palette.textPrimary,
          cursor: disabled ? 'default' : 'pointer',
        }}
      >
        <input type="checkbox" checked={checked} disabled={disabled} onChange={onChange} />
        <span>{label}</span>
      </label>
      {showReset ? <ResetButton label={label} onReset={onChange} /> : null}
    </span>
  );
}

export type ButtonVariant = 'primary' | 'default' | 'ghost';

/** A themed button (primary = accent fill; default = panel; ghost = borderless). */
export function Button({
  children,
  onClick,
  variant = 'default',
  ariaLabel,
  ariaPressed,
  title,
  disabled,
  style,
}: {
  readonly children: ReactNode;
  onClick(): void;
  readonly variant?: ButtonVariant;
  readonly ariaLabel?: string;
  readonly ariaPressed?: boolean;
  readonly title?: string;
  readonly disabled?: boolean;
  readonly style?: CSSProperties;
}): ReactElement {
  const palette = usePalette();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      title={title}
      disabled={disabled}
      style={{ ...buttonStyle(palette, variant), ...(disabled ? { opacity: 0.4, cursor: 'default' } : null), ...style }}
    >
      {children}
    </button>
  );
}

/** An uppercase section heading used inside sidebar/settings groups. */
export function SectionLabel({ children }: { readonly children: ReactNode }): ReactElement {
  const palette = usePalette();
  return (
    <h3
      style={{
        margin: 0,
        fontSize: '0.68rem',
        fontWeight: 700,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: palette.textMuted,
      }}
    >
      {children}
    </h3>
  );
}

// --- Style helpers -----------------------------------------------------------

export function buttonStyle(palette: Palette, variant: ButtonVariant): CSSProperties {
  const base: CSSProperties = {
    padding: '0.4rem 0.8rem',
    borderRadius: '0.4rem',
    fontWeight: 600,
    fontSize: '0.82rem',
    cursor: 'pointer',
    lineHeight: 1.1,
    transition: 'background 150ms ease, border-color 150ms ease',
  };
  if (variant === 'primary') {
    return { ...base, border: `1px solid ${palette.accent}`, background: palette.accent, color: palette.accentText };
  }
  if (variant === 'ghost') {
    return { ...base, border: '1px solid transparent', background: 'transparent', color: palette.textSecondary };
  }
  return { ...base, border: `1px solid ${palette.border}`, background: palette.panelAlt, color: palette.textPrimary };
}

function stepperButtonStyle(palette: Palette, disabled: boolean): CSSProperties {
  return {
    width: '1.8rem',
    height: '1.8rem',
    borderRadius: '0.4rem',
    border: `1px solid ${palette.border}`,
    background: palette.panelAlt,
    color: palette.textPrimary,
    fontWeight: 700,
    fontSize: '1rem',
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.4 : 1,
    lineHeight: 1,
  };
}

function segmentButtonStyle(palette: Palette, active: boolean): CSSProperties {
  return {
    padding: '0.32rem 0.6rem',
    borderRadius: '0.4rem',
    border: `1px solid ${active ? palette.accent : palette.border}`,
    background: active ? palette.accent : palette.panelAlt,
    color: active ? palette.accentText : palette.textSecondary,
    fontWeight: 600,
    fontSize: '0.78rem',
    cursor: 'pointer',
  };
}

/** Inset input styling (numeric hand-position cells, preset name, share URL). */
export function insetInputStyle(palette: Palette): CSSProperties {
  return {
    padding: '0.3rem 0.4rem',
    borderRadius: '0.35rem',
    border: `1px solid ${palette.border}`,
    background: palette.inset,
    color: palette.textPrimary,
    fontVariantNumeric: 'tabular-nums',
    outline: 'none',
  };
}
