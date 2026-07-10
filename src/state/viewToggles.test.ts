import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_GRAPH_MINIMAP,
  DEFAULT_SHOW_HANDS,
  DEFAULT_SHOW_HAND_PATHS,
  useAppStore,
} from './index';

// Reset to a clean default sim before each test (the store is a module singleton).
beforeEach(() => {
  useAppStore.getState().applyConfig(useAppStore.getState().currentConfig());
  useAppStore.setState({
    showHands: DEFAULT_SHOW_HANDS,
    showHandPaths: DEFAULT_SHOW_HAND_PATHS,
    graphMinimap: DEFAULT_GRAPH_MINIMAP,
  });
});

describe('hand + minimap view toggles (defaults, setters, codec)', () => {
  it('pins the fresh-boot defaults (hands ON, hand paths OFF, minimap ON)', () => {
    expect(DEFAULT_SHOW_HANDS).toBe(true);
    expect(DEFAULT_SHOW_HAND_PATHS).toBe(false);
    expect(DEFAULT_GRAPH_MINIMAP).toBe(true);
    const state = useAppStore.getState();
    expect(state.showHands).toBe(true);
    expect(state.showHandPaths).toBe(false);
    expect(state.graphMinimap).toBe(true);
  });

  it('toggles and sets each flag through the store', () => {
    const store = useAppStore.getState();

    store.toggleShowHands();
    expect(useAppStore.getState().showHands).toBe(false);
    store.setShowHands(true);
    expect(useAppStore.getState().showHands).toBe(true);

    store.toggleShowHandPaths();
    expect(useAppStore.getState().showHandPaths).toBe(true);
    store.setShowHandPaths(false);
    expect(useAppStore.getState().showHandPaths).toBe(false);

    store.toggleGraphMinimap();
    expect(useAppStore.getState().graphMinimap).toBe(false);
    store.setGraphMinimap(true);
    expect(useAppStore.getState().graphMinimap).toBe(true);
  });

  it('carries the flags through currentConfig → applyConfig (share/preset round-trip)', () => {
    useAppStore.setState({ showHands: false, showHandPaths: true, graphMinimap: false });
    const config = useAppStore.getState().currentConfig();
    expect(config.showHands).toBe(false);
    expect(config.showHandPaths).toBe(true);
    expect(config.graphMinimap).toBe(false);

    // Flip live state, then re-apply the snapshot: the flags come back.
    useAppStore.setState({ showHands: true, showHandPaths: false, graphMinimap: true });
    useAppStore.getState().applyConfig(config);
    const state = useAppStore.getState();
    expect(state.showHands).toBe(false);
    expect(state.showHandPaths).toBe(true);
    expect(state.graphMinimap).toBe(false);
  });
});
