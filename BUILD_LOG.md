# BUILD_LOG.md — Orchestrator Ledger

Append-only record of the phased build. Owned by the orchestrator (builders do not
edit this file). See ORCHESTRATOR_PROMPT.md for the protocol.

**Next phase: none — v1 build complete (Phases 0–9 all DONE). Open items: operator visual sweep (checklists under each phase), held-2 design ruling (Phase 2 entry).**

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

## Phase 8 — State graph            DONE
- Date: 2026-07-09
- Commit: e112a8c
- Gate: (2026-07-09, "npm run gate", green — 24 test files / 325 tests, typecheck + lint clean, build ok; run independently by orchestrator after builder AND after fixup)
- Coverage (orchestrator-verified from coverage JSON, lines): stategraph 97.4 %, timeline 97.4 %, kinematics 99.2 %, siteswap 98.1 %, energy 100 %, timing 100 % — bar ≥ 90 %.
- Build incidents (transient, no data loss): builder was killed mid-phase by an API 529 and later the fixup by a session limit; both resumed from their transcripts via SendMessage and completed normally.
- Review (math-heavy phase — fresh Opus reviewer, independent probes incl. N=7 lex-min cross-check): graph construction, BFS shortest+lex-min descent, shortest-cycle, splice phasing, bit-identical past (ballId forward-only anchoring), and glitch-free swap all verified sound. ONE HIGH: transitioning into a pattern with an all-2 hand (3→42, 31→2) rendered b+1 balls forever (synthetic static hold + settled dynamic ball both drawn). FIXED at the reviewer's seam — static holds suppressed for hands receiving a timeline flight (extension-stable: the flights set only grows and steady-state all-2 hands never receive flights); 4 regression tests added (periodic pin, 3→42, 31→2, stability under horizon extension).
- Review LOWs recorded (not fixed):
  - Hold events excluded from bit-identical-past assertions (property true but untested for holds; avoids false negatives on straddling holds).
  - stateAtBits ≡ stateAt pin is structurally tautological; mitigated by the independent landingScheduleAt == stateAt oracle.
  - In-repo lex-min brute force caps at N ≤ 5 (reviewer probe validated N=7).
  - earliestGlitchFreeSpliceBeat can exceed the generated horizon under very long held-2 carries; self-correcting via extension.
- Builder deviations from plan:
  - Typed different-b / beyond-cap patterns hard-reset but carry the clock; the hard-reset BUTTON zeroes it ("restarts clean" read as the button's semantics).
  - Splice beat pushed past carries active at the playhead (~≤ 2 beats at defaults) for the glitch-free guarantee.
  - On-cycle node clicks re-enter the pattern at that phase (BFS shortcut) rather than no-op.
  - ballId ordering convention changed to first-handling-beat ≥ 0 (needed for splice invariance; all prior tests pass unchanged).
- Deferred items:
  - Schedule segment list grows per navigation; valueFromSchedule is linear in segments — compact/binary-search if hundreds of navigations per session ever matter.
  - Transitions FROM all-2 static-hold patterns may pop visually (no delivering flight for the held ball) — folds into the held-2 pending design decision.
  - After a transition INTO an all-2 hand, the hand mesh rests at its throw point while the settled ball rests at the catch point (hand doesn't "ride" the ball as in periodic holds) — cosmetic, fixup-flagged.
  - Marker hidden for a few beats after a beyond-cap hard reset while in-flight balls exceed N (documented in-code).
- Operator visual checks pending (npm run dev -- --host, LAN URL from desktop):
  - [ ] Juggle `3`, click the `51` cycle in the graph: marker walks the transition, status line shows "transitioning to 51 (N beats)", 3D morphs without any ball jumping.
  - [ ] Click a bare (non-cycle) state: app navigates there and holds the shortest cycle through it; pattern input updates.
  - [ ] Type `531` while juggling `3`: smooth transition (same b); type `40` (different b): hard reset with a visible notice.
  - [ ] N stepper: raise to 9+ → warning appears; graph stays readable at N=7 defaults; type a pattern with max throw > 11 (e.g. `c11` invalid… use letters: `b1` at b=6? any max-throw-12+ same-b pattern) → graph unavailable notice, sim still runs.
  - [ ] Hard-reset button restarts the pattern clean at t=0.
  - [ ] Transition 3 → 42: exactly 3 balls after the morph (one settles into a held 2 on one hand).

## Phase 9 — Save/share, audio, library, polish, deploy            DONE
- Date: 2026-07-09
- Commit: 2e8cd4d
- Gate: (2026-07-09, "npm run gate", green — 30 test files / 363 tests, typecheck + lint clean, build ok 1.19 MB / 331 kB gzip; run independently by orchestrator, incl. once more after the orchestrator's one-line EnergyPanel key fixup)
- Note: pre-phase pause waived by explicit user permission.
- Builder deviations from plan:
  - Library: `51` is 3-ball (not a 2-ball shower) — `31` added so the library honestly spans 2–5 balls; labels use "N-ball".
  - Audio default OFF (browser autoplay policy); AudioContext created on the enabling gesture.
  - Camera/canvas handles live in a non-reactive sceneBridge (state layer) so share buttons read them without per-frame re-renders and without state importing render3d.
- Decisions made (reversible forks):
  - URL sync is button-only (Copy share link copies + replaceState once); boot order URL > defaults, read once before first render.
  - Screenshots captured for real via headless Playwright chromium + swiftshader on this arm64 box (docs/*.png) — no operator fallback needed.
  - Orchestrator enabled GitHub Pages (build_type=workflow): https://jugleer.github.io/airtime/
- Deferred items:
  - Single 1.19 MB JS chunk (three.js) — code-splitting if it ever matters; advisory only.
  - Schedule-segment growth per navigation and the held-2 items carry over from Phase 8/2 entries.
- Operator visual checks pending (the shipped app — use the Pages URL once deployed, or npm run dev -- --host):
  - [ ] Copy share link in one browser, open in another: identical scene (pattern, sliders, hand positions, colors, camera).
  - [ ] Presets: save, reload the page, load — settings survive; JSON export/import round-trips; import of a garbage file errors cleanly.
  - [ ] Audio on: throw ticks align with throws at 1× and at 0.3× playback; catch ticks toggle separately; pause/scrub kills pending ticks.
  - [ ] Library dropdown: picking 441 while juggling 3 transitions smoothly; entries show ball counts.
  - [ ] Help overlay opens/closes; PNG capture downloads a correct frame.
  - [ ] Pages deploy: https://jugleer.github.io/airtime/ serves the app with working assets (relative base).

---

# Post-v1 fixes & improvements (owner feedback round 1, 2026-07-10)

Owner reported 6 problems + a UI overhaul request. Each problem diagnosed read-only by a dedicated Opus agent, then implemented sequentially (one writer at a time), gated and committed per fix. Owner overrides recorded here: (a) orbit coloring → per-ball coloring matching the ladder (DESIGN §6 amendment authorized); (b) state-graph layout → concentric excitation rings (presentation only, §5 semantics untouched); (c) target window for the layout overhaul: landscape ≈ 2000×1300.

## Fix 1 — Camera bounds            DONE
- Date: 2026-07-10
- Commit: edd0d40
- Gate: (2026-07-10, "npm run gate", green — 30 files / 369 tests; orchestrator-run)
- Diagnosis: pan moves the OrbitControls target unboundedly (max distance is target-relative), and URL-applied poses skipped clamps. Fix: pure clampCameraView (target box ±2 m, y 0–3; distance 0.4–20), live pan boxed via onChange guard; polar angle untouched (Juggler POV preset looks upward); codec-level clamp deferred (share links sample the already-clamped live camera).

## Fix 2 — Wavy hold path (scoop-and-hold carry)            DONE
- Date: 2026-07-10
- Commit: 84c0011
- Gate: (2026-07-10, "npm run gate", green — 30 files / 376 tests incl. Fix 3; orchestrator-run on the committed tree)
- Diagnosis (dedicated Opus agent, numeric probes): the carry via-point had vy=0 with accel (0,−g,0) — mathematically a local MAXIMUM — so every carry double-dipped (10 mm on pattern 3 up to 631 mm on 522's hold; 75/75 sampled carries wavy). Fix: absorb → exactly-level hold → wind-up (three quintics, absorb time 2·holdDepth/catch speed capped at T/2), endpoint accels/C² preserved. New shape property tests verified to fail pre-fix. Energy identity untouched; W⁺ figures drop honestly (522: −53%). DESIGN §4.3 wording amended (owner-authorized fix).
- Review: adversarial reviewer — SOUND (endpoints, joints, level hold, shape, degenerates, energy identity independently verified; >7000 carries probed). LOW noted: unequal-height carries (unreachable via current geometries, all y=1) would undershoot the dip; old code was worse there. Revisit if the positions editor ever allows y edits with gaps > 2·holdDepth.

## Fix 3 — Pattern instability (arrival-guard ratchet)            DONE
- Date: 2026-07-10
- Commit: a131302
- Gate: same run as Fix 2.
- Diagnosis (dedicated Opus agent): flightArrival aimed air time from the GUARD-STRETCHED period → h×-longer flights → bigger stretch h beats later → exponential runaway to Infinity/NaN on tempo speedups (744→0.15 overflowed ~beat 2400; sim froze). Constant-param core was proven exactly periodic (spread 0.0). Fix: aim air times from the pre-guard slewed period (aimPeriods); guard stretch lands in dwell (≥ 0); slew state advances from the previous AIM period (fixes a limit cycle the naive fix left — 0000a→0.08 stuck at 0.118 — caught by the new property test). Bit-identical whenever the guard is silent.
- Review: adversarial reviewer — SOUND; extension invariance + epoch immutability re-verified on guard-active builds; splice-under-tempo-epoch sane; composition with Fix 2 safe.
- Real-app verification (owner challenged the epoch-dependence): dedicated agent drove the UNFIXED app headlessly, zero interaction, 5 patterns × ~260 sim-s — apex envelope flat to ≤ 0.2 mm, matching closed-form predictions to 0.1 mm; epoch lists pinned at 0; control tempo-drag run detected crisply (2.2 m apex change). Constant-parameter operation positively cleared; observed drift attributed to tempo interaction (ratchet) + the wavy carry visual.

## Fix 3b — Scoop short-segment conditioning            DONE
- Date: 2026-07-10
- Commit: 1be509c
- Gate: (2026-07-10, "npm run gate", green — 31 files / 386 tests; plus 13 consecutive fresh-seed green runs of the kinematics suite)
- A fresh fast-check seed exposed 2e-9 joint-continuity error at holdDepth just above the degenerate cutoff (flaky 1-in-6 gate). Mechanism: internal jerk × the float gap between built duration and evaluation-visible fl(t0+tA)−t0. Structural fix (no tolerance touched): exact evaluation-visible durations for short segments, conditioned Hermite solve, absorb-time floor v·5e-5, 1 ms min hold. Counterexample 2.21e-9 → 4.94e-12; shrunk case pinned as a deterministic regression.

## Fix 4 — Hand gizmo editing UX            DONE
- Date: 2026-07-10
- Commit: 359a56e
- Gate: (2026-07-10, "npm run gate", green — 31 files / 382 tests; orchestrator-run)
- Diagnosis: drag mechanics verified working headlessly; failures were ergonomic (5–7 px hit radius, no affordances, identical markers, occlusion, future-only edits reading as no-ops while paused). Fix: 0.07 m invisible hit spheres (~12–13 px effective), hover scale/brighten + grab cursors, depthTest-off markers, per-hand canvas-sprite labels (deliberately NOT drei Text — troika fetches fonts from a CDN, violating the no-external-requests rule), editor-scoped ghost preview + explanatory note. Future-only semantics unchanged. The user's remembered "selector for which hand" never existed — labels remove the felt need. Below-the-fold discoverability deferred to the UI redesign.

## Fix 5 — Per-ball coloring (owner override of DESIGN §6)            DONE
- Date: 2026-07-10
- Commit: d09c778
- Gate: (2026-07-10, "npm run gate", green — 31 files / 386 tests; orchestrator-run)
- Original report ("orbit colouring does nothing") diagnosed as working-as-designed (pixel-probe proof) with two perception factors: 1-orbit patterns legitimately single-colored, and the palette's first color identical to the default blue. Owner then overrode the design: per-BALL colors matching the ladder. Implemented as a shared resolver (state/ballColors.ts) used identically by ladder/balls/tracers; both views follow the toggle (closes the Phase 4 deferred item); default ON; label "Colour balls individually"; colors stable across extensions/splices (Phase 8 anchoring). Per-orbit machinery deleted. DESIGN §3/§6/§7 amended to record the override.

## Fix 6 — State graph as concentric excitation rings            DONE
- Date: 2026-07-10
- Commit: 353217e
- Gate: (2026-07-10, "npm run gate", green — 31 files / 392 tests; orchestrator-run)
- Owner disliked the neural-net column layout. Research agent surveyed conventional siteswap state diagrams (Lundmark's ground-anchored compact polygons; graphviz-based generators) and prototyped three deterministic candidates on real graphs. Winner: concentric rings — ground centred, one ring per excitation level, circumference-aware radii, barycenter angular ordering (~2× shorter edges / node separation vs a single circle; the 462-node b5N11 case keeps visibly distinct rings, ~30 ms layout). Single-circle chords rejected (hairball ≥ 35 nodes); per-pattern rotation rejected (map would spin on pattern change — bad for the coming overlay). Cycle emphasis is render-level (bowed arcs). DESIGN §5 layout wording amended (owner-authorized; graph semantics untouched). Owner was offered the comparison renders before implementation.
- Presentation deviations (flagged by builder, accepted): fixed 480-unit square viewport with adaptive node radius; wider margin when labels shown; on-cycle self-loop labels flip inward; perf smoke uses process.hrtime (core lint bans performance.* in test files too).

## Redesign — single-window dark UI            DONE
- Date: 2026-07-10
- Commit: 29fee68
- Gate: (2026-07-10, "npm run gate", green — 33 files / 395 tests; orchestrator-run; fit asserted headlessly at 2000×1300 in six panel states, scrollHeight/Width ≤ viewport in all)
- Owner-specified layout (overrides DESIGN §6 *placement* only; view content/behavior specs unchanged): dark default (+light toggle, session-only); left sidebar = pattern/library/tempo-physics/hands-geometry; center = 3D stage with camera presets top-right, State-graph translucent overlay toggled top-left (default off), transport + timeline docked at the stage bottom; right = ladder; bottom = QTM-style collapsible charts/energy dock (default collapsed); Settings drawer = save/share, audio, playback speed, view settings, theme. Jugglebot GUI used as density/style reference.
- Codec: no structural change/version bump; chartsVisible + graphVisible defaults flipped to false; theme deliberately not encoded.
- Deviations (accepted): ladder sits top-aligned in its tall column (a time-horizontal chart can't fill it without distortion — whitespace below is intentional); theme not persisted across reloads (cheap future add).
- Also resolved here: gizmo-diagnosis item E (scene was below the fold — controls and scene are now side-by-side).
- Operator visual checks pending (fresh sweep of the whole round — dev server or the Pages deploy after this push):
  - [ ] Fits your ~2000×1300 window with no scrollbars; dark theme reads well; light toggle works (Settings).
  - [ ] Wavy hold gone: pattern 522 — held ball absorbs, rests LEVEL at the dip, winds up to throw (no mid-hold bounce); pattern 3 carries are single smooth scoops.
  - [ ] Stability: drag tempo hard (e.g. 744 to near-minimum beat period) — pattern rises then settles at the new tempo; no runaway growth, no freeze, dwell visually absorbs the slack.
  - [ ] Camera: pan/zoom can no longer get lost far from the pattern; presets all still frame correctly; shared URLs with odd cameras land sanely.
  - [ ] Gizmos: enable Edit hand positions — markers have hover grow + grab cursor, labels (0C/0T…), easy grabbing, ghosts preview edits even when paused/ghosts-off.
  - [ ] Colors: balls individually colored matching the ladder by default; toggle off in Settings → single color everywhere; picker works.
  - [ ] State graph overlay: button top-left; rings with ground centred; cycle reads as a loop; click-to-navigate works from the overlay; N stepper + hard reset present; overlay off by default.
  - [ ] Charts dock: expands/collapses; charts sample only when open; energy figures show the new lower hold work (522 W⁺ ≈ 11.9 J/kg).
  - [ ] Settings drawer: playback speed, ball radius/color, trails/window/ghosts, share link, presets, JSON, PNG, audio all reachable and functional.

---

# Owner feedback round 2 (2026-07-11)

**Held-2 design decision CLOSED**: owner confirmed 423 at n_h=3 "looks exactly as I'd expect" — the cross-hand carry behavior (Phase 6 endpoint threading + scoop construction) is now the sanctioned design for held 2s at n_h ≠ 2. The Phase 2 PENDING DESIGN DECISION is resolved by owner acceptance; property-test exclusions for 2s at n_h ≠ 2 remain as documented domain notes.

17 items in three parallel fenced tracks (core carry / views / controls), one combined gate, three commits:

## Round 2A — Carry aesthetics (sweep + zip wind-up)            DONE
- Commit: 4c067ed — Gate: (2026-07-11, combined "npm run gate", green — 34 files / 426 tests; orchestrator-run)
- Normal carries no longer park level at the dip (flat 40.8 % → 0.5 % on the cascade; parabola-with-drift sweep, closed-form); zip (1-throw) wind-ups no longer counter-snap (28.5 mm @ 2.27 m/s → 0.0); held 2s bit-identical (level rest kept). Naive T/2 variant rejected with probe evidence. New pins fail pre-change. 10/10 fresh-seed kinematics runs. DESIGN §4.3 amended.

## Round 2B — Views (vertical ladder, timeline fixes, space-pause)            DONE
- Commit: 647bc0f — Gate: same combined run.
- Ladder vertical (time top→bottom — flip is one documented change if owner prefers upward), hand columns labeled; playhead = orange square grip TOP / trail = blue circle grip BOTTOM, coincidence-safe (verified by real pointer drags); lane tags H0/H1 (0-indexed to match ladder+charts — owner wrote "H1, H2", flag if 1-indexed preferred); glyph legend; mini-ladder clipping bug fixed (per-endpoint mark filtering + clipPath; stray marks proven gone by DOM inspection); Space toggles play/pause (input-focus guarded); charts-dock collapse at ≥ ~2340 px viewports root-caused by the views agent (fence-respecting: fix belonged to Charts.tsx) and applied by the orchestrator (energy panel flex basis).
- 
## Round 2C — Controls (draft entry, resets, wheel, library)            DONE
- Commit: fd0eb89 — Gate: same combined run.
- Draft-based pattern entry (Enter/Go apply, Escape revert, dirty cue, external-change sync); per-control ↺ + section Reset-all (defaults single-sourced); wheel-scroll on all sliders; library grown to 35 validated entries grouped 2–7 balls; Settings no longer darkens the app (transparent capture layer, Esc closes); "Try …" hint removed.
- Next: Track C (hands toggle, persistent hand paths, state-graph minimap) then Track D (external-tools review agent).

## Round 2D — Render features (hands, hand paths, minimap)            DONE
- Commit: fab8f14 — Gate: (2026-07-11, "npm run gate", green — 36 files / 446 tests; orchestrator-run)
- showHands (default ON): translucent hemisphere cups following handState, ball nests in the bowl. showHandPaths (default OFF): per-hand closed period loops, resampled only on rebuild/epoch, pastel hues distinct from ball palette. State graph: always-visible 200 px ring minimap top-left (marker re-renders on beat hops only), expand to the full interactive overlay; graphMinimap toggle. Codec keys sh/hp/gm (round-trip property extended). Zero core changes.

## Round 2E — Fresh-eyes review (field survey + wins)            DONE
- Commit: 9146686 — Gate: (2026-07-11, "npm run gate", green — 37 files / 450 tests; orchestrator-run)
- Review agent surveyed Juggling Lab, Gunswap, siteswap.org/JoePass and drove the whole app headlessly: NO real bugs found. Verdict: Airtime's live-physics + state-graph + kinematics/energy combination is unique among peers; gaps are notation breadth (sync/multiplex/passing), prop variety, and pattern discovery.
- Implemented wins: Help closes on Escape + a Keyboard & mouse help section; amber unsupported-notation hint for sync/multiplex/passing characters in the pattern box.
- RAISED FOR OWNER (ranked, sketches in the review agent's report): 1) siteswap generator/explorer (core machinery already exists), 2) sync & multiplex notation (the big deferred gap), 3) GIF/WebM export (determinism makes it exact), 4) time-bookmark URLs (&t=, near-trivial, needs seconds-vs-beats decision), 5) accessibility focus pass (:focus-visible rings + dialog focus traps), 6) prop types (rings cheap, clubs need a spin model), 7) difficulty metric readout, 8) bounce throws / causal diagram. Minor: library select doesn't reflect the current pattern; sub-1100 px layout cramping (desktop tool, low priority).
- Operator visual checks pending (round 2, one sweep — dev server or Pages):
  - [ ] Hand cups track carries/holds; toggle in Settings; hand paths draw closed loops when enabled.
  - [ ] Normal carries sweep (no flat bottom); 531's zip wind-up has no backward snap; 522 hold still rests level.
  - [ ] Vertical ladder reads well (time top→bottom; flip to upward is one change if preferred); H0/H1 labels consistent across ladder/timeline/charts (0-indexed — say if you want 1-indexed).
  - [ ] Timeline: orange square playhead grip (top) / blue circle trail grip (bottom) both grabbable when coincident; lane tags + glyph legend; no marks outside the track.
  - [ ] Pattern box: typing doesn't disturb the sim; Enter/Go applies; Esc reverts; sync-notation hint on (4,4).
  - [ ] Space pauses/resumes (not while typing); wheel nudges sliders; per-control ↺ and section Reset-all work.
  - [ ] Library grouped by ball count; Settings drawer doesn't darken the app; minimap always on (toggleable), expands to full graph.
  - [ ] Charts dock no longer collapses at very wide windows (was ≥ ~2340 px).

## Round 3 — Owner feedback (2026-07-11): plan
Owner delivered ~20 items + ruled on the round-2 proposals: build #1 siteswap
explorer (bottom dock: none | charts | explorer), #2 sync & multiplex (YES),
#3 GIF/WebM export (design answered: one-period seamless loop, current camera,
offscreen deterministic frames, in-browser encode), #4 &t= bookmarks, #5 a11y
pass (easy wins only); #6–8 declined for now. New major feature: per-hand
workspace volumes (popup 3D editor, sphere/cube/pyramid/STL, xyz scale) —
orchestrator ruling: ADVISORY-first (violations highlighted; constraint solving
raised separately). Display convention ruled Z-UP user-facing (right-handed;
display X = sim x, Y = −sim z, Z = sim y); core stays y-up per CLAUDE.md with
one mapping module at the presentation boundary. Waves: 1 = UI/state/graph
(4 fenced builders) + diagnosis workflow (3 clusters, diagnose→skeptic-verify);
2a = core carry/return fixes + render trail/tilt + review fixups; 2b =
workspace editor + explorer; 3 = sync/multiplex, GIF export, a11y, final audit.

## Round 3 wave 1 — layout, charts, frame, state graph            DONE
- Commit: f73732e — Gate: (2026-07-11, "npm run gate", green — 38 files / 493 tests; orchestrator-run)
- Track α charts/energy: Net column removed (probe: per-hand net is NONZERO in
  asymmetric multi-hand patterns, e.g. 531@3h = ±9.58 J/kg summing to 0 — total
  row is ~0; caption rewritten, one-line revert if owner wants it back); compact
  table; exact 60/40 flex split stable at all widths; legend click-toggles per
  hand (hollow swatch + faded when off); legend hover → cup emissive highlight
  (store hoveredHandIndex); jerk jitter root-caused as playhead-anchored chart
  sampling → absolute-time-grid (scroll translates, never resamples history);
  chart heights follow the dock splitter (ResizeObserver; found+removed a
  flexWrap ratchet that let canvases grow but never shrink).
- Track β layout: Settings drawer deleted; VIEW under HANDS & GEOMETRY (theme
  incl.); Save/Share/Audio beneath ladder; wheel ×3; panels.tsx splitters
  (sidebar/ladder widths, dock height) + collapse strips, localStorage-persisted
  (deliberately NOT store/codec), stage floor 380 px; z-up label pass.
- Track γ state/codec/scene: defaults ghosts OFF + trail 0.15 s; displayFrame.ts
  (handedness pinned by cross-product test); camera-tracking triad bottom-right
  (canvas sprites, no CDN fonts); line preset grows outward alternating ± and
  setHandCount preserves existing hands (decrement drops most-recent; 1↔2 is the
  documented non-preserving exception — reviewer finding on it REFUTED as the
  deliberate trade-off); grey global gizmo node 0G (rigid C+T translate,
  setHandAnchor future-only epoch); &t= bookmark (3 dp, arrives playing,
  round-trip property extended). Presets now carry time (flagged, harmless).
- Track δ state graph: click-a-node-on-the-current-cycle was a silent no-op
  (kept running pattern, re-entered at that node's phase → identical future);
  now every click bridges (lex-min reverse-BFS) and settles into the clicked
  node's shortest cycle; idempotent splice proven past-bit-identical. Flag:
  clicking a node whose shortest cycle is a rotation of the current pattern
  rewrites the pattern box to that rotation (e.g. 441 → 144) — required for
  phase alignment. Minimap arrow → "click to expand".
- Orchestrator fixup: hand-position editor Y column negates on read+write
  (display Y = −sim z), settled with γ's displayFrame; 20/20 Controls tests.
- Review workflow (5 dimensions, findings skeptic-verified): 5 confirmed + lows
  → fixup agent (wave 2a): stale Settings refs incl. user-facing Help Esc line,
  circle-preset global-node hit-sphere overlap, translatedPair orphan/dup,
  wheel Help wording, hover-unmount cleanup, STAGE_MIN literal, dock aria
  clamp, displayFrame comment, dead windowSampleTime, missing Y-negation and
  t-seek tests. DESIGN §4.5 amended (Net row note, owner-authorized).
- Diagnosis workflow (skeptic-verified): (1) trail flicker = playhead-anchored
  sample comb vs short carries (measured 5.2 cm frame-rate flicker) → absolute
  grid + segment-boundary samples; (2) held-2 "hold" is a literal level line at
  chord velocity → rest-at-dip; skeptic REFUTED the naive rest fix (1.5e-8 acc
  breach at hd 0.02/g 30, conditioning can't help — velocity-boundary-driven)
  → flank floor or smooth-V fallback in that corner; overlay mismatch = 20/beat
  chord error (6 mm) → 80/beat (0.4 mm); (3) hand-follows-ball: buildReturn's
  single quintic pinned to ball endpoint conditions DEGENERATES to the flight
  parabola for self-throws (unique quintic through 6 matching conditions;
  separation measured 0.000000) and lunges on zips (1155: 0.82 m excursion) →
  returns routed through the dip-based carry construction (400-case
  differential C² sweep in budget; excursion → 0.37 m). First diagnosis agent
  died emitting structured output; salvage agent mined its 510 KB transcript
  and re-verified rather than re-investigating.

## Round 3 wave 2a — core carry/return fixes, trail, tilt, fixups            DONE
- Commit: 34aa05b — Gate: (2026-07-11, "npm run gate", green — 38 files / 521 tests; orchestrator-run)
- Returns: buildReturn now routes through the dip-based carry construction
  (held:false CarrySpec; holdDepth threaded per-epoch). Root cause was exact:
  the old single quintic through six ball-derived endpoint states IS the flight
  parabola for self-throws (unique interpolant), so 045's "4" hand and every
  3-hand-cascade hand traced the ball to apex; zips lunged (1155 hand-0
  excursion 0.79 m). After: apex 1.02 vs ball 1.60; excursion 0.33 m. Builder
  found a NEW breach beyond the diagnosis (returns inherit huge ball velocities
  → scoop flank collapses; 1.56e-9 at nh=4 value-14) and added a return-only
  flank floor (CarrySpec.minFlankTime): 5.1e-10.
- Held 2s: true static rest at the dip (v/a/jerk exactly 0, 85–93% of the
  carry; horizontal repositioning in the curved flanks). Spec's flank-floor
  mitigation was implemented, MEASURED to overshoot (0.032 m at hd 0.02/g 30),
  and replaced with the rest-gate + scoop-through fallback (4000 m/s² flank
  accel cap). Normal carries can no longer emit a level hold. Continuity swept:
  numRuns=800 ×4 reseeds + 10k adversarial cases (worst acc 9.47e-10 is a
  PRE-EXISTING scoop corner, unchanged — noted, deliberately not touched).
- Render: trail/ghost sampling boundary-anchored (absolute grid + exact segment
  boundaries; grid dropped before boundaries under cap pressure) — low-dwell
  flicker gone, dip depth playhead-invariant. Hand-path overlay 20→80/beat.
  NEW hand tilt: cup normal −v̂ at catch / +v̂ at throw, smoothstep slerp
  keyframes (C¹), upright mid-return, zero per-frame alloc.
- Wave-1 review fixups all landed (Help copy, gizmo global node lowered 0.14 m
  with hit-sphere disjointness test, translatedPair orphan removed, comment
  sweep, hover unmount cleanup, STAGE_MIN, aria clamp, dead windowSampleTime,
  Y-negation + t-seek tests). Wave-2a review: ZERO confirmed findings; lows
  fixed pre-commit (test comment, ghost buffer bound, DESIGN §7 net residue).
  DESIGN §4.3 amended (returns + held-rest wording).
- Deferred: pre-existing 9.47e-10 continuity margin at the near-MIN_ABSORB
  scoop corner (~5% under budget); cup drop is world −y (not tilt-aware);
  hand-path overlay sits at handState.y, ~35 mm above the cup mesh (owner call).

## Round 3 wave 2b — hand workspace volumes + siteswap explorer            DONE
- Commit: 7c2969c — Gate: (2026-07-11, "npm run gate", green — 42 files / 584 tests; orchestrator-run)
- Workspace (ADVISORY): pure src/workspace module (primitive containment
  closed-form; STL binary+ascii with watertight check → honest bbox fallback;
  ray-parity; violation fraction + seam-merged spans); WorkspaceOverlay
  (volumes at hand anchors, red violating spans, % badges; once per
  (sim, config)); WorkspacePanel popup (r3f preview, shape/scale/STL/reset)
  from HANDS & GEOMETRY. Primitives in codec (ws*); STL session-only.
- Explorer: enumerateSiteswaps in core/stategraph (closed graph cycles,
  reverse-BFS pruning, canonical lex-greatest rotation, fundamental period,
  no-0s/no-2s/prime filters, capped 500 + truncated flag). Review brute-force
  diffed it against the validator: EXACT agreement across all probed domains.
  ≤16 ms worst on the Jetson → live useMemo generation. Bottom dock tri-state
  None | Charts & energy | Explorer (dm key; legacy cv healed at decode).
- Wave-2b review: workspace + explorer dimensions CLEAN (tetra re-derived;
  rendered-inside ⇒ tests-inside verified numerically). One real integration
  bug confirmed & fixed pre-commit: cv-only legacy links opened with charts
  hidden (boot merge made the downstream fallback unreachable) → dockMode now
  derived at decode and dm always emitted (idempotence property held). DESIGN
  §6 amended (dock tri-state, explorer, workspace).
- Deferred/owner calls: non-watertight STL draws the open mesh but tests its
  bbox (disclosed in-panel; wave-3 polish adds a bbox wireframe); Charts'
  internal collapsed slim-tab branch now unreachable in-app (comment updated;
  removal is optional cleanup); explorer query params not in the URL;
  workspace is one shared spec (per-hand overrides future); presets carry time.

## Round 3 wave 3a — sync & multiplex; GIF/WebM export            DONE
- Commit: 4eccfc6 — Gate: (2026-07-11, "npm run gate", green — 51 files / 662 tests; orchestrator-run)
- Sync (l,r)/x/*, multiplex [..], combined; vanilla path bit-identical (extended
  input routes to a separate compiled pipeline); union-find ball identity proven
  stable under horizon extension; sync 2x is a real crossing flight (NOTATION
  identity 1 exception). Clean-restart in/out of extended notation; sync forces
  AND locks n_h=2; honest vanilla-only state-graph placeholder; 7 library
  classics; stacked ladder/timeline marks. Continuity + work-energy properties
  swept over the new pattern space.
- Export: frame-exact offline capture (half-open schedule = seamless loop),
  frozen camera or one-orbit turntable, full state restore incl. cancel, GIF
  via bundled gifenc (centisecond-accumulated delays), WebM via WebCodecs
  where present; refuses mid-slew export with a friendly error.
- Review (3 dimensions + skeptics): feared multiplex offset discontinuity
  REFUTED (offset applied to all of a ball's segments); CONFIRMED + fixed
  pre-commit: multiplex held-2 hand-path freeze (occupancy now tiled), sync
  hand-count stepper not locked, async 'x' silently ignored (now rejects —
  crossing is sync-only in v1, owner may prefer honoring it later), GIF
  centisecond tempo drift, mid-slew export, Help drift, Export button naming.
- NOTATION.md amended (owner-authorized): sync/multiplex glossary + identities,
  z-up display-frame convention. DESIGN §1/§6 amended.

## Round 3 wave 3b — a11y pass, polish, final audit            DONE
- Commit: (this commit) — Gate: orchestrator-run, see commit message.
- A11y easy wins: shared theme-aware :focus-visible ring; dialog focus-on-open/
  restore-on-close (Help/Export/Workspace via useModalFocus); splitter keyboard
  focus visibility; tab-order smoke test. RAISED for owner (not built):
  keyboard gizmo nudging, timeline keyboard scrubbing, state-graph node tabbing
  (roving tabindex), full modal focus traps, 3D-scene narration, textMuted
  contrast retune (each with cost/impact in the wave-3b agent report).
- Non-watertight STL now draws the tested bounding box (muted wireframe) in
  overlay + preview; Charts dead collapsed branch removed (dock switch is the
  single visibility path).
- Final audit (3 auditors): e2e drive of the DEPLOYED site — all three owner
  repro URLs verified fixed on-screen, held-2 v=0 bathtubs in the charts,
  sync/multiplex/explorer/workspace/export/panels/&t=/theme all pass, ZERO
  console errors across 7 sessions; owner-item completeness — 25/25 done (4
  deliberate deviations surfaced below); code health — "unusually clean", 7
  minor items (all fixed in this commit: explorer dock-crush at 500 results,
  THREE.Clock deprecation, gcd/clamp/Vec3Tuple dedup, PAST_SPAN dead export,
  multiplexCupOffset test, export-path code split).
- Deviations for owner sign-off: (1) STL meshes are session-only (URL encodes
  disabled); (2) workspace is ONE shared spec instantiated per hand (per-hand
  overrides deferred); (3) "pyramid" = regular tetrahedron (square-base is a
  small change if preferred); (4) sync/multiplex is sim/ladder/timeline-only —
  state graph, explorer, and live splicing stay vanilla (clean restart at the
  boundary); (5) async multiplex 'x' rejects rather than crossing (sync-only).

## Round 3 — operator visual checklist (one sweep, live site)
- [ ] 045 and 3-with-3-hands: hands dip low while balls arc — no ball-shadowing.
- [ ] 1155 URL (owner repro): no lunges; hands stay near their own columns.
- [ ] 441 URL (owner repro): hand-path overlay hugs the actual cup motion.
- [ ] 522/423: hand stops DEAD at the dip bottom (no slide); charts show v=0 flats.
- [ ] Very low dwell (0.02): trails smooth, no flicker/splitting.
- [ ] Cups tilt into catches and throws; upright between.
- [ ] Left sidebar: VIEW below HANDS & GEOMETRY; Save/Share/Audio under ladder;
      no Settings button; panel splitters drag; collapse strips; layout survives
      reload.
- [ ] Charts: no Net column; 60/40 split; legend click = hollow square + faded;
      legend hover lights the cup; jerk plot stable while playing.
- [ ] Wheel on sliders ~3x faster; every control has ↺ when off-default.
- [ ] Triad bottom-right: Z up, X along hands, Y front-back; hand editor Y
      matches scene direction (type +Y, ball moves toward triad +Y).
- [ ] Add hands 2→5 on line preset: new hands appear outside, alternating.
- [ ] Edit-hands mode: grey nG node below each pair drags catch+throw together.
- [ ] State graph: click a node ON the current cycle → it becomes the goal
      (note: pattern box may rewrite to a rotation, e.g. 441→144).
- [ ] Minimap says "click to expand".
- [ ] Explorer: tri-state dock; big domain (period 9, throw 12) scrolls
      internally without crushing the 3D stage; chip click transitions live.
- [ ] Workspace: enable, shrink → red spans + H badges; STL upload; pyramid =
      tetrahedron (flag if you want square-base).
- [ ] Sync/multiplex: (4,4), (6x,4)*, [33]33, 24[54] — juggle plausibly; sync
      locks hands at 2; graph shows honest placeholder; entering/leaving = clean
      restart.
- [ ] Export GIF: 1 loop loops seamlessly; turntable orbits once; cancel
      restores; on a desktop Chrome, WebM option appears.
- [ ] &t= in a shared URL seeks; keyboard: tab ring visible, Esc closes dialogs.

## Round 4 — owner feedback on round 3 (2026-07-11)            DONE
- Commit: (this commit) — Gate: (2026-07-11, "npm run gate", green — 55 files / 701 tests; orchestrator-run)
- WAIT-HIGH RETURNS (owner's top item; supersedes round-3 wait-low): empty hand
  decelerates from release to a ready point AT the line (readyY = line, worst
  measured dip below line 6.4e-6 m), true static rest when timing allows
  (531@nh3 84%, 441 50%, 3-cascade 9%), flanks-meet slowdown on tight zips;
  ready column = wind-up runway clamped to the throw–catch chord (unclamped
  blew 1.2 m excursions). Endpoints unchanged → seams C², no-ball-tracing pins
  kept. Swept 4800 elevated property runs + 8640 adversarial cases (worst acc
  7.1e-10). Wait-low test expectations updated (owner-directed). Review: ZERO
  confirmed findings; two doc-accuracy lows fixed (rise-bound wording, stale
  minFlankTime comment). Flag: rise scales ~0.4·holdDepth in the descent-
  dominated regime (floor-limited < ~6 cm absolute otherwise).
- Charts: energy table at natural width pinned right (caption width-
  neutralized so it wraps to the table), charts absorb ALL remaining dock
  width; verified 500–2400 px; neither historic collapse mode can recur.
- Wheel: WHEEL_STEP 3 → 10 (src/ui/widgets.tsx — the owner's tuning knob;
  1% of range per notch). Help copy updated.
- Trail max 8 s → 2 s; old links clamp at decode (drift-guard test pins the
  codec's store-free mirror to TRAIL_LENGTH_MAX); buffers re-pinned.
- State graph: muted directional arrowheads on background edges (suppressed
  when nodeRadius < 3.5 — density proxy; minimap never draws them).
- Hand-path persistence BUG: overlay sampled the timeline START, but splices
  keep the past bit-identical → it redrew the pre-splice pattern (proven:
  3→531 splice drew the 3-loop, length 1.898 vs 2.134). Now anchors at the
  horizon END (always current steady state); WorkspaceOverlay inherits via the
  shared helper; dead epoch plumbing removed.
- Gizmo "reset markers" report: DISPROVEN as a marker bug (markers derive from
  the store; verified all three marker kinds follow resets). Real cause:
  transport ↺ Restart only seeked to t=0, which PREDATES future-only geometry
  epochs — balls replayed pre-edit geometry under post-edit markers. Owner
  ruling: Restart now REBUILDS from current committed settings at t=0 (shares
  the clean-restart path with graph hardReset; playing state preserved; view/
  panel/theme untouched) + new "↺ Reset positions" button in HANDS & GEOMETRY
  (re-samples the preset as a future-only epoch; hidden when already default).
- Round-4 operator checks: 531/441 hand waits HIGH near the catch column with
  a visible pause, then drops into the catch (no dip between throws); charts
  fill the dock with the work table compact at the right; wheel-scroll feels
  fast (tune WHEEL_STEP in src/ui/widgets.tsx); trail slider tops out at 2 s;
  graph background edges show direction; change patterns with hand paths on —
  no stale loops; drag markers then ↺ Restart — balls fly from the markers;
  "Reset positions" appears only after dragging and snaps C/T/G markers back.

## Round 5 — the oval return (empty-hand bounce)            DONE
- Commit: (this commit) — Gate: (2026-07-12, "npm run gate", green — 55 files / 711 tests; orchestrator-run)
- Owner: hands "bounce" — empty hand should trace the juggler's oval (up to
  quash the throw, slow, then down into the catch); observed: down-to-line,
  sit, up, down. Diagnosis (two independent Opus designers + adversarial
  judge; first judge died emitting output, salvaged via transcript): bounce
  CONFIRMED structural — round-4 pinned the rest at line height, so BOTH
  flanks must hump above the line (turns=3 per return; 3.8 cm terminal
  up-down; ~19 ms sit). Designer A (physics-first) won: rest at the
  deceleration APEX with targetRise = min(holdDepth, v²/2g) capping the flank
  at the ballistic quash time, and apexRise = ½·v·flank derived from the
  FINAL post-floor flank (floors raise the apex instead of overshooting).
  Judge broke Designer B at 51/nh5/hd0.02/g0.5 (turns=5; 6,138 of 25,200
  sweep returns bounced) and proved the naive synthesis also bounces — the
  flank-time cap is the load-bearing element. A: ZERO bounces over the
  25,200-return sweep; continuity identical-or-better (worst acc 7.7e-10,
  at a pre-existing carry corner).
- Implementation: exactly 4 line-level edits to buildReturn (diff==spec
  verified byte-level by an independent reviewer; SHIP on all checks).
  New pins: single-lobe grid (turns==1) over patterns×holdDepth×gravity×nh
  incl. the break-B corner; 3-cascade apex == line + holdDepth with genuine
  static rest at the crown; 522/g30 asserts apex deliberately EXCEEDS
  holdDepth (do not re-clamp — reintroduces the bounce). Old-code
  discrimination shown (old turns=3, new turns=1). Elevated sweep 600×5
  reseeds green. DESIGN §4.3 re-amended (oval; supersedes round-4 rest).
- Deferred/flagged: (1) crown amplitude = full holdDepth (symmetric oval);
  a k·holdDepth fraction is the knob if the owner wants a flatter top lobe.
  (2) Asymmetric throwY≠catchY geometry unexercised (no such UI path today);
  per-endpoint apex would restore exactness if hand-height editing lands.
  (3) Operator check: 3/441/5 — the crown should read as one smooth
  up-pause-down arch; no valley between throw and catch.

## Round 6 — state-graph layout + draw layer            DONE
- Commit: (this commit) — Gate: (2026-07-12, "npm run gate", green — 55 files / 723 tests; orchestrator-run)
- Owner: background arrowheads too small; layouts unreliable ((7,8) renders as
  a line); wants the symmetric look of classic hand-drawn diagrams; throw-value
  labels on arrows (revised: DEFAULT ON); precompute optional. Design phase:
  layout prototyper (4 algorithms × 6 graphs, real SVGs + metrics) + dedicated
  UI/graphics designer (13 mockups + a 10-point audit of the current renderer:
  base arrows fail on size AND dimness AND rim occlusion AND a backwards
  visibility gate; base self-loops never drawn at all). Candidates published to
  the owner as a visual artifact page; owner picked: everything, labels ON,
  minimap arrows, symmetry above all, no precompute needed.
- CORE: layoutStateGraph is a two-regime dispatcher — SYMMETRIC STRESS
  MAJORIZATION (SMACOF, live + memoized, pure/deterministic) for ≤150 nodes,
  concentric rings beyond. Key finding: these graphs have TRIVIAL automorphism
  groups ((3,5) brute-forced — no symmetry to converge to), so symmetry is
  HELD, not seeded: exact per-iteration mirror-folding onto a level pairing +
  LEVEL_BIAS=0.2 (levels read as a cascade, ground at the apex; also 3.6×
  faster convergence) + degenerate-line fallback (free SMACOF wheel + best-axis
  snap — (7,8) becomes a zero-crossing wheel). Mirror error 0.0000 across the
  entire stress range — identical to the owner's hand-made reference; raw
  SMACOF measures 0.35. Byte-identical determinism over all 60 (b,N) pairs;
  126-node worst ~215 ms on the Jetson, once per graph.
- UI: draw layer rewritten to the designer's spec — absolute-size barbed
  arrowheads landing at node rims (count-gated ≤42, replacing the backwards
  nodeRadius gate), lifted edge contrast, bidirectional pairs as opposite arcs,
  teardrop self-loops WITH heads for all loops, throw-number halo chips
  (default ON, codec key gt, cycle-priority cell collision, >42 nodes
  cycle-only), cycle glow + rim, ground home-ring, marker size floor + glow,
  hover ring, scaled labels; minimap = rim arrows / no labels / no glow;
  theme-aware with flagged light-theme hexes.
- Combined review (4 checks): SHIP — codec default-ON boot path verified
  correct (the cv-bug lesson applied), live end-to-end clean in both themes,
  navigation works, perf memoized. Two stale-text lows fixed pre-commit
  (overlay caption now regime-aware; file header).
- Trade-off (documented): the running cycle is less spatially compact under
  stress than under rings (symmetry-over-locality, owner's priority); cycle
  stays findable via glow/highlight. 531 cycle-locality test re-baselined
  0.25→0.5 with measurement (~0.32) — documented, not a green-hack.
