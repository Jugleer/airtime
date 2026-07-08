# PLAN.md — Phased Implementation Plan

Ten phases, each sized for **one fresh Opus 4.8 builder session**, each ending with
`npm run gate` green and a commit. Read `DESIGN.md` and `NOTATION.md` first; section
references below (§) point into DESIGN.md. The orchestration protocol (who runs
these, gates, pauses, logging) lives in `ORCHESTRATOR_PROMPT.md`.

Ordering rationale: the pure core (P1–P2) carries most of the correctness risk and
all of the property-test value, so it lands first; the ladder diagram (P3) is the
engine's debug view and lands **before** the 3D scene so timing bugs are caught in
2D where they're visible; everything after that is view/UX layering over a stable,
deterministic core.

---

## Phase 0 — Scaffold

**Goal**: a running empty app with the full toolchain and the canonical gate.

- Vite + React + TypeScript **strict**; ESLint + Prettier; vitest + fast-check;
  zustand, three, @react-three/fiber, @react-three/drei installed.
- Directory skeleton per §2 module map, with placeholder modules and one trivial
  test per layer so the gate exercises everything.
- ESLint rule enforcing the core boundary: `src/core/**` may not import from
  `react`, `three`, `zustand`, `src/ui`, `src/render3d`, `src/state`, and may not
  reference `Date.now`, `Math.random`, `performance` (lint-banned identifiers).
- `npm run gate` = `typecheck && lint && test:run && build` — define it here, keep
  it stable forever.
- Attempt `npx playwright install chromium` once. If the platform (arm64 Ubuntu
  20.04) refuses: remove Playwright, note it in BUILD_LOG.md, and visual phases
  fall back to operator checks (§8).
- `.github/workflows/ci.yml` running the gate (harmless until a remote exists).

**Accept**: `npm run gate` green; `npm run dev -- --host` serves a placeholder page.

## Phase 1 — Core: siteswap, timing, event timeline

**Goal**: the deterministic heart (§2, §3, §4.1, §4.6) — no rendering.

- `core/siteswap`: parse (`0–9a–z`), validate with beat-accurate errors (§3),
  orbits, spatial period, `b = mean(h)`.
- `core/timing`: beat schedule with epochs; `t_d_eff` clamping (NOTATION identity 4);
  slew-limited `τ_b` with the in-flight arrival guard (§4.6).
- `core/timeline`: append-only event timeline; lookahead scheduler; throw/catch/
  hold/idle events for patterns incl. `40`, `501`, `522`, `423`, `60`; parameter
  epochs affect future events only.
- Property tests (fast-check): random valid patterns validate and round-trip;
  random invalid patterns rejected with the colliding beats named; per hand ≤1 ball
  held at all times; every catch precedes its throw; landing schedule at every beat
  matches the state-vector semantics; epoch immutability (events before an epoch
  are bit-identical after any parameter change).

**Accept**: gate green; ≥ 90% line coverage on `core/siteswap` + `core/timing` +
`core/timeline` (coverage is meaningful here, not theater).

## Phase 2 — Core: kinematics & energy

**Goal**: closed-form motion + energy (§4.2–§4.5).

- Parabola solver (endpoints + `t_air`); `ballState(ball, t)` piecewise evaluation.
- `CarryPath` interface; quintic Hermite with endpoint acceleration `(0,−g,0)` and
  `holdDepth` via-point (two segments, C² stitch); cubic Bézier alternative; return
  paths; idle; multi-beat held carries. `handState(hand, t)` for all `t`.
- Analytic derivatives through jerk — no numeric differentiation.
- `core/energy`: ∫F·v with exact polynomial integration; W⁺/W⁻ split; per-hand
  per-period aggregation.
- Property tests: position continuous everywhere; velocity continuous at events;
  acceleration continuous at events (quintic) and flight accel ≡ (0,−g,0);
  carry-endpoint contact force ≈ 0; **net work = ΔKE + gΔy** to 1e-9 (work–energy
  cross-check); cubic path exhibits the acceleration jump (regression-pins the
  reason quintic is default).

**Accept**: gate green; same coverage bar on `core/kinematics` + `core/energy`.

## Phase 3 — Ladder diagram + minimal shell (first visual)

**Goal**: see the engine (§6 ladder). This is the debug view — build it before 3D.

- App shell: pattern input with live validation + error display, play/pause,
  τ_b + t_d + playback-speed sliders wired through zustand to the core.
- Ladder view: canvas/SVG, time horizontal, lane per hand, event dots, flight arcs,
  carry segments; shared `simTime` cursor.
- Visual sanity patterns: `3`, `531`, `40`, `522`.

**Accept**: gate green; operator check: ladder for `531` shows the 5-arc spanning 5
beats, the 1-arc barely clearing one beat with visibly shortened dwell (t_d_eff).

## Phase 4 — 3D scene

**Goal**: the main view (§6 3D). Balls fly.

- r3f scene, OrbitControls + camera presets, ground grid, lighting; balls from
  `ballState(simTime)`; single-color default + orbit-coloring toggle; ball radius
  setting. 60 fps target on a desktop browser over LAN (`--host`).

**Accept**: gate green; operator check: cascade `3` looks like a cascade; `441`
and `531` look right; camera navigable; no stutter at defaults.

## Phase 5 — Timeline bar, tracers, ghosts

**Goal**: §6 timeline bar, complete.

- Fixed-window bar (default 3 s, configurable), mini-ladder tick background,
  playhead scrub (drag = set `simTime`, works paused or playing), detachable
  trail handle (pins at left edge with readout when trail > window), 3D trails
  as polylines of `position(t)`, dashed future ghosts, period readout.

**Accept**: gate green; operator check: scrub while paused moves balls smoothly;
trails match flight paths exactly; ghosts extend them forward.

## Phase 6 — Runtime parameters & hand geometry

**Goal**: live manipulation (§4.6, §6 settings).

- Slew-limited tempo slider (watch balls rise as τ_b grows — no teleports, guard
  active); gravity slider; playback speed vs tempo clearly distinct in the UI.
- `n_h` stepper (1–8) with line/circle presets; per-hand draggable catch/throw
  gizmos in the 3D view + numeric editor; edits affect future throws only.
- `holdDepth` slider; `CarryPath` toggle (quintic/cubic).

**Accept**: gate green; operator check: dragging tempo slowly from 0.25→0.5 s
visibly slows and heightens the cascade with no discontinuity; moving a catch
point mid-flight affects only later throws; `n_h=3` circle preset juggles `3`
correctly (period changes hands).

## Phase 7 — Charts & energy panel

**Goal**: §6 charts + energy.

- Per-hand |v|/|a|/|j| canvas charts, per-axis toggle, x-axis = timeline window,
  shared `simTime` cursor; visible dwell-clamp effects (fast hands on 1s).
- Energy panel per §4.5 with totals; values stable across a period (property test
  at core level already guarantees the integrals; panel test checks aggregation).

**Accept**: gate green; operator check: jerk trace is finite everywhere with steps
at events (quintic); switching to cubic path shows the acceleration discontinuity;
energy net ≈ W⁺ − |W⁻| in the panel.

## Phase 8 — State graph

**Goal**: §5 complete.

- Graph generation per (b, N); excitation-level layout; current-state marker
  hopping each beat; pattern-cycle highlight; click node → BFS navigate (hold
  shortest cycle on bare states); typed pattern entry routes through the same
  navigate machinery; hard-reset button; auto-expand N (cap 11, warn ≥ 9).
- Transition status UI ("transitioning to 531 (2 beats)").
- Property tests: every valid pattern's cycle exists in its graph; BFS transition
  sequences are themselves valid throw sequences landing on the target cycle;
  tie-break determinism.

**Accept**: gate green; operator check: juggle `3`, click the `51` cycle, watch the
marker walk a transition and the 3D pattern morph without a glitch.

## Phase 9 — Save/share, audio, library, polish, deploy

**Goal**: §6 save/share + audio + library; ship it.

- Versioned URL codec (round-trip property test: encode→decode = identity);
  localStorage presets + JSON export/import; PNG capture.
- WebAudio synthesized ticks (throw/catch, volume, toggle).
- Pattern library (≥ 12 curated, named: 3, 441, 531, 51, 423, 552, 633, 744,
  97531, 4, 53, 7131…); help overlay explaining siteswap + controls.
- README with screenshots; GitHub Pages deploy workflow (activates when a remote
  exists); performance pass (no per-frame allocations in the render loop hot path).

**Accept**: gate green; operator check: copy URL in one browser, open in another,
identical scene; presets survive reload; audio ticks align with throws.

---

## Cross-phase rules

- Never weaken a property test to make a phase pass — that is always a stop-and-
  surface event (see ORCHESTRATOR_PROMPT.md failure policy).
- Each phase may refactor earlier code freely **as long as the gate stays green**
  and `core/` purity holds.
- Anything discovered-but-deferred goes in BUILD_LOG.md under the phase's entry,
  not in code comments.
- Update README.md status as phases land (one line; keep honest).
