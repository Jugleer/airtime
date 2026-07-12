import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_GRAPH_THROW_LABELS,
  DEFAULT_SHOW_HANDS,
  DEFAULT_SHOW_HAND_PATHS,
  useAppStore,
} from './index';
import { decodeConfig, encodeConfig } from './codec';

// Reset to a clean default sim before each test (the store is a module singleton).
beforeEach(() => {
  useAppStore.getState().applyConfig(useAppStore.getState().currentConfig());
  useAppStore.setState({
    showHands: DEFAULT_SHOW_HANDS,
    showHandPaths: DEFAULT_SHOW_HAND_PATHS,
    graphThrowLabels: DEFAULT_GRAPH_THROW_LABELS,
  });
});

describe('hand + graph view toggles (defaults, setters, codec)', () => {
  it('pins the fresh-boot defaults (hands ON, hand paths OFF, throw labels ON)', () => {
    expect(DEFAULT_SHOW_HANDS).toBe(true);
    expect(DEFAULT_SHOW_HAND_PATHS).toBe(false);
    expect(DEFAULT_GRAPH_THROW_LABELS).toBe(true);
    const state = useAppStore.getState();
    expect(state.showHands).toBe(true);
    expect(state.showHandPaths).toBe(false);
    expect(state.graphThrowLabels).toBe(true);
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

    store.toggleGraphThrowLabels();
    expect(useAppStore.getState().graphThrowLabels).toBe(false);
    store.setGraphThrowLabels(true);
    expect(useAppStore.getState().graphThrowLabels).toBe(true);
  });

  it('carries the flags through currentConfig → applyConfig (share/preset round-trip)', () => {
    useAppStore.setState({
      showHands: false,
      showHandPaths: true,
      graphThrowLabels: false,
    });
    const config = useAppStore.getState().currentConfig();
    expect(config.showHands).toBe(false);
    expect(config.showHandPaths).toBe(true);
    expect(config.graphThrowLabels).toBe(false);

    // Flip live state, then re-apply the snapshot: the flags come back.
    useAppStore.setState({
      showHands: true,
      showHandPaths: false,
      graphThrowLabels: true,
    });
    useAppStore.getState().applyConfig(config);
    const state = useAppStore.getState();
    expect(state.showHands).toBe(false);
    expect(state.showHandPaths).toBe(true);
    expect(state.graphThrowLabels).toBe(false);
  });

  it('decodes an old link without gt as throw labels ON (default via merge)', () => {
    // Encode a fresh config, then strip the `gt` key to emulate a pre-2026-07-12 link.
    const query = encodeConfig(useAppStore.getState().currentConfig());
    const params = new URLSearchParams(query);
    params.delete('gt');
    const decoded = decodeConfig(params);
    // Absent key ⇒ not in the partial; the boot merge keeps the store default (ON).
    expect(decoded.graphThrowLabels).toBeUndefined();
    expect(DEFAULT_GRAPH_THROW_LABELS).toBe(true);
  });
});
