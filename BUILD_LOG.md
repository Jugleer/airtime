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
