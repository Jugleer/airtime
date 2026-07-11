import { beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from './index';

// Sync/multiplex entry in the store: extended patterns clean-restart (ruling 2),
// sync forces n_h = 2 (ruling 1), and the state graph is disabled for them (ruling 3).

function reset(): void {
  useAppStore.getState().applyConfig(useAppStore.getState().currentConfig());
  useAppStore.getState().setHandCount(2);
  useAppStore.getState().setPattern('3');
}

beforeEach(reset);

describe('entering a sync pattern', () => {
  it('sets a compiled sim, ball count, and clean-restarts at t = 0', () => {
    useAppStore.setState({ simTime: 4 });
    useAppStore.getState().setPattern('(4,4)');
    const state = useAppStore.getState();
    expect(state.sim.compiled?.sync).toBe(true);
    expect(state.sim.ballCount).toBe(4);
    expect(state.sim.patternText).toBe('(4,4)');
    expect(state.simTime).toBe(0); // clean restart
    expect(state.transition).toBeNull();
  });

  it('auto-sets the hand count to 2 when it was different (ruling 1)', () => {
    useAppStore.getState().setHandCount(4);
    useAppStore.getState().setPattern('(6x,4)*');
    const state = useAppStore.getState();
    expect(state.handCount).toBe(2);
    expect(state.baseParams.handCount).toBe(2);
    expect(state.graphNotice).toMatch(/hand count set to 2/i);
    expect(state.sim.ballCount).toBe(5);
  });
});

describe('hand count is locked while a sync pattern runs (ruling 1, belt-and-braces)', () => {
  it('setHandCount cannot move a running sync sim off 2 hands', () => {
    useAppStore.getState().setPattern('(4,4)');
    expect(useAppStore.getState().sim.compiled?.sync).toBe(true);
    expect(useAppStore.getState().handCount).toBe(2);
    const before = useAppStore.getState().sim;
    // Every attempt is a no-op: the sync sim stays at 2 hands and the sim is untouched.
    useAppStore.getState().setHandCount(4);
    expect(useAppStore.getState().handCount).toBe(2);
    useAppStore.getState().setHandCount(1);
    expect(useAppStore.getState().handCount).toBe(2);
    expect(useAppStore.getState().sim).toBe(before); // sim not rebuilt
  });

  it('the same stepper works normally once the pattern is vanilla again', () => {
    useAppStore.getState().setPattern('(4,4)');
    useAppStore.getState().setHandCount(3); // ignored under sync
    expect(useAppStore.getState().handCount).toBe(2);
    useAppStore.getState().setPattern('3'); // leave sync
    useAppStore.getState().setHandCount(3); // now honored
    expect(useAppStore.getState().handCount).toBe(3);
  });
});

describe('entering a multiplex (async) pattern', () => {
  it('keeps the current hand count (multiplex works at any n_h)', () => {
    useAppStore.getState().setHandCount(3);
    useAppStore.getState().setPattern('[33]33');
    const state = useAppStore.getState();
    expect(state.handCount).toBe(3);
    expect(state.sim.compiled?.multiplex).toBe(true);
    expect(state.sim.ballCount).toBe(4);
  });
});

describe('leaving a sync/multiplex pattern for vanilla', () => {
  it('clean-restarts back to the vanilla path (no compiled sim)', () => {
    useAppStore.getState().setPattern('(4,4)');
    expect(useAppStore.getState().sim.compiled).toBeDefined();
    useAppStore.setState({ simTime: 2 });
    useAppStore.getState().setPattern('5');
    const state = useAppStore.getState();
    expect(state.sim.compiled).toBeUndefined();
    expect(state.sim.patternText).toBe('5');
    expect(state.sim.ballCount).toBe(5);
    expect(state.simTime).toBe(0);
  });
});

describe('state-graph navigation is disabled for compiled patterns (ruling 3)', () => {
  it('navigateToState is a no-op while a sync pattern runs', () => {
    useAppStore.getState().setPattern('(4,4)');
    const before = useAppStore.getState().sim;
    useAppStore.getState().navigateToState(0b1111);
    expect(useAppStore.getState().sim).toBe(before); // unchanged
  });
});

describe('invalid extended input', () => {
  it('surfaces the error and keeps the running sim', () => {
    useAppStore.getState().setPattern('531');
    const running = useAppStore.getState().sim;
    useAppStore.getState().setPattern('(6x,4)'); // unmirrored → unbalanced
    const state = useAppStore.getState();
    expect(state.validation.ok).toBe(false);
    expect(state.sim).toBe(running); // sim unchanged
    expect(state.pattern).toBe('(6x,4)'); // input echoed
  });
});

describe('share round-trip for extended patterns (ruling 9)', () => {
  it('a sync pattern survives currentConfig → applyConfig', () => {
    useAppStore.getState().setPattern('(6x,4)*');
    const config = useAppStore.getState().currentConfig();
    expect(config.pattern).toBe('(6x,4)*');
    useAppStore.getState().setPattern('3'); // move away
    useAppStore.getState().applyConfig(config);
    const state = useAppStore.getState();
    expect(state.sim.compiled?.sync).toBe(true);
    expect(state.sim.ballCount).toBe(5);
    expect(state.handCount).toBe(2);
  });

  it('an invalid shared pattern falls back to the default (never crashes)', () => {
    const config = { ...useAppStore.getState().currentConfig(), pattern: '(6x,4)' };
    useAppStore.getState().applyConfig(config);
    expect(useAppStore.getState().sim.compiled).toBeUndefined();
    expect(useAppStore.getState().sim.patternText).toBe('3');
  });
});
