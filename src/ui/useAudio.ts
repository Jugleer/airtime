// src/ui/useAudio — the WebAudio side of the ticks (DESIGN.md §6 audio).
//
// Synthesized clicks only (no assets, CLAUDE.md): each tick is an oscillator with
// a fast gain envelope. Ticks are scheduled ahead of time against the AudioContext
// clock using the classic lookahead pattern (a ~25 ms interval schedules ~120 ms
// ahead), so they stay sample-accurate even as React frames jitter. The wall→sim
// mapping is reconstructed here from the store's simTime + playbackSpeed: an anchor
// pairs one audioContext time with one simTime, and each tick's audio time is
// `anchorAudio + (tickSim − anchorSim) / playbackSpeed`.
//
// The classic bugs this guards against:
//   - autoplay policy: the AudioContext is created/resumed on the user gesture that
//     enables audio (a store subscription fires inside the click's call stack).
//   - scrub / pause / rate change: any of these invalidates the anchor; we cancel
//     the still-pending oscillators and re-anchor from the new simTime, so ticks do
//     not fire at stale times and there is no rescheduling storm (a monotone
//     `scheduledUntilSim` cursor means each tick is scheduled exactly once).
//
// All of this is ui/state only — core never learns audio exists.

import { useEffect } from 'react';
import { useAppStore } from '../state';
import { ticksInRange, type TickEvent } from './audio';

/** Scheduler cadence and how far ahead (in real seconds) we schedule. */
const SCHEDULER_INTERVAL_MS = 25;
const LOOKAHEAD_SECONDS = 0.12;
/** Re-anchor when the observed simTime drifts from the anchor's prediction by this. */
const RESYNC_TOLERANCE_SECONDS = 0.08;
/** Tick envelope shape. */
const TICK_ATTACK = 0.001;
const TICK_DECAY = 0.06;
const TICK_PEAK = 0.9;

interface AudioContextCtor {
  new (): AudioContext;
}

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const w = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

interface Anchor {
  readonly audioTime: number;
  readonly simTime: number;
  readonly speed: number;
}

/**
 * Mount once (in <App>) to synthesize throw/catch ticks from the event timeline.
 * A no-op where WebAudio is unavailable (jsdom / unsupported browsers).
 */
export function useAudio(): void {
  useEffect(() => {
    const Ctor = audioContextCtor();
    if (Ctor === null) {
      return; // no WebAudio: audio simply does nothing (guarded, never crashes)
    }

    let ctx: AudioContext | null = null;
    let master: GainNode | null = null;
    const pending: { osc: OscillatorNode; gain: GainNode }[] = [];
    const scheduled = new Set<string>();
    let anchor: Anchor | null = null;
    let scheduledUntilSim = 0;

    const ensureContext = (): AudioContext => {
      if (ctx === null) {
        ctx = new Ctor();
        master = ctx.createGain();
        master.gain.value = useAppStore.getState().audioVolume;
        master.connect(ctx.destination);
      }
      return ctx;
    };

    const cancelPending = (): void => {
      for (const node of pending) {
        try {
          node.gain.gain.cancelScheduledValues(0);
          node.osc.stop();
          node.osc.disconnect();
          node.gain.disconnect();
        } catch {
          // A node may have already ended; ignore.
        }
      }
      pending.length = 0;
      scheduled.clear();
      anchor = null;
    };

    const scheduleClick = (context: AudioContext, when: number, tick: TickEvent): void => {
      if (master === null) {
        return;
      }
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(tick.frequency, when);
      gain.gain.setValueAtTime(0, when);
      gain.gain.linearRampToValueAtTime(TICK_PEAK, when + TICK_ATTACK);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + TICK_DECAY);
      osc.connect(gain);
      gain.connect(master);
      osc.start(when);
      osc.stop(when + TICK_DECAY + 0.02);
      const entry = { osc, gain };
      pending.push(entry);
      osc.onended = (): void => {
        const index = pending.indexOf(entry);
        if (index >= 0) {
          pending.splice(index, 1);
        }
        try {
          osc.disconnect();
          gain.disconnect();
        } catch {
          // ignore
        }
      };
    };

    const scheduler = (): void => {
      const state = useAppStore.getState();
      if (!state.audioEnabled) {
        if (pending.length > 0 || anchor !== null) {
          cancelPending();
        }
        return;
      }
      const context = ensureContext();
      if (context.state === 'suspended') {
        void context.resume();
      }
      if (master !== null) {
        master.gain.value = state.audioVolume;
      }
      // Paused: hold silent and drop the anchor so playback re-anchors cleanly.
      if (!state.playing) {
        if (pending.length > 0 || anchor !== null) {
          cancelPending();
        }
        return;
      }

      const audioNow = context.currentTime;
      const speed = state.playbackSpeed;
      const predictedSim =
        anchor !== null ? anchor.simTime + (audioNow - anchor.audioTime) * anchor.speed : null;
      const needResync =
        anchor === null ||
        anchor.speed !== speed ||
        (predictedSim !== null && Math.abs(predictedSim - state.simTime) > RESYNC_TOLERANCE_SECONDS);
      if (needResync) {
        cancelPending();
        anchor = { audioTime: audioNow + 0.02, simTime: state.simTime, speed };
        scheduledUntilSim = state.simTime;
      }
      const activeAnchor = anchor as Anchor;

      const lookaheadSim = LOOKAHEAD_SECONDS * speed;
      const endSim = state.simTime + lookaheadSim;
      const fromSim = Math.max(scheduledUntilSim, state.simTime);
      const ticks = ticksInRange(state.sim.timeline.events, fromSim, endSim, state.catchTickEnabled);
      for (const tick of ticks) {
        if (scheduled.has(tick.key)) {
          continue;
        }
        const when = activeAnchor.audioTime + (tick.time - activeAnchor.simTime) / speed;
        if (when < audioNow) {
          continue; // already in the past — skip rather than fire late
        }
        scheduleClick(context, when, tick);
        scheduled.add(tick.key);
      }
      scheduledUntilSim = Math.max(scheduledUntilSim, endSim);
    };

    // Create/resume the context on the gesture that turns audio ON (autoplay policy):
    // this listener runs inside the toggle's set() call stack, i.e. within the
    // browser's user-activation window.
    const unsubscribe = useAppStore.subscribe((state, prev) => {
      if (state.audioEnabled && !prev.audioEnabled) {
        const context = ensureContext();
        void context.resume();
      }
    });

    const intervalId = setInterval(scheduler, SCHEDULER_INTERVAL_MS);
    return () => {
      clearInterval(intervalId);
      unsubscribe();
      cancelPending();
      if (ctx !== null) {
        void ctx.close();
      }
    };
  }, []);
}
