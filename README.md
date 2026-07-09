# Airtime

**An interactive 3D siteswap laboratory.** Animate juggling patterns with physically
honest timing, manipulate them live (tempo, dwell, gravity, hand geometry), navigate
the siteswap state graph by clicking, and see the kinematics no other tool shows you —
implied hand velocity/acceleration/jerk and per-hand energy.

> **Status**: Phase 6 (runtime parameters & hand geometry) done — live physics you
> can steer: a slew-limited tempo slider (grouped as "Tempo & physics", distinct
> from the "Playback speed & view" section), gravity and hold-depth sliders, and a
> quintic/cubic carry-path toggle — each applied as a future-only kinematics epoch
> (an in-flight ball keeps the parabola it was aimed with). An n_h stepper (1–8)
> with line/circle presets (a full rebuild), a numeric hand-positions editor plus
> draggable catch/throw gizmos in the 3D scene (future throws only), an amber
> dwell-clamp readout, and a non-blocking held-2 note at n_h ≠ 2. The build is
> executed phase-by-phase by AI agents — see `PLAN.md` (what) and `BUILD_LOG.md`
> (progress).

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
