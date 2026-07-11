// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useAppStore } from '../state';
import { DEFAULT_WORKSPACE, parseStl, type Triangle } from '../workspace';
import { WorkspaceButton, WorkspacePanel } from './WorkspacePanel';

beforeEach(() => {
  useAppStore.setState({ workspace: DEFAULT_WORKSPACE, workspaceMesh: null, workspaceNote: null });
});
afterEach(cleanup);

describe('WorkspacePanel', () => {
  it('the launch button opens the popup and shows the shape controls', () => {
    render(<WorkspaceButton />);
    // Popup closed initially.
    expect(screen.queryByRole('dialog', { name: 'Hand workspace' })).toBeNull();
    fireEvent.click(screen.getByLabelText('Open the hand workspace editor'));
    expect(screen.getByRole('dialog', { name: 'Hand workspace' })).toBeTruthy();
    expect(screen.getByLabelText('Shape: Sphere')).toBeTruthy();
    expect(screen.getByLabelText('Shape: Cube')).toBeTruthy();
    expect(screen.getByLabelText('Shape: Pyramid')).toBeTruthy();
  });

  it('selecting a shape updates the shared spec', () => {
    render(<WorkspacePanel onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText('Shape: Cube'));
    expect(useAppStore.getState().workspace.kind).toBe('cube');
    fireEvent.click(screen.getByLabelText('Shape: Pyramid'));
    expect(useAppStore.getState().workspace.kind).toBe('tetra');
  });

  it('the enabled toggle flips the workspace on', () => {
    render(<WorkspacePanel onClose={() => {}} />);
    expect(useAppStore.getState().workspace.enabled).toBe(false);
    fireEvent.click(screen.getByLabelText('Show workspace in the scene'));
    expect(useAppStore.getState().workspace.enabled).toBe(true);
  });

  it('a size slider edits one display-frame axis half-extent (clamped)', () => {
    render(<WorkspacePanel onClose={() => {}} />);
    const slider = screen.getByLabelText('Size X (along the hands)') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '900' } }); // 0..1000 internal steps
    const x = useAppStore.getState().workspace.scale.x;
    expect(x).not.toBe(DEFAULT_WORKSPACE.scale.x);
    expect(x).toBeGreaterThanOrEqual(0.1);
    expect(x).toBeLessThanOrEqual(2);
  });

  it('reset restores the default workspace and clears the mesh', () => {
    useAppStore.getState().setWorkspaceKind('cube');
    useAppStore.getState().setWorkspaceEnabled(true);
    render(<WorkspacePanel onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText('Reset workspace to default'));
    const ws = useAppStore.getState().workspace;
    expect(ws.kind).toBe(DEFAULT_WORKSPACE.kind);
    expect(ws.enabled).toBe(false);
    expect(useAppStore.getState().workspaceMesh).toBeNull();
  });

  it('Escape closes the popup (calls onClose)', () => {
    const onClose = vi.fn();
    render(<WorkspacePanel onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('an uploaded STL (via the store) becomes the active shape with a triangle count', () => {
    // Build a small watertight tetra STL through the pure parser, then adopt it.
    const tris: Triangle[] = [
      { a: [0, 0, 1], b: [1, 0, -0.3], c: [-0.5, 0.87, -0.3] },
      { a: [0, 0, 1], b: [-0.5, 0.87, -0.3], c: [-0.5, -0.87, -0.3] },
      { a: [0, 0, 1], b: [-0.5, -0.87, -0.3], c: [1, 0, -0.3] },
      { a: [1, 0, -0.3], b: [-0.5, 0.87, -0.3], c: [-0.5, -0.87, -0.3] },
    ];
    const buffer = new ArrayBuffer(84 + tris.length * 50);
    const view = new DataView(buffer);
    view.setUint32(80, tris.length, true);
    let offset = 84;
    for (const t of tris) {
      offset += 12;
      for (const v of [t.a, t.b, t.c]) {
        view.setFloat32(offset, v[0], true);
        view.setFloat32(offset + 4, v[1], true);
        view.setFloat32(offset + 8, v[2], true);
        offset += 12;
      }
      offset += 2;
    }
    useAppStore.getState().setWorkspaceMesh(parseStl(buffer));
    expect(useAppStore.getState().workspace.kind).toBe('stl');
    expect(useAppStore.getState().workspaceMesh?.triangleCount).toBe(4);

    // The STL shape button now appears in the panel.
    render(<WorkspacePanel onClose={() => {}} />);
    expect(screen.getByLabelText('Shape: STL')).toBeTruthy();
  });
});
