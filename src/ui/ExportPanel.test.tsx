// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useAppStore } from '../state';
import { ExportPanel } from './ExportPanel';

beforeEach(() => {
  useAppStore.getState().hardReset();
  useAppStore.getState().setPattern('3');
});
afterEach(cleanup);

// The dialog is code-split behind React.lazy (its src/export deps stay out of the
// main bundle), so opening it resolves asynchronously — the assertions await it via
// findBy* rather than the synchronous getBy* the pre-split component allowed.
describe('ExportPanel (ui layer)', () => {
  it('opens the dialog from the Export button and shows the form', async () => {
    render(<ExportPanel />);
    expect(screen.queryByRole('dialog', { name: 'Export animation' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Export GIF…' }));

    expect(await screen.findByRole('dialog', { name: 'Export animation' })).toBeTruthy();
    // Format (GIF only — no WebCodecs in jsdom), fps, resolution, turntable.
    expect(screen.getByRole('button', { name: 'Format: GIF' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Format: WebM' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Frames per second: 24' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Resolution: Half (0.5×)' })).toBeTruthy();
    expect(screen.getByLabelText('Turntable (one orbit)')).toBeTruthy();
  });

  it('shows a live frame estimate for the running pattern', async () => {
    render(<ExportPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Export GIF…' }));
    await screen.findByRole('dialog', { name: 'Export animation' });
    // 3-ball cascade, 2 hands: spatialPeriod = 2 beats × 0.25 s = 0.5 s; 24 fps ⇒ 12.
    expect(screen.getByText(/≈ 12 frames/)).toBeTruthy();
  });

  it('updating fps and loops updates the estimate', async () => {
    render(<ExportPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Export GIF…' }));
    await screen.findByRole('dialog', { name: 'Export animation' });
    fireEvent.click(screen.getByRole('button', { name: 'Frames per second: 30' }));
    // 0.5 s × 30 = 15 frames.
    expect(screen.getByText(/≈ 15 frames/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Loops increase' }));
    // 2 loops × 0.5 s × 30 = 30 frames.
    expect(screen.getByText(/≈ 30 frames/)).toBeTruthy();
  });

  it('reports a friendly error and restores state when the scene is not ready', async () => {
    render(<ExportPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Export GIF…' }));
    const exportButton = await screen.findByRole('button', { name: 'Export GIF' });
    const before = useAppStore.getState().playing;
    fireEvent.click(exportButton);
    await waitFor(() =>
      expect(screen.getByText(/scene is not ready/i)).toBeTruthy(),
    );
    expect(useAppStore.getState().playing).toBe(before);
  });

  it('Escape closes the dialog', async () => {
    render(<ExportPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Export GIF…' }));
    expect(await screen.findByRole('dialog', { name: 'Export animation' })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Export animation' })).toBeNull(),
    );
  });
});
