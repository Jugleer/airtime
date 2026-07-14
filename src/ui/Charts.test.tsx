// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useAppStore } from '../state';
import { Charts } from './Charts';

// jsdom has no canvas 2D backend; stub getContext to return null cleanly (the
// component guards null and skips drawing). We assert the DOM/values, not pixels.
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

beforeEach(() => {
  // App mounts <Charts /> only when dockMode === 'charts'; the component itself no
  // longer reads chartsVisible or has an internal collapse, so the test just renders
  // it directly and asserts its always-on content.
  useAppStore.setState({ simTime: 0, playing: false, chartAxisMode: 'magnitude' });
  useAppStore.getState().setHandCount(2);
  useAppStore.getState().setPattern('3');
});
afterEach(cleanup);

describe('Charts (ui layer)', () => {
  it('renders the collapsible section heading and the three canvas charts', () => {
    render(<Charts />);
    expect(screen.getByText('Charts & energy')).toBeTruthy();
    expect(screen.getByLabelText('Hand speed chart')).toBeTruthy();
    expect(screen.getByLabelText('Hand acceleration chart')).toBeTruthy();
    expect(screen.getByLabelText('Hand jerk chart')).toBeTruthy();
  });

  it('shows a legend entry per hand', () => {
    render(<Charts />);
    const legend = within(screen.getByRole('group', { name: 'Chart legend' }));
    expect(legend.getByText('Hand 0')).toBeTruthy();
    expect(legend.getByText('Hand 1')).toBeTruthy();
  });

  it('renders the energy table with full-word headers and a totals row', () => {
    render(<Charts />);
    expect(screen.getByText('Throw work')).toBeTruthy();
    expect(screen.getByText('Catch absorption')).toBeTruthy();
    expect(screen.getByText('Average power')).toBeTruthy();
    expect(screen.getByText('Total')).toBeTruthy();
  });

  it('drops the Net column (owner req. 1 — recoverable as W+ − |W−|)', () => {
    render(<Charts />);
    // "Net" was a former header cell; it must no longer appear in the table head.
    expect(screen.queryByRole('columnheader', { name: /Net/i })).toBeNull();
  });

  it('toggles a hand series on/off from the legend, updating aria-pressed', () => {
    render(<Charts />);
    const legend = within(screen.getByRole('group', { name: 'Chart legend' }));
    const hand0 = legend.getByRole('button', { name: /Hand 0 series/ });
    expect(hand0.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(hand0);
    expect(hand0.getAttribute('aria-pressed')).toBe('false'); // now hidden
    fireEvent.click(hand0);
    expect(hand0.getAttribute('aria-pressed')).toBe('true'); // shown again
  });

  it('highlights the hovered hand in the 3D scene, clearing on leave (owner req. 3)', () => {
    render(<Charts />);
    const legend = within(screen.getByRole('group', { name: 'Chart legend' }));
    const hand1 = legend.getByRole('button', { name: /Hand 1 series/ });
    expect(useAppStore.getState().hoveredHandIndex).toBeNull();
    // Pointer events (not mouse events) so touch un-highlight (pointercancel) is
    // covered too — see the round-9 mobile pass in Charts.tsx.
    fireEvent.pointerEnter(hand1);
    expect(useAppStore.getState().hoveredHandIndex).toBe(1);
    fireEvent.pointerLeave(hand1);
    expect(useAppStore.getState().hoveredHandIndex).toBeNull();
  });

  it('clears the scene highlight on pointer cancel (a lifted touch)', () => {
    render(<Charts />);
    const legend = within(screen.getByRole('group', { name: 'Chart legend' }));
    const hand1 = legend.getByRole('button', { name: /Hand 1 series/ });
    fireEvent.pointerEnter(hand1);
    expect(useAppStore.getState().hoveredHandIndex).toBe(1);
    fireEvent.pointerCancel(hand1);
    expect(useAppStore.getState().hoveredHandIndex).toBeNull();
  });

  it('clears the scene highlight when the legend unmounts mid-hover', () => {
    const { unmount } = render(<Charts />);
    const legend = within(screen.getByRole('group', { name: 'Chart legend' }));
    const hand1 = legend.getByRole('button', { name: /Hand 1 series/ });
    fireEvent.pointerEnter(hand1);
    expect(useAppStore.getState().hoveredHandIndex).toBe(1);
    // Unmounting (dock collapsed / component removed) fires no pointer leave, so the
    // Legend's effect cleanup is what must reset the store — else the cup stays lit.
    unmount();
    expect(useAppStore.getState().hoveredHandIndex).toBeNull();
  });

  it('has no internal Show/Hide toggle (the dock switch owns visibility)', () => {
    // The tri-state DockModeSwitch (App) collapses the dock to None; the removed
    // in-header toggle would have been a redundant second path (dead branch removed).
    render(<Charts />);
    expect(screen.queryByLabelText('Toggle charts and energy panel')).toBeNull();
  });

  it('switches the axis mode via the component selector', () => {
    render(<Charts />);
    expect(useAppStore.getState().chartAxisMode).toBe('magnitude');
    fireEvent.click(screen.getByLabelText('Chart component: X'));
    expect(useAppStore.getState().chartAxisMode).toBe('x');
    fireEvent.click(screen.getByLabelText('Chart component: Y'));
    expect(useAppStore.getState().chartAxisMode).toBe('y');
  });

  it('mounts without throwing even though canvas 2D is unavailable (guarded)', () => {
    // The draw effect calls getContext (stubbed to null); the guard must no-op.
    expect(() => render(<Charts />)).not.toThrow();
  });

  it('pins the layout: charts grow, energy table is compact + shrinkable (owner req. 1)', () => {
    // jsdom does not compute flexbox, so we assert the *declared* flex intent that
    // makes the split correct at every dock width. The charts body is the only
    // grower (grow 1) → it fills ALL space the compact energy table leaves; the
    // energy wrapper never grows (grow 0) → it cannot starve the canvases at wide
    // docks (the historic ≥2340px collapse), and stays shrinkable (minWidth 0) so a
    // narrow dock shrinks it and the table scrolls instead of squeezing the charts.
    render(<Charts />);
    const chartsBody = screen.getByLabelText('Hand speed chart').parentElement as HTMLElement;
    expect(chartsBody.style.flexGrow).toBe('1'); // only grower → fills the remainder
    expect(chartsBody.style.flexBasis).toBe('60%'); // narrow-dock floor (no collapse)
    const energyWrapper = chartsBody.nextElementSibling as HTMLElement;
    // The wrapper holds the energy table (sanity: it is the right sibling).
    expect(within(energyWrapper).getByText('Total')).toBeTruthy();
    expect(energyWrapper.style.flexGrow).toBe('0'); // never grows → charts never starve
    expect(energyWrapper.style.flexBasis).toBe('auto'); // natural (table) width
    expect(energyWrapper.style.minWidth).toBe('0px'); // shrinkable at narrow docks
  });

  // --- Work & power table collapse (owner request 2026-07-12) ------------------

  it('collapses the work & power table from its own header control', () => {
    render(<Charts />);
    expect(useAppStore.getState().workTableCollapsed).toBe(false);
    expect(screen.getByText('Total')).toBeTruthy(); // table visible by default
    fireEvent.click(screen.getByLabelText('Collapse work & power table'));
    expect(useAppStore.getState().workTableCollapsed).toBe(true);
    expect(screen.queryByText('Total')).toBeNull(); // table unmounted, not just hidden
  });

  it('shows a discoverable slim strip when collapsed, which reopens the table', () => {
    useAppStore.setState({ workTableCollapsed: true });
    render(<Charts />);
    expect(screen.queryByText('Total')).toBeNull();
    const expandButton = screen.getByLabelText('Expand work & power');
    expect(expandButton).toBeTruthy();
    fireEvent.click(expandButton);
    expect(useAppStore.getState().workTableCollapsed).toBe(false);
    expect(screen.getByText('Total')).toBeTruthy(); // table back
  });

  it('reflows the charts to split the full dock width when the table is collapsed (no reserved gutter)', () => {
    render(<Charts />);
    const chartsBody = screen.getByLabelText('Hand speed chart').parentElement as HTMLElement;
    // Visible: the table sibling reserves its natural (shrinkable) width.
    const visibleSibling = chartsBody.nextElementSibling as HTMLElement;
    expect(visibleSibling.style.flexBasis).toBe('auto');
    expect(visibleSibling.style.flexShrink).toBe('1');

    fireEvent.click(screen.getByLabelText('Collapse work & power table'));

    // Collapsed: ChartsBody remains the only grower (unchanged), and the sibling
    // shrinks to the fixed slim-strip width — not the ~19rem table width — so
    // ChartsBody's flex-grow: 1 absorbs everything else, splitting the full dock
    // width between the three canvases with no reserved table-sized gutter.
    expect(chartsBody.style.flexGrow).toBe('1');
    expect(chartsBody.style.flexBasis).toBe('60%');
    const collapsedSibling = chartsBody.nextElementSibling as HTMLElement;
    expect(collapsedSibling.style.flexGrow).toBe('0');
    expect(collapsedSibling.style.flexShrink).toBe('0'); // pinned, not table-shrinkable
    expect(collapsedSibling.style.width).toBe('30px'); // COLLAPSED_STRIP, not the table
  });
});
