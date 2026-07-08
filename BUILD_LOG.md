# BUILD_LOG.md — Orchestrator Ledger

Append-only record of the phased build. Owned by the orchestrator (builders do not
edit this file). See ORCHESTRATOR_PROMPT.md for the protocol.

**Next phase: 2**

---

## Entry template

```
## Phase N — <title>            <status: DONE | BLOCKED>
- Date: YYYY-MM-DD
- Commit: <sha>
- Gate: (YYYY-MM-DD, "npm run gate", <result summary — counts, duration>)
- Builder deviations from plan: <none | list>
- Decisions made (reversible forks): <none | decision + rationale>
- Deferred items: <none | list>
- Operator visual checks pending: <n/a | checklist>
```

---

## Phase 0 — Scaffold            DONE
- Date: 2026-07-08
- Commit: b67faa5
- Gate: (2026-07-08, "npm run gate", green — typecheck ok, lint ok, 9 test files / 18 tests passed in 2.1 s, vite build ok, 192 kB bundle / 61 kB gzip; run independently by orchestrator, not taken from builder report)
- Builder deviations from plan:
  - Playwright NOT removed: `npx playwright install chromium` succeeded on this arm64 Ubuntu 20.04 box and a headless launch smoke test passed. `@playwright/test` kept as devDependency; no e2e config/spec dir/script yet (Playwright is not part of the gate) — the first visual phase that wants e2e adds the harness.
  - Single `tsconfig.json` instead of the Vite template app/node split; strictness beyond `strict` (noUncheckedIndexedAccess, noImplicitReturns, noUnusedLocals/Params, verbatimModuleSyntax).
  - ESLint uses non-type-checked tseslint configs (lint speed on the Jetson; boundary rules need no type info).
- Decisions made (reversible forks):
  - Orchestrator: renamed branch `master` → `main` (GitHub default; Phase 9 deploys Pages from main). Created public repo https://github.com/Jugleer/airtime (user approved); pushing after each phase.
  - Versions resolved to mid-2026 latest: React 19.2, three 0.185, r3f 9.6, drei 10.7, zustand 5.0, TypeScript 6.0, Vite 8.1, Vitest 4.1, ESLint 10 (flat), fast-check 4.8. React 19 pinned to r3f v9 peer requirement.
- Deferred items:
  - eslint-plugin-react-hooks / react-refresh — add when React component logic lands (Phase 3+).
  - Coverage wired (`test:coverage`, v8 provider, scoped to src/core/**) but not part of the gate; Phases 1–2 use it for their ≥ 90 % core coverage bar.
  - Playwright e2e harness (config + spec dir + script) — first visual phase that wants it.
- Operator visual checks pending: n/a (builder verified `npm run dev -- --host` serves the placeholder page with LAN URLs)
- Orchestrator verification notes: core-boundary lint rule probed independently (violating file in src/core → 3 errors, exit 1); orchestrator-owned docs untouched by builder; no builder commits (all work arrived as working-tree changes, as instructed).

## Phase 1 — Core: siteswap, timing, event timeline            DONE
- Date: 2026-07-09
- Commit: 20f1e8d
- Gate: (2026-07-09, "npm run gate", green — 9 test files / 73 tests, typecheck + lint clean, build ok; run independently by orchestrator after builder AND after fixup)
- Coverage (orchestrator-verified from coverage JSON, lines): siteswap 98.1 %, timeline 98.1 %, timing 100 % — bar is ≥ 90 % each. Note: vitest 4 text reporter hides 100 % files; the JSON has all six core modules.
- Builder deviations from plan:
  - Integer-average check kept although provably redundant given collision-freedom (spec lists both; keeps the error branch reachable). All errors collected, not just the first.
  - `spatialPeriodBeats` returns beats (τ_b-invariant), seconds are a later UI readout.
  - A flight's landing hand is frozen at throw time (required for epoch immutability).
- Review (math-heavy phase — fresh Opus reviewer, hand-worked examples incl. 531 timing and a brute force of length-≤5 collision semantics): load-bearing math verified correct (identities 1 & 4 incl. incoming-value dwell keying, state machine, slew guard, epoch immutability). Findings: H1 vacuous test assertion, M2 spurious zero-ball orbit cycles (contradicted NOTATION), M3 handCount-in-epoch ill-defined (catch hand ≠ carry/rethrow hand), L4–L8 message/edge polish. All 8 fixed by a fixup builder; gate + coverage re-verified by orchestrator.
- Decisions made (reversible forks):
  - `n_h` changes are a **full timeline rebuild**, not an epoch — `Epoch.params` excludes `handCount` at the type level; Phase 6 wires the stepper accordingly. Rationale: an in-flight ball's frozen landing hand and the new beat→hand mapping cannot both hold under an n_h epoch.
  - Guard NaN path (value-1 self-arrival during schedule build) resolved by explicit skip: that arrival provably cannot bind the guard.
  - `beatTime(beat)` beyond the generated range now throws RangeError instead of returning NaN.
- Deferred items:
  - Held-forever orbits (σ-cycles that are all 2s, e.g. pattern `2` or `22`): the ball never leaves a hand, so no flight/carry segments are emitted for it; excluded from the ball-conservation property test (documented in-test). Revisit if a "static hold" segment type is wanted (likely Phase 2/3 for hand paths of pattern `2`).
  - landingSchedule==stateAt property generator varies handCount although neither side uses it (wasted generator dimension, harmless).
- Operator visual checks pending: n/a (no visuals this phase)
