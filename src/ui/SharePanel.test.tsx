// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useAppStore } from '../state';
import { PRESETS_STORAGE_KEY } from '../state/presets';
import { SharePanel } from './SharePanel';

beforeEach(() => {
  localStorage.clear();
  useAppStore.getState().hardReset();
  useAppStore.getState().setPattern('531');
  useAppStore.getState().refreshPresetNames();
});
afterEach(cleanup);

describe('SharePanel (ui layer)', () => {
  it('copy share link fills a readable field with the versioned URL', () => {
    render(<SharePanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy share link' }));
    const field = screen.getByLabelText('Share link') as HTMLInputElement;
    expect(field.value).toContain('?v=1');
    expect(field.value).toContain('p=531');
  });

  it('saves a named preset to localStorage and lists it', () => {
    render(<SharePanel />);
    fireEvent.change(screen.getByLabelText('Preset name'), { target: { value: 'my box' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save preset' }));

    expect(useAppStore.getState().presetNames).toContain('my box');
    expect(localStorage.getItem(PRESETS_STORAGE_KEY)).toContain('531');
    expect(screen.getByText('my box')).toBeTruthy();
  });

  it('loads a preset back into the running scene', () => {
    render(<SharePanel />);
    fireEvent.change(screen.getByLabelText('Preset name'), { target: { value: 'box' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save preset' }));

    // Change the pattern, then load the saved preset.
    useAppStore.getState().setPattern('3');
    expect(useAppStore.getState().sim.patternText).toBe('3');
    fireEvent.click(screen.getByRole('button', { name: 'Load' }));
    expect(useAppStore.getState().sim.patternText).toBe('531');
  });

  it('deletes a preset', () => {
    render(<SharePanel />);
    fireEvent.change(screen.getByLabelText('Preset name'), { target: { value: 'temp' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save preset' }));
    expect(useAppStore.getState().presetNames).toContain('temp');

    fireEvent.click(screen.getByRole('button', { name: 'Delete preset temp' }));
    expect(useAppStore.getState().presetNames).not.toContain('temp');
  });

  it('toggles audio and reflects it in the store', () => {
    render(<SharePanel />);
    fireEvent.click(screen.getByLabelText('Enable ticks'));
    expect(useAppStore.getState().audioEnabled).toBe(true);
  });
});
