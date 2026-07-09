# BUILD_LOG.md — Orchestrator Ledger

Append-only record of the phased build. Owned by the orchestrator (builders do not
edit this file). See ORCHESTRATOR_PROMPT.md for the protocol.

**Next phase: 8**

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

## Phase 4 — 3D scene            DONE
- Date: 2026-07-09
- Commit: 960079e
- Gate: (2026-07-09, "npm run gate", green — 16 test files / 164 tests, typecheck + lint clean, build ok 1.12 MB / 310 kB gzip [three.js weight; informational chunk-size warning only]; run independently by orchestrator)
- Builder deviations from plan:
  - Ladder keeps its per-ball debug coloring rather than following the orbit toggle — deferred consistency item (DESIGN §6 says the ladder follows the toggle); revisit alongside Phase 5/7 view work.
  - Camera preset switching snaps (no tween) — acceptable, polish later if desired.
- Decisions made (reversible forks):
  - Clock: useClock stays the sole wall-clock driver; r3f useFrame is a pure reader of simTime (rejected useFrame-driven ticking — would couple the sim clock to Canvas presence, violating "no per-view time").
  - ballId→orbit mapping derived in render3d from existing core exports (throw beat mod L walks one σ-cycle; static holds via hand mod L) — no additive core export needed.
  - WebGL-capability guard renders a placeholder in jsdom/no-WebGL environments (also graceful in real browsers without WebGL).
- Deferred items:
  - Bundle >500 kB chunk warning (three.js) — code-splitting consideration in the Phase 9 performance pass.
  - Per-frame MotionState/Vec3 allocations inside core ballState acceptable at b ≤ 9; per-segment derivative cache remains the noted optimization if profiling ever shows GC pressure.
  - Ladder orbit-coloring consistency (above).
- Operator visual checks pending (npm run dev -- --host, LAN URL from desktop):
  - [ ] Cascade `3` looks like a cascade (figure-eight-ish arcs, no teleports); `441` and `531` look right.
  - [ ] Camera: orbit/pan/zoom navigable; four preset buttons (front/side/top/juggler POV) frame the pattern sensibly.
  - [ ] No stutter at defaults on a desktop browser (60 fps target); report GPU/browser if it stutters.
  - [ ] Orbit-coloring toggle on `531` shows two colors (two orbits); single-color picker works; ball-radius slider scales spheres live.
  - [ ] Pattern `2`: two balls rest in hands (static holds), nothing crashes.

## Phase 5 — Timeline bar, tracers, ghosts            DONE
- Date: 2026-07-09
- Commit: e44fc25
- Gate: (2026-07-09, "npm run gate", green — 19 test files / 197 tests, typecheck + lint clean, build ok 1.13 MB / 313 kB gzip; run independently by orchestrator)
- Note: 30-minute pre-phase pause waived by explicit user permission for this phase only.
- Builder deviations from plan:
  - Scrub gesture pauses the clock (setPlaying false) and restores on release rather than a dedicated store flag — brief Pause/Play label flicker during drags is the only cost.
  - Trail handle drag range is 0–pastSpan (window × 0.3); longer trails come from the Trail length slider, at which point the handle pins with the readout. Default trail 0.8 s.
- Decisions made (reversible forks):
  - Playhead anchored at 0.3 of the window while playing; windowStart frozen during an active scrub so content doesn't slide under the pointer.
  - Ghost span fixed at 1.5 s (inside the 6 s horizon margin); dashed material with manually maintained line distances (no per-frame computeLineDistances allocation).
  - Trails: uniform 12 ms resampling of exact analytic position(t) into per-ball Float32Arrays sized once for the 8 s max (667 pts), drawRange updates, frustumCulled off; zero per-frame geometry allocation.
  - Ladder now shares timelineWindow with the bar (views rhyme, one control).
  - Period readout uses the current target beat period under slew (documented in-code).
- Deferred items: none new (three.js bundle-size warning stays with the Phase 9 performance pass).
- Operator visual checks pending (npm run dev -- --host, LAN URL from desktop):
  - [ ] Scrub while paused: balls, ladder, and trails all move smoothly and stay consistent; release while playing resumes from the scrubbed time.
  - [ ] Trails match the flight paths exactly (parabolas overlay the balls' actual arcs; carry segments dip through the hold).
  - [ ] Ghosts extend the trails forward as dashed paths; checkbox hides them.
  - [ ] Trail handle: drag it left to lengthen the trail; push trail length past the window via the slider — handle pins to the left edge with a numeric readout.
  - [ ] Period readout matches expectation (e.g. pattern 3 at defaults: repeats every 0.50 s).

## Phase 6 — Runtime parameters & hand geometry            DONE
- Date: 2026-07-09
- Commit: 30bb0b7
- Gate: (2026-07-09, "npm run gate", green — 19 test files / 221 tests, typecheck + lint clean, build ok 1.14 MB / 316 kB gzip; run independently by orchestrator)
- Core reopened (authorized additive extension): kinematics epochs (gravity/holdDepth/geometry/carryPath per segment-start time, in-flight parabolas frozen, endpoints threaded through connecting flights) + per-carry gravity in energy. Scoped fresh-Opus core re-review verdict: SOUND, no gate-worthy issues (probes confirmed velocity continuity across combined geometry+gravity seams and straddling-carry endpoint threading).
- Review LOWs recorded (polish, not fixed):
  - Held-forever static holds (all-2 hands) ignore later geometry/holdDepth epochs (rest at base position; internally consistent, no teleport).
  - KinematicsEpoch.geometry is not guarded against a mismatched hand count (same as the base option; degrades by index-wrapping).
  - Equal-time epoch tie-break = input order via stable sort (matches timeline convention; undocumented).
  - Test-strength nits: post-epoch-new-g assertion conditional on a value≥3 flight existing; seam check asserts position (velocity verified by review probe at < 1e-6).
- Builder deviations from plan:
  - Kinematics epochs snap to the next beat boundary (drag coalescing; aligns with throw times).
  - Incidental side effect: the held-2 n_h≠2 carry now renders position-continuous (cross-hand carry) because endpoints thread through flights — the velocity mismatch and the design ruling remain open; hold semantics unchanged.
- Decisions made (reversible forks):
  - Gravity lives in kinematics epochs only (air time is g-independent; timing untouched) — not in TimelineParams.
  - n_h/preset changes: full rebuild carrying pattern+clock, kinematics epochs cleared, geometry reset to preset.
  - Gizmos: plane-constrained pointer drag at y = 1.0 with pointer capture; OrbitControls disabled during drag only.
- Deferred items: none new (bundle-size warning stays with Phase 9).
- PENDING DESIGN DECISION (still open, owner ruling requested): held 2s at n_h ≠ 2 — see Phase 2 entry. UI now shows a non-blocking note when a 2-containing pattern runs at n_h ≠ 2.
- Operator visual checks pending (npm run dev -- --host, LAN URL from desktop):
  - [ ] Drag tempo slowly 0.25 → 0.5 s: cascade slows AND rises smoothly, no teleports/discontinuities (slew + guard).
  - [ ] Open hand-positions editor, drag a catch gizmo mid-flight: in-flight balls land where originally aimed; only later throws go to the new point.
  - [ ] n_h=3 + circle preset with pattern 3: juggles correctly, pattern cycles hands (period changes hands).
  - [ ] Gravity slider low (moon) and high: arcs flatten/heighten from the change onward only; dwell readout turns amber when clamping (try pattern 1 or 51 with long dwell).
  - [ ] Carry-path toggle quintic → cubic: hold dip disappears (cubic has no via-point) — the acceleration-jump character shows in Phase 7 charts.
  - [ ] Held-2 note appears for e.g. pattern 522 at n_h=3.

## Phase 7 — Charts & energy panel            DONE
- Date: 2026-07-09
- Commit: 2e8aab5
- Gate: (2026-07-09, "npm run gate", green — 22 test files / 261 tests, typecheck + lint clean, build ok; run independently by orchestrator)
- Note: 30-minute pre-phase pause waived by explicit user permission for this phase.
- Builder deviations from plan: none material. No core changes (energyReport + handState sufficed). Charts hand-rolled canvas (no chart lib), hands overlaid per quantity with a global magnitude/x/y/z selector.
- Decisions made (reversible forks):
  - Energy panel shows the FIRST spatial period under start-of-pattern params (epochs land at future beats and don't move the steady-state figures; folded-to-base changes do) — documented in the panel caption.
  - Charts section unmounts entirely when hidden (zero sampling cost).
- Deferred items: none new.
- Operator visual checks pending (npm run dev -- --host, LAN URL from desktop):
  - [ ] Jerk trace finite everywhere with visible steps at events (quintic path).
  - [ ] Switch carry path to cubic: acceleration chart shows jumps at catch/throw events (and the hold dip disappears in 3D).
  - [ ] Energy panel: net ≈ throw work − catch absorption per row and in totals; average power plausible (e.g. pattern 3 at defaults vs 531 — 531 should cost more).
  - [ ] Pattern 51 or 1: the hand catching the 1s shows the dwell-clamp spike in |v|/|a| (fast hand), amber dwell readout agrees.
  - [ ] Cursor line tracks the playhead across all three charts and matches the bar/ladder position; scrubbing while paused redraws charts correctly.
