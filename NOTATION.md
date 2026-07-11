# NOTATION.md — Canonical Symbols & Identities

This file is **normative**. All code, docs, UI tooltips, and commit messages use these
symbols and definitions. If a concept isn't here and needs a symbol, add it here first.

## Glossary

| Symbol   | Meaning                                        | Unit  | Notes |
|----------|------------------------------------------------|-------|-------|
| `b`      | Number of balls                                | count | `b = mean(h)` over the pattern (average theorem) |
| `h`      | Siteswap throw value (the "digit")             | beats | Dimensionless beat count until rethrow. Digits `0–9`; letters `a–z` parse as 10–35 |
| `N`      | Maximum `h` considered by the state graph      | beats | Configurable; graph has C(N, b) nodes |
| `n_h`    | Number of hands                                | count | Hand `i` throws on beats ≡ i (mod n_h). A ball thrown at beat `k` with value `h` lands in hand `(k+h) mod n_h` |
| `τ_b`    | Beat period                                    | s     | The tempo knob. Runtime changes are slew-limited (see DESIGN.md §4.6) |
| `t_d`    | Dwell time (catch → throw of the same ball)    | s     | Global slider; clamped per-throw, see identity (4) |
| `t_e`    | Hand-empty time                                | s     | Derived, see identity (2) |
| `t_air`  | Air time of a throw                            | s     | See identity (1) |
| `z_apex` | Physical apex height above the throw point     | m     | See identity (3) |
| `g`      | Gravitational acceleration                     | m/s²  | Default 9.81; user-adjustable |
| `r_d`    | Dwell ratio                                    | –     | `r_d = t_d / (n_h · τ_b)` |
| `β`      | Per-throw dwell clamp factor                   | –     | Default 0.75 |
| `(l,r)`  | Synchronous throw pair (round 3)               | –     | Both hands throw at once; a pair spans **2 beats** (throws on even beats); values are even |
| `x`      | Crossing suffix (sync notation)                | –     | Flips a sync throw to the opposite hand. In vanilla notation `x` is still the letter for value 33 |
| `[...]`  | Multiplex group (round 3)                      | –     | Several balls thrown from one hand at one instant |
| `*`      | Mirror-repeat (sync notation)                  | –     | Repeats a synchronous run with hands swapped: `(6x,4)*` ≡ `(6x,4)(4,6x)` |

Use the full words in UI labels; use the symbols in code comments, docs, and math
where the full verbiage is clunky. In code identifiers, use the descriptive names
(`beatPeriod`, `dwellTime`, `airTime`, `throwValue`, `ballCount`, `handCount`) —
the symbols live in comments and docs.

## Identities

1. `t_air(h) = h·τ_b − t_d_eff(h)` — air time of an airborne throw of value `h`.
   (`h = 2` is a **held** ball in v1: no flight, no air time. Exception, round 3:
   a sync `2x` is a genuine crossing flight and uses this identity.)
2. `t_d + t_e = n_h·τ_b` — a hand's full cycle. Exact only when the hand throws on
   every one of its beats; `0`s (empty hand) and held `2`s create exceptions.
3. `z_apex = g·t_air²/8` — for equal-height throw and catch points. In general the
   flight is the unique parabola through the throw point and catch point with the
   given `t_air`.
4. `t_d_eff(h) = min(t_d, β·h·τ_b)` — the **effective dwell preceding the rethrow of
   a ball whose incoming throw value was `h`**. Guarantees `t_air > 0` for every
   airborne throw. This is why patterns containing 1s (51, 531, 423…) are physically
   possible: real jugglers shorten dwell on those catches, and so do we.
   Additionally `t_d_eff < n_h·τ_b` always (the hand must have finished its previous
   throw); the UI caps the `t_d` slider at `0.9·n_h·τ_b`.
5. (round 3) **Ball count generalizes** to `b = (Σ over all throws of h) / L`, with a
   sync pair occupying 2 of the `L` beats. **Validity generalizes** from the vanilla
   collision test to a landing-schedule balance: every hand throws exactly the number
   of balls that land in it — per-beat for async (multiplex counts), per-(beat, hand)
   for sync. A non-crossing sync throw of value `h` lands in the **same** hand after
   `h` beats; `x` sends it to the other hand.

## Terms

- **event** — a catch or throw instant.
- **carry** — the catch→throw segment where the hand holds the ball. Consecutive
  held `2`s merge into one multi-beat carry.
- **return** — the throw→next-catch segment where the hand is empty.
- **state** — a binary landing-schedule vector of length `N`: bit `i` = "a ball lands
  `i` beats from now". Every valid siteswap is a cycle in the state graph.
- **epoch** — a point in sim time where a runtime parameter changed. Parameters are
  piecewise-constant between epochs; **past events are immutable** (changes affect
  future events only).
- **orbit** — the cycle a physical ball traverses through the pattern's throws.
- **sync pair** — a `(l,r)` pair: both hands throw at the same instant (round 3).
- **multiplex** — a `[...]` group: one hand throws several balls at one instant;
  the hand's carry holds all of them (round 3).
- **vanilla** — the plain async single-throw notation (digits/letters only). The
  state graph, explorer, and live splicing cover vanilla patterns; entering or
  leaving sync/multiplex is a clean restart (round-3 ruling).

## Conventions

- Scene units are **meters**, **y-up** (three.js convention) in core and render
  internals; hands live near y ≈ 1.0. **User-facing surfaces speak the right-handed
  Z-UP display frame** (round 3, owner ruling): display X = the hands' line (sim x),
  display Y = front–back (−sim z), display Z = up (sim y). One mapping module
  (`render3d/displayFrame.ts`) owns the conversion; the scene triad, hand-position
  editor, and workspace sliders all use it.
- Beats are indexed from 0. Sim time `t` is in seconds; playback speed rescales the
  wall-clock→sim-time mapping only and has **no physical effect**.
- Mass is normalized to 1 kg; energies are reported in J/kg (they scale linearly).
