# CLAUDE.md

Airtime is an interactive 3D siteswap (juggling) visualizer and kinematics lab —
a pure client-side TypeScript SPA. Pre-1.0, built phase-by-phase by AI agents;
see PLAN.md for the build plan and BUILD_LOG.md for current status.

## Documents (read before coding)

- `NOTATION.md` — **normative** symbols, identities, terms. All code and docs conform.
- `DESIGN.md` — the frozen design: scope, architecture, physics, UI. § references
  in other docs point here.
- `PLAN.md` — phased implementation plan with acceptance gates.
- `BUILD_LOG.md` — orchestrator's ledger: phase status, decisions, deferred items.
- `ORCHESTRATOR_PROMPT.md` — orchestration protocol (orchestrator-owned; builders
  don't edit it or BUILD_LOG.md).

## Hard rules

1. **Core purity**: `src/core/**` imports nothing from React/three/zustand/ui/state/
   render3d and never calls `Date.now()`, `Math.random()`, or `performance.now()`.
   Time is always a function argument. This is what makes the sim scrubbable,
   testable, and deterministic — it is the load-bearing architectural decision
   (DESIGN.md §2). Enforced by ESLint; do not weaken the rule.
2. **The gate**: `npm run gate` (typecheck && lint && test:run && build) must be
   green before every commit. Never commit red. Never weaken or delete a property
   test to get to green — surface instead.
3. **Determinism over convenience**: no numeric differentiation, no frame-rate-
   dependent logic in core, closed-form evaluation everywhere (DESIGN.md §4).
4. Physical units are meters/seconds/kg (mass normalized to 1 kg), y-up.
   Identifiers use descriptive names (`beatPeriod`, `dwellTime`, `airTime`,
   `throwValue`, `ballCount`, `handCount`); NOTATION.md symbols appear in comments
   and docs.

## Commands

```bash
npm ci                    # install (slow on this Jetson — be patient)
npm run dev -- --host     # dev server; the browser runs on the user's desktop over LAN
npm run gate              # typecheck && lint && test:run && build — the pre-commit gate
npm run test              # vitest watch mode (iteration)
```

## Environment

Jetson Orin Nano, arm64, Ubuntu 20.04, Node v22. Plain Node project — do **not**
activate the Python venvs used by the robotics repos on this machine. Give
build/test commands ≥ 5 min timeouts. Playwright support on this platform is
uncertain (see PLAN.md Phase 0 fallback).

## Conventions

- Commits: `phase-N: summary` with trailer `Phase: N` during the phased build;
  conventional prefixes (`fix:`, `docs:`…) otherwise. No backticks in `-m` strings.
- Deferred/discovered work goes in BUILD_LOG.md under the phase entry, not in
  TODO comments.
- No runtime file output; the app is a static SPA with no backend and no bundled
  external assets (assets are synthesized or bundled). Core sim/render logic makes
  no network requests and works fully offline. Two narrow, owner-authorized (round
  8, 2026-07-13) exceptions live only at the app shell: (a) outbound navigation
  links to GitHub Issues for bug/feature reporting (a link away, not a runtime
  request); (b) a single privacy-preserving analytics beacon (GoatCounter —
  cookieless, no personal data), fired once at boot and gated to production builds
  with a configured site code. Neither is load-bearing: with the beacon unconfigured
  and the links unclicked, the app is byte-for-byte the self-contained SPA it was.
