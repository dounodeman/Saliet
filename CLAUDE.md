# Salient — notes for Claude

Browser RTS in TypeScript + Vite + Canvas 2D. Live at https://dounodeman.github.io/Saliet/
(every push to `main` is type-checked, tested, built and deployed by `.github/workflows/deploy.yml`).

## Commands
- `npm run dev` — dev server · `npm run build` — production build
- `npm run typecheck` · `npm test` (Vitest, ~15 s) · `npm run balance` (headless AI-vs-AI batches)
- Always run typecheck + tests before committing.

## Rules that must not break
- `src/sim/` is a pure, deterministic simulation: no DOM, no `Math.random`, `Date`,
  `performance`, trig/exp/pow/hypot or `**` (a test scans for these). Use the seeded RNG
  in the world. Online play depends on two browsers computing bit-identical states.
- The simulation only changes through `step(world, commands)`; players and the AI act
  only via `Command` objects (`src/sim/commands.ts`).
- The AI (`src/ai/`) only reads a `PlayerView`, never the `World`.
- All balance numbers live in `src/config.ts`.
- Multiplayer (`src/net/`) is two-player deterministic lockstep over WebRTC (PeerJS).
  If you change the simulation rules or the wire protocol, bump `PROTOCOL_VERSION` in
  `src/net/protocol.ts`.

See README.md and PLAN.md for the design.
