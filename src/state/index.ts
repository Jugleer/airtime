import { create } from 'zustand';
import { effectiveDwell } from '../core/timing';

// Phase 0 placeholder store (DESIGN.md §2 "src/state"). The full config/clock
// store, selectors, and URL/localStorage codecs arrive in later phases.

export interface AppStore {
  /** Current siteswap pattern text (DESIGN.md §7 default: "3", the 3-ball cascade). */
  readonly pattern: string;
  setPattern: (pattern: string) => void;
}

export const useAppStore = create<AppStore>((set) => ({
  pattern: '3',
  setPattern: (pattern) => set({ pattern }),
}));

/**
 * Phase 0 smoke value exercising the state -> core dependency direction
 * (DESIGN.md §2) with default timing (DESIGN.md §7): t_d = 0.30 s, h = 3,
 * tau_b = 0.25 s.
 */
export const defaultEffectiveDwell = effectiveDwell(0.3, 3, 0.25);
