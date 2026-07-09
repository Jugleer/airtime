# Airtime

**An interactive 3D siteswap laboratory.** Animate juggling patterns with physically
honest timing, manipulate them live (tempo, dwell, gravity, hand geometry), navigate
the siteswap state graph by clicking, and see the kinematics no other tool shows you —
implied hand velocity/acceleration/jerk and per-hand energy.

> **Status**: Phase 8 (state graph) done — a collapsible "State graph" panel
> renders the (b, N) landing-schedule graph (C(N, b) states in deterministic
> excitation-level columns), highlights the running pattern's cycle, and hops a
> marker state-to-state every beat. Click any state — or type a same-b pattern —
> and the app BFS-plans the shortest (lexicographically smallest) transition
> throw sequence and SPLICES it into the running timeline: the past stays
> bit-identical, in-flight balls keep flying, and the 3D pattern morphs without a
> glitch, with a live "transitioning to 531 (2 beats)" status. Bare states hold
> the shortest cycle through them (which becomes the running pattern); N
> auto-expands to fit typed patterns (cap 11, warning at ≥ 9); different-b or
> beyond-cap patterns hard-reset with a visible notice, and a hard-reset button
> restarts clean. Prior phases: charts & energy panel, live runtime physics
> (slew-limited tempo, gravity, hold depth, carry-path toggle, hand geometry
> editor), timeline bar with trails/ghosts, the 3D scene, and the ladder debug
> view. The build is executed phase-by-phase by AI agents — see `PLAN.md` (what)
> and `BUILD_LOG.md` (progress).

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
