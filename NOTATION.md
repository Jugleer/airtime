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

Use the full words in UI labels; use the symbols in code comments, docs, and math
where the full verbiage is clunky. In code identifiers, use the descriptive names
(`beatPeriod`, `dwellTime`, `airTime`, `throwValue`, `ballCount`, `handCount`) —
the symbols live in comments and docs.

## Identities

1. `t_air(h) = h·τ_b − t_d_eff(h)` — air time of an airborne throw of value `h`.
   (`h = 2` is a **held** ball in v1: no flight, no air time.)
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

## Conventions

- Scene units are **meters**, **y-up** (three.js convention); hands live near y ≈ 1.0.
- Beats are indexed from 0. Sim time `t` is in seconds; playback speed rescales the
  wall-clock→sim-time mapping only and has **no physical effect**.
- Mass is normalized to 1 kg; energies are reported in J/kg (they scale linearly).
