# BUILD_LOG.md — Orchestrator Ledger

Append-only record of the phased build. Owned by the orchestrator (builders do not
edit this file). See ORCHESTRATOR_PROMPT.md for the protocol.

**Next phase: 4**

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

## Phase 2 — Core: kinematics & energy            DONE
- Date: 2026-07-09
- Commit: efba2bf
- Gate: (2026-07-09, "npm run gate", green — 10 test files / 126 tests, typecheck + lint clean, build ok; run independently by orchestrator after builder AND after fixup)
- Coverage (orchestrator-verified, lines): kinematics 99.4 % (poly/vec3 100 %), energy 100 % — bar ≥ 90 %. Phase 1 modules unregressed (siteswap 98.1 %, timeline 98.1 %, timing 100 %).
- Builder deviations from plan:
  - Geometry seam: kinematics layers over the (purely temporal) Phase 1 timeline via buildKinematics(timeline, options) rather than baking positions into ThrowEvent — epoch immutability inherited for free; release point & velocity available on demand per DESIGN §2.
  - Line + circle hand-geometry presets implemented in core (pure geometry, needed for n_h≠2 evaluation); UI preset selection/editing stays Phase 6.
  - Via-point derivatives: via velocity = carry chord velocity, via accel = (0,−g,0) — contact force zero at catch, dip, and release.
  - Cubic comparison path has no via-point/dip (velocity-matched only, per spec) — UI may note this when the toggle lands (Phase 7).
- Review (math-heavy phase — fresh Opus reviewer; re-derived quintic Hermite system, probed with executable specs + 200k-point quadrature): parabola solver, quintic coefficients, C² via stitch, event-continuity chain, root isolation, energy split, aggregation window all verified correct on the v1 path. Findings: two MEDIUM held-2 defects at n_h≥3 (position teleport ~0.5 m; static-hold over-count) — deferred pending design ruling (below); LOWs on generator axes/tolerances/split-pinning — fixed by a test-strengthening fixup (tolerances now 1e-10/1e-10/1e-9; axes holdDepth 0–0.4, g 0.5–30, n_h 1–8; independent W⁺/W⁻ quadrature oracle; work–energy identity at g∈{0.5,30}×holdDepth∈{0,0.4}).
- PENDING DESIGN DECISION (surfaced to owner 2026-07-09, non-blocking until Phase 6):
  - Held `2`s are physically consistent ONLY at n_h = 2. At n_h ≥ 3 the landing-hand rule (k+2) mod n_h moves the ball between hands (current code: 0.5 m teleport + ~9 m/s spike at the rethrow, e.g. 522/423 at n_h=3; static-hold count inflated). At n_h = 1 a multi-beat hold overlaps the hand's other carries (two balls in one hand; ~27–73 m/s discontinuity). Discovered by review + fixup measurement; the continuity property test documents the exclusion ("held-2 at n_h≠2: pending design decision").
  - Orchestrator recommendation: hold a 2 iff n_h = 2; at n_h ≠ 2 treat 2s as ordinary short airborne throws (the "tiny hop" DESIGN defers as a toggle is the only honest physics there). Owner ruling requested before Phase 6 wires the n_h stepper.
- Deferred items:
  - evaluateSegment recomputes derivative polynomials per call — precompute per-segment vel/acc/jerk polys if Phase 4/5 render hot paths need it (perf, not correctness).
  - Held-forever hands at n_h≥3 over-count balls (folds into the pending decision above).
- Operator visual checks pending: n/a (no visuals this phase)

## Phase 3 — Ladder diagram + minimal shell            DONE
- Date: 2026-07-09
- Commit: b07b687
- Gate: (2026-07-09, "npm run gate", green — 14 test files / 149 tests, typecheck + lint clean [zero warnings incl. new react-hooks rules], build ok 215 kB / 69 kB gzip; run independently by orchestrator)
- Builder deviations from plan:
  - beatPeriod/dwellTime sliders wired as core epochs at the next beat (slew + arrival guard therefore already active) — more than Phase 3 required; Phase 6 keeps only the UX polish (amber clamp readout, guard visualization).
  - Autoplay on startup (playing: true) so the debug view is alive untouched — consistent with §7 "startup cascade looks natural".
  - Per-ball hue coloring in the ladder as a debug aid (NOT the orbit-coloring toggle; that mirrors 3D in Phase 4).
  - eslint-plugin-react-hooks v7 added with the classic pair (rules-of-hooks error / exhaustive-deps warn) scoped to src/**; the full React-Compiler rule set left as a future opt-in.
- Decisions made (reversible forks):
  - Ladder rendered as SVG (crispness + testability; no chart lib).
  - Timeline horizon: extend in 128-beat chunks when generated time < simTime + view span + 6 s, checked against actual beatTime (robust to slew); startup 160 beats.
  - playbackSpeed is a pure wall→sim rescale — test pins that the sim object is untouched.
- Deferred items:
  - Ladder draws short prehistory carry lead-ins near t=0 (scrolls off in ~1 s); filter on startTime ≥ 0 if the operator finds it noisy.
  - Orbit-coloring toggle for ladder — with the 3D scene (Phase 4).
  - format:check flags some committed core files (Prettier is not in the gate); leave until a deliberate formatting pass.
- Operator visual checks pending (run `npm run dev -- --host` on the Jetson, open the LAN URL on a desktop browser):
  - [ ] Ladder for `531`: the 5-arc (flight + carry) spans 5 beats; the 1-arc barely clears one beat and its dwell is visibly shorter (t_d_eff clamp).
  - [ ] Sanity patterns `3`, `40`, `522`: arcs land on the correct hand lane; `522`'s held 2 spans multiple beats as one carry; `40`'s 0 shows an idle gap.
  - [ ] Pattern input: typing an invalid pattern (e.g. `543`) shows the beat-accurate collision message and the last valid pattern keeps animating.
  - [ ] Play/pause freezes/resumes the cursor without jumps; playback-speed slider changes apparent speed only (pattern shape identical).
