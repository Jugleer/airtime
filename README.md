# Airtime

**An interactive 3D siteswap laboratory.** Animate juggling patterns with physically
honest timing, manipulate them live (tempo, dwell, gravity, hand geometry), navigate
the siteswap state graph by clicking, and see the kinematics no other tool shows you —
implied hand velocity/acceleration/jerk and per-hand energy.

> **Status**: Phase 5 (timeline bar, tracers, ghosts) done — a full-width timeline
> bar with a mini-ladder tick background, a scrub playhead (drag sets the one clock,
> paused or playing), and a detachable trail-length handle that pins to the left
> edge with a readout when the trail outgrows the window; 3D ball trails and dashed
> future ghosts as closed-form `position(t)` polylines; a configurable window (1–15 s)
> shared with the ladder, plus a "pattern repeats every X s" readout. The build is
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
