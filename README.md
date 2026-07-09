# Airtime

**An interactive 3D siteswap laboratory.** Animate juggling patterns with physically
honest timing, manipulate them live (tempo, dwell, gravity, hand geometry), navigate
the siteswap state graph by clicking, and see the kinematics no other tool shows you —
implied hand velocity/acceleration/jerk and per-hand energy.

> **Status**: Phase 7 (charts & energy panel) done — a collapsible "Charts &
> energy" section with three hand-rolled canvas charts (hand speed |v|,
> acceleration |a|, jerk |j|), every hand overlaid with a color legend and a
> per-axis toggle (magnitude / x / y / z), sharing the timeline bar's window and
> simTime cursor: the quintic jerk trace is finite everywhere with steps at
> events, and switching to the cubic carry path shows the acceleration
> discontinuity. Below it, a per-hand energy table (throw work W⁺, catch
> absorption |W⁻|, net, average power, with a totals row) aggregated over one
> spatial period. Prior phases: live physics you can steer via a slew-limited
> tempo slider, gravity/hold-depth sliders, a quintic/cubic carry-path toggle
> (future-only kinematics epochs), an n_h stepper (1–8) with line/circle presets,
> and a numeric + gizmo hand-positions editor. The build is executed
> phase-by-phase by AI agents — see `PLAN.md` (what) and `BUILD_LOG.md` (progress).

## Planned feature set (v1)

- Vanilla async siteswap (`0–9`, `a–z`), live validation with beat-accurate errors
- 3D scene with navigable camera — balls only, no hands rendered
- Runtime controls: beat period (slew-limited — watch the pattern rise as it slows),
  dwell time, gravity, playback speed, 1–8 hands with freely placeable
  catch/throw points (line/circle presets)
- Ladder diagram + full-width timeline bar with scrubbing, ball trails, future ghosts
- State-graph view: current state hops beat-by-beat; click any pattern/state to
  transition via the shortest valid throw sequence
- Per-hand |v|/|a|/|j| charts and energy accounting (throw work vs catch absorption)
- Shareable URLs, named presets, PNG capture, synthesized audio ticks

Deferred to later versions: synchronous & multiplex patterns, GIF/video export,
and more — see `DESIGN.md` §1.

## Stack

Vite · TypeScript (strict) · React · three.js (react-three-fiber) · zustand ·
vitest + fast-check. Pure client-side SPA, statically hosted, zero backend.

The architectural heart: the whole simulation is a **closed-form function of time**
(append-only event timeline + analytic kinematics), which is what makes scrubbing,
tracers, live charts, and determinism essentially free. See `DESIGN.md` §2.

## Development

```bash
npm ci
npm run dev -- --host   # LAN-accessible dev server
npm run gate            # typecheck && lint && test && build
```

## License

MIT — see `LICENSE`.
