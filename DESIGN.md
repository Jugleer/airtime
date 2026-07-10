# DESIGN.md — Airtime

**Airtime** is an interactive 3D siteswap visualizer and juggling kinematics lab:
a browser app that animates siteswap patterns with physically honest timing, lets you
manipulate the pattern live (tempo, dwell, gravity, hand positions, hand count),
navigates the siteswap **state graph** with click-to-transition, and exposes the
implied hand kinematics (velocity / acceleration / jerk charts, per-hand energy).

Think Juggling Lab's correctness with a modern interface, plus runtime manipulation
and state-graph navigation that no existing tool combines.

Read `NOTATION.md` first — every symbol below (`b`, `h`, `n_h`, `τ_b`, `t_d`, `t_air`,
`t_d_eff`, `β`, epoch, carry, return, state, orbit) is defined there and is normative.

---

## 1. Product scope

### v1 (this build)

- Vanilla **async** siteswap only: one throw per beat, hands in cyclic order.
  Digits `0–9`, letters `a–z` (= 10–35). `0` = empty hand, `2` = held ball.
- Live-validated pattern entry with beat-accurate error messages.
- 3D scene (navigable orbit camera) rendering balls only — **no hands, no juggler**.
- Runtime-adjustable: beat period (slew-limited), dwell time, gravity, playback
  speed (distinct from tempo!), hand count `n_h` (1–8), per-hand catch/throw
  positions (freely placeable + line/circle presets).
- Ladder diagram view (2D time-vs-hands event chart).
- Timeline bar with scrub playhead + detachable trail-length handle; ball tracers
  and future ghost trajectories.
- State-graph view: current-state marker hopping each beat, current pattern's cycle
  highlighted, click-any-node/pattern to transition via shortest path (BFS).
- Per-hand kinematics charts (|v|, |a|, |j|, per-axis toggle) and energy panel
  (throw work, catch absorption, net, average power).
- Save/share: URL-encoded state, named localStorage presets with JSON export/import,
  PNG frame capture.
- Audio: metronome tick / throw sounds (toggleable).
- Pattern library (curated named patterns).
- Static hosting; zero backend; the whole app is a pure client-side SPA.

### Explicitly deferred (documented, not built in v1)

| Feature | Notes for the future |
|---|---|
| Synchronous patterns `(4,4)` | Breaks one-throw-per-beat; touches parser, state space, UI |
| Multiplex `[33]` | Same |
| `2` as a tiny hop (toggle) | v1 holds all 2s; the toggle is a parser/timing flag later |
| GIF / video export (configurable duration) | V2. Determinism makes this exact: render frames offline from `position(t)`, encode via MediaRecorder→WebM (cheap) or gif.js/wasm (true GIF). Not screen capture. |
| Time-bookmark URLs (`&t=12.34`) | Low priority per owner; trivial on top of URL state |
| Passing / multi-juggler geometry semantics | `n_h > 2` already covers the math; presentation later |
| Jugglebot export | The event timeline (throws with positions & release velocities) is exactly what a robot juggler planner consumes; keep `core/` UI-agnostic so this stays possible |

---

## 2. Architecture: a pure function of time

**The single most important decision in this codebase**: the simulation is not a
stateful frame-by-frame integrator. It is an **append-only event timeline** (throw
events with beat, hand, throw value, release point & velocity) from which every
ball's position — and every hand's implied position — is evaluated **analytically**
at any time `t` (piecewise parabolas + spline segments).

Consequences (these are load-bearing; do not regress them):

- Scrubbing to any time, tracers of arbitrary length, and future ghost paths are
  all just evaluations of `position(t)` — no replay buffers, no recording.
- Runtime parameter changes create an **epoch**: they affect *future* events only.
  Past events are immutable, so history stays scrubbable and physics stays honest
  (a ball already in flight cannot be retroactively altered).
- Charts and energy are closed-form windowed evaluations — "live" for free.
- Deterministic: `core/` never calls `Date.now()`, `Math.random()`, or
  `performance.now()`. Time is always an argument. (This also enables exact
  offline GIF rendering later.)

### Module map

```
src/core/        Pure TypeScript. No DOM, no three.js, no React imports. Fully unit-tested.
  siteswap/      parse, validate (beat-accurate errors), orbits, period, average theorem
  timing/        τ_b, t_d_eff clamping, beat schedule, epochs, slew-limited tempo
  timeline/      append-only event timeline; scheduler with lookahead; transitions
  kinematics/    parabola solver, quintic Hermite carry/return paths, position/vel/acc/jerk
  energy/        ∫F·v integrals, positive/negative split, per-hand per-period aggregation
  stategraph/    state-space generation for (b, N), BFS navigation, cycle extraction
src/render3d/    three.js scene: balls, tracers, ghosts, hand-position gizmos, camera
src/ui/          React components: panels, timeline bar, ladder view, graph view, charts
src/state/       zustand store: config, clock, derived selectors; URL/localStorage codecs
```

The dependency direction is strictly `ui / render3d → state → core`. `core` imports
nothing from the other layers. This boundary is enforced by an ESLint rule and it is
what makes the whole app agent-buildable and property-testable.

### The clock

One global clock: `simTime` advances at `wallTime · playbackSpeed` while playing;
scrubbing sets `simTime` directly. Every view (3D, ladder, timeline bar, charts,
state-graph marker) renders from the same `simTime`. There is no per-view time.

---

## 3. Siteswap semantics (v1)

- Validity: for pattern `p` of length `L`, all `(i + p[i]) mod L` distinct, and
  `mean(p)` integer (= `b`). Errors must name the beats: e.g. *"collision at beat 4:
  the 5 thrown at beat 0 and the 3 thrown at beat 2 both land there."*
- Hand assignment: hand `i` throws beats ≡ i (mod n_h); landing hand `(k+h) mod n_h`.
  `n_h = 2` reproduces standard alternation. The same digits mean different physical
  patterns at different `n_h` — that's inherent to multi-hand notation and fine.
- `0`: hand idle that beat (no catch, no throw). `2`: held — the ball rides the hand
  through that beat; consecutive 2s merge into one long carry (test patterns: `40`,
  `501`, `522`, `423`, `60`).
- Orbits: partition of throws into ball-identity cycles; used for the spatial
  period (see §6).

---

## 4. Physics & kinematics

### 4.1 Timing

All identities in NOTATION.md. Per-catch effective dwell `t_d_eff(h_in) =
min(t_d, β·h_in·τ_b)`, `β = 0.75` default. UI shows when clamping is active
(e.g. dwell readout turns amber on the affected hand/beat).

### 4.2 Flight

A throw of value `h` from throw point **P_t** (hand `i`) to catch point **P_c**
(hand `(k+h) mod n_h`) with air time `t_air` follows the unique parabola:
horizontal velocity `Δxz / t_air`, vertical velocity solves the endpoint constraint
under `−g`. Balls may visually overlap/pass through each other — accepted for v1
(no hands are drawn; collision-free hand-path planning is a non-goal).

### 4.3 Carry and return paths (hand model)

The hand trajectory must be defined for **all** time (charts need it):

- **Carry** (catch → throw, with ball): **quintic Hermite** segment matching
  position, velocity, **and acceleration** at both endpoints, with endpoint
  acceleration = `(0, −g, 0)` (free-fall matched). Physically: contact force ramps
  from zero at catch and to zero at release. This keeps acceleration continuous
  everywhere and jerk finite everywhere (jerk may step at events; only a septic
  would smooth that — out of scope).
  - **Hold dip**: the carry scoops to depth `holdDepth` (m) below the
    catch–throw line and holds there — a bounded absorb (catch → dip, sized by
    the constant-deceleration time `2·holdDepth / v_vertical`), an exactly level
    hold through the dip, and a wind-up (dip → throw): up to three quintic
    segments stitched C² (the level hold vanishes when the absorb needs the
    whole carry). This is the "hold vertical distance" control, and it keeps the
    carry a single smooth scoop — no dip overshoot, no mid-carry bump.
  - A cubic (4-point Bézier, velocity-matched only) is available behind a
    `CarryPath` interface as a comparison toggle — it produces jerk deltas at
    events by construction; the UI may note this when selected.
- **Return** (throw → next catch, empty hand): same quintic machinery, C² at the
  junctions (endpoint accelerations match the adjoining carry ends, i.e. `−g`).
- **Idle** (`0` beats / startup): hand eases to and rests at its catch point.
- **Held 2s**: the carry simply spans the extra beats through the same spline
  machinery (level hold at the dip; do not generate a throw/catch pair).

`CarryPath` is a pluggable interface; quintic-with-via-point is the default.

### 4.4 Kinematics evaluation

`ballState(ball, t)` and `handState(hand, t)` return position/velocity/acceleration/
jerk in closed form (polynomial derivatives — no numeric differentiation anywhere).
Property tests assert: position continuous everywhere; velocity continuous at events;
acceleration continuous at events (quintic path); flight acceleration ≡ `(0,−g,0)`.

### 4.5 Energy (per hand)

Contact force during carry: `F(t) = m·(a(t) − g_vec)` with `m = 1 kg` normalized;
`F = 0` at both carry endpoints by construction. Power `P = F·v`. Per carry:

- **Throw work** `W⁺ = ∫ max(P, 0) dt`
- **Catch absorption** `W⁻ = ∫ min(P, 0) dt` (reported as magnitude)
- **Net** `W = W⁺ + W⁻ = ΔKE + g·Δy` — the work–energy theorem is a built-in
  cross-check and a property test.

Panel reports, per hand, aggregated over one spatial period: W⁺, |W⁻|, net, and
average power (W⁺-based). Units J/kg and W/kg.

### 4.6 Runtime tempo change (slew-limited)

`τ_b` changes are interpolated exponentially toward the slider target with time
constant `τ_slew = 0.5 s`, discretized per beat (each scheduled beat uses the
then-current `τ_b`; epochs record the curve). Catches happen when the ball
physically arrives; throws stay on the (moving) beat grid; dwell absorbs the slack.
**Engine guard**: a `τ_b` step is further clamped so that no in-flight ball's
arrival lands after its scheduled rethrow beat. This is what human jugglers do when
slowing a pattern down, and it must animate without teleporting balls.

Hand-position edits and other parameter changes: future events only (in-flight balls
land where their parabola was aimed).

---

## 5. State graph

- Nodes: binary landing-schedule vectors of length `N` with `popcount = b` —
  C(N, b) nodes. Edges: beat advance (shift; if a ball lands now, choose an empty
  slot ≤ N to throw it to; else throw `0`).
- The graph is **per (b, N)**. Changing `b` regenerates it; patterns of different
  `b` are unreachable from each other (UI must make this clear).
- Current state = marker ("little ball" icon) that hops every beat. Current
  pattern's cycle = highlighted nodes/edges.
- **Click-to-navigate**: BFS from current state to the nearest state on the target
  pattern's cycle → shortest transition throw sequence; ties broken by
  lexicographically smallest throw sequence (deterministic). During transition the
  marker walks off the cycle and the UI shows "transitioning to 531 (2 beats)".
- Clicking a bare state (not on the current pattern): navigate there, then hold the
  **shortest cycle through that state** (BFS state→itself).
- **Typing a new pattern routes through the identical navigate machinery** — text
  entry transitions smoothly by default; a "hard reset" button restarts clean.
- If an entered pattern's max `h` exceeds `N`, auto-expand `N` (cap 11, warn ≥ 9 —
  C(N,b) explodes and force layouts turn to hairballs; default `N = 7`).
- Layout: group nodes by excitation level (distance from ground state) rather than
  hoping force-directed layout stays readable.

---

## 6. Views & UI

### 3D scene (main view)

three.js via react-three-fiber; OrbitControls; camera presets (front / side / top /
juggler POV); subtle ground grid; balls as spheres (radius 0.035 m). Ball color:
**per-ball palette by default** (each ball a distinct color, identical to that
ball's color in the ladder diagram — the two views cross-reference); toggle off
for a single configurable color in both views. *(Owner override 2026-07-10: v1
originally specified per-orbit coloring here.)* Hand catch/throw positions shown
as draggable gizmos when the positions editor is open.

### Timeline bar (bottom, full width)

Represents a **fixed, configurable window** (default 3 s — not one period; period
display is a separate readout "pattern repeats every X s"). Background: a miniature
ladder strip (per-hand throw/catch tick marks) so the scrubber has context.
Playhead scrubs `simTime`. A second, detachable handle drags backward to set trail
length; trails may exceed the window (the handle then pins to the left edge with a
numeric readout). Trails = polyline of `position(t)` over the trailing window;
ghosts = dashed future paths (toggleable).

### Ladder diagram view

Time on the horizontal axis (rhymes with the timeline bar), one lane per hand;
throw/catch event dots joined by flight arcs and carry segments; per-ball coloring
follows the 3D toggle (same palette, same ballId mapping). This view doubles as the
**engine debug view** — it is built before the 3D scene in the plan for exactly
that reason.

### Charts panel

Per-hand |v|, |a|, |j| (magnitude default, per-axis toggle). X-axis = the same
window as the timeline bar; a shared cursor line tracks `simTime` across all charts.
Rendering: lightweight canvas (uPlot or hand-rolled); no heavyweight chart lib.

### Energy panel

Table per hand: W⁺, |W⁻|, net, avg power (see §4.5), plus totals.

### Settings / controls

Pattern input (live validation), pattern library dropdown, b readout, τ_b slider,
playback speed slider (0.05×–2×), t_d slider (cap 0.9·n_h·τ_b, amber when clamping),
holdDepth, g slider (0.5–30), n_h stepper (1–8), hand-position editor with
line/circle presets, colors, audio toggles, N stepper for the graph.

### Save / share

- **URL codec**: full config (pattern, all sliders, positions, toggles, camera) in
  the query string; compact versioned encoding: `?v=1&...`.
- **Presets**: named saves in localStorage + JSON file export/import.
- **PNG capture**: canvas screenshot button.

### Audio

WebAudio tick on throws (optional catch tick), volume + toggle. No assets — synthesize
clicks (oscillator + envelope) to keep the app asset-free.

---

## 7. Defaults

| Parameter | Default | Range |
|---|---|---|
| Pattern | `3` (3-ball cascade) | — |
| `τ_b` | 0.25 s | 0.08–1.0 s (slider log-scaled) |
| `t_d` | 0.30 s | 0.02–0.9·n_h·τ_b |
| `β` (dwell clamp) | 0.75 | fixed (advanced setting) |
| `τ_slew` | 0.5 s | fixed |
| `g` | 9.81 m/s² | 0.5–30 |
| Playback speed | 1× | 0.05×–2× |
| `n_h` | 2 | 1–8 |
| Hand positions (n_h=2) | throws at x=±0.10 m, catches at x=±0.30 m, y=1.00 m, z=0 | free |
| Circle preset | hands on r=0.45 m circle, throws inset toward center | — |
| `holdDepth` | 0.10 m | 0–0.4 m |
| Timeline window | 3 s | 1–15 s |
| Ball radius | 0.035 m | 0.01–0.1 m |
| Ball color | per-ball palette (matches ladder); single configurable color on toggle off | — |
| `N` (graph) | 7 | 3–11 (warn ≥ 9) |

Defaults must make the startup cascade look natural without touching anything.

---

## 8. Tech stack & quality gates

- **Vite + TypeScript (strict) + React + react-three-fiber (three.js) + zustand.**
- Tests: **vitest** + **fast-check** property tests for `core/` (the majority of
  test value lives here); jsdom component tests where cheap.
- **Playwright e2e**: attempted in Phase 0; this dev box is arm64 Ubuntu 20.04 and
  recent Playwright may not support it — if browser install fails, record it in
  BUILD_LOG.md and rely on unit gates + operator visual checks instead. Do not
  fight the platform.
- Lint: ESLint (with the core-boundary import rule) + Prettier.
- **One canonical gate**: `npm run gate` = typecheck && lint && test && build.
  Every phase ends green on this command. CI (GitHub Actions) runs the same gate
  when a remote exists; deploy to GitHub Pages from `main` (Phase 9).
- Hosting: static; GitHub Pages / Cloudflare Pages; $0/month.

## 9. Dev environment notes (this machine)

- Jetson Orin Nano, arm64, Ubuntu 20.04, Node v22 (`node --version` → v22.x).
  npm installs are network-bound but fine; builds are slower than a desktop —
  be patient, don't add timeouts under 5 min to build commands.
- The browser runs on the **user's desktop over LAN**, not on the Jetson: start dev
  servers with `npm run dev -- --host` and tell the user the URL + port.
- This is a plain Node project: do **not** activate the Python venv used by the
  robotics repos.
