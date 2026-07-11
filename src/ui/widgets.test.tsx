// @vitest-environment jsdom
// Shared widget-kit behaviors added in the 2026-07-11 controls pass: wheel-scroll
// on the Slider and the per-control ↺ reset affordance on Slider / Segmented /
// CheckToggle. Each widget is exercised through a tiny controlled harness so the
// assertions read the value the widget actually drives.
import { afterEach, describe, expect, it } from 'vitest';
import { useState, type ReactElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CheckToggle, Segmented, Slider } from './widgets';

afterEach(cleanup);

function SliderHarness({ initial }: { readonly initial: number }): ReactElement {
  const [value, setValue] = useState(initial);
  return (
    <>
      <Slider
        label="Test"
        value={value}
        min={0}
        max={1}
        readout={value.toFixed(3)}
        defaultValue={0.5}
        onChange={setValue}
      />
      <output data-testid="val">{value}</output>
    </>
  );
}

describe('Slider wheel-scroll', () => {
  it('scroll up (deltaY < 0) increases the value; scroll down decreases it', () => {
    render(<SliderHarness initial={0.5} />);
    const slider = screen.getByLabelText('Test');

    fireEvent.wheel(slider, { deltaY: -100 }); // up / away → right
    expect(Number(screen.getByTestId('val').textContent)).toBeGreaterThan(0.5);

    fireEvent.wheel(slider, { deltaY: 100 }); // down / toward → left (back to 0.5)
    expect(Number(screen.getByTestId('val').textContent)).toBeCloseTo(0.5, 9);
  });

  it('moves ~3 internal steps per wheel event (owner: 3× more sensitive)', () => {
    // 1000 internal steps span [0, 1], so one wheel event = 3/1000 = 0.003.
    render(<SliderHarness initial={0.5} />);
    const slider = screen.getByLabelText('Test');
    fireEvent.wheel(slider, { deltaY: -100 });
    expect(Number(screen.getByTestId('val').textContent)).toBeCloseTo(0.503, 9);
  });

  it('clamps at the maximum (scroll up at max is a no-op)', () => {
    render(<SliderHarness initial={1} />);
    fireEvent.wheel(screen.getByLabelText('Test'), { deltaY: -100 });
    expect(Number(screen.getByTestId('val').textContent)).toBe(1);
  });

  it('clamps at the minimum (scroll down at min is a no-op)', () => {
    render(<SliderHarness initial={0} />);
    fireEvent.wheel(screen.getByLabelText('Test'), { deltaY: 100 });
    expect(Number(screen.getByTestId('val').textContent)).toBe(0);
  });
});

describe('per-control reset affordance', () => {
  it('Slider: ↺ appears off-default, restores the default, then hides', () => {
    render(<SliderHarness initial={0.8} />);
    const reset = screen.getByLabelText('Reset Test');
    fireEvent.click(reset);
    expect(Number(screen.getByTestId('val').textContent)).toBeCloseTo(0.5, 9);
    expect(screen.queryByLabelText('Reset Test')).toBeNull();
  });

  it('Slider: no ↺ when already at the default', () => {
    render(<SliderHarness initial={0.5} />);
    expect(screen.queryByLabelText('Reset Test')).toBeNull();
  });

  it('Segmented: ↺ restores the default option, then hides', () => {
    function Harness(): ReactElement {
      const [value, setValue] = useState<'a' | 'b'>('b');
      return (
        <Segmented<'a' | 'b'>
          label="Mode"
          value={value}
          defaultValue="a"
          options={[
            { value: 'a', label: 'A' },
            { value: 'b', label: 'B' },
          ]}
          onChange={setValue}
        />
      );
    }
    render(<Harness />);
    expect(screen.getByLabelText('Mode: B').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByLabelText('Reset Mode'));
    expect(screen.getByLabelText('Mode: A').getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByLabelText('Reset Mode')).toBeNull();
  });

  it('CheckToggle: ↺ restores the default state, then hides', () => {
    function Harness(): ReactElement {
      const [checked, setChecked] = useState(true);
      return (
        <CheckToggle
          label="Flag"
          checked={checked}
          defaultChecked={false}
          onChange={() => setChecked((previous) => !previous)}
        />
      );
    }
    render(<Harness />);
    const box = screen.getByLabelText('Flag') as HTMLInputElement;
    expect(box.checked).toBe(true);
    fireEvent.click(screen.getByLabelText('Reset Flag'));
    expect(box.checked).toBe(false);
    expect(screen.queryByLabelText('Reset Flag')).toBeNull();
  });
});
