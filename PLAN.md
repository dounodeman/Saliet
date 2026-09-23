# SALIENT — Plan

*Salient* (n.): a bulge in a front line that pushes into enemy territory.

A minimalist, real-time strategy game in the browser. Armies are coloured dots,
territory is painted by the armies that hold it, and the whole game is about
drawing good front lines. The game is original: its name, visuals ("paper map"
look) and text are our own.

---

## 1. Architecture

```
            ┌────────────── browser only ───────────────┐
 keyboard ─▶│ input/        ─┐                           │
 mouse    ─▶│  selection,    │ Command[]                 │
            │  gestures      ▼                           │
            │           game/session ──▶ render/ (Canvas2D, interpolated)
            │           game/loop (fixed 20 Hz + accumulator)
            │                │  ▲ events (sound, fx)     │
            └────────────────┼──┼───────────────────────┘
                             ▼  │
            ┌──────────── sim/ (pure TS, no DOM) ───────┐
            │ step(world, commands) → world'            │
            │ deterministic: seeded RNG, fixed dt,      │
            │ stable iteration order, no Math.random,   │
            │ no Date/performance, no sin/cos/exp       │
            └───────────────────────────────────────────┘
                             ▲
            ai/ ── reads PlayerView (only what a player can see),
                   emits the SAME Command objects as the human
```

Rules that keep the layers honest:

* `src/sim/**` imports nothing from `render/`, `input/`, `ui/`, `audio/` and never
  touches `window`/`document`. A unit test scans the folder for forbidden APIs
  (`Math.random`, `Date`, `performance`, `document`, `window`, `Math.sin`...).
* The simulation only changes through `step(world, commands)`. Commands are
  plain JSON (`{kind:'move', team, unitIds, target, queue}`) and are logged with
  the tick they were applied on — that log + seed + map *is* a replay, and is the
  same thing a lockstep multiplayer layer would exchange later.
* The AI is just another command producer. It receives a `PlayerView` (unit
  positions/types/hp of everyone, cities, territory, and **only its own**
  production points / queue) — never the raw world.
* Rendering reads the world plus `prevX/prevY` of each unit and interpolates with
  `alpha = accumulator / dt`.

## 2. File layout

```
salient/
  index.html, package.json, tsconfig.json, vite.config.ts
  PLAN.md, README.md
  src/
    main.ts               boot, switches between menu and game session
    config.ts             *** every balance number lives here ***
    sim/
      types.ts            World, Unit, City, TeamState, SimEvent
      rng.ts              seeded PRNG (sfc32) with fork()
      vec.ts              tiny 2D helpers
      terrain.ts          Terrain enum, per-unit-type modifier lookup
      mapdef.ts           map JSON schema + rasterizer (regions → grid)
      mapgen.ts           procedural, point-symmetric map generator
      pathfinding.ts      A* (octile, typed arrays, binary heap) + smoothing
      spatial.ts          uniform spatial hash for neighbour queries
      formation.ts        group-move offsets, line-slot distribution/assignment
      commands.ts         Command union, validation, application
      movement.ts         path following, separation, terrain collision
      combat.ts           targeting + damage math (pure functions)
      territory.ts        control grid (who holds each cell)
      cities.ts           capture + production queue + spawning
      supply.ts           supply cap, supply network, starvation
      victory.ts          win checks
      world.ts            createWorld(), step()
      view.ts             PlayerView (fair, per-team projection of the world)
      hash.ts             state hash (determinism tests, desync detection)
    ai/
      ai.ts               AIController: decide() → Command[]
      analysis.ts         strength maps, front detection, threat scoring
      difficulty.ts       easy / normal / hard parameters
    render/
      camera.ts           pan/zoom, screen↔world
      palette.ts          colours
      terrainLayer.ts     baked terrain bitmap (organic edges, hatching)
      territoryLayer.ts   territory tint + marching-squares front lines
      effects.ts          transient hit sparks, death rings, capture pulses
      renderer.ts         draws a frame
    input/input.ts        mouse/keyboard → selection + Commands
    ui/hud.ts, menu.ts, style.css
    audio/sound.ts        sound hooks (tiny WebAudio synth, mutable)
    game/loop.ts          fixed-timestep loop with speed + pause
    game/session.ts       wires everything for one match
    maps/*.json, maps/index.ts
  tests/*.test.ts         Vitest (node env, sim only)
  scripts/balance.ts      headless AI-vs-AI batch for balance passes
```

## 3. Simulation design

**Units & coordinates.** 1 world unit = 1 terrain cell. Maps are ~120×76 cells.
Unit positions are floats. Fixed tick = 1/20 s.

**Map format (hand-authored JSON).** Instead of a giant character grid, maps
are *regions* painted in order onto a base terrain, which is easy to author by
hand and naturally "region-shaped":

```json
{ "name": "Twin Rivers", "width": 120, "height": 76, "base": "plains",
  "edgeNoise": 1.2,
  "regions": [
    { "terrain": "forest", "circle": [30, 20, 7] },
    { "terrain": "water",  "path": [[0,38],[40,36],[80,41],[120,39]], "width": 2.2 },
    { "terrain": "plains", "path": [[60,30],[60,46]], "width": 2 },   // a ford
    { "terrain": "mountains", "polygon": [[50,0],[58,0],[56,14],[50,12]] }
  ],
  "cities": [{ "name": "Ashford", "x": 10, "y": 38, "owner": 0 }],
  "units":  [{ "team": 0, "type": "light", "x": 12, "y": 36 }] }
```

`edgeNoise` jitters region edges with deterministic value-noise so borders look
organic. The rasterizer produces a `Uint8Array` terrain grid.

**Terrain.** plains, forest, hills, water, mountains (impassable). Each
(terrain, unitType) pair has `speed`, `attack`, `defense` (damage-taken
multiplier) and `staminaDrain` multipliers in `config.ts`. Heavies are fine on
plains and bad everywhere else; everybody is terrible in water.

**Movement & pathfinding.** A* on the terrain grid, 8-connected, no corner
cutting past mountains, edge cost = distance / speedMultiplier(terrain, type),
so heavies route around forests when it's cheaper and everyone avoids swimming.
Paths are smoothed by line-of-sight only when the shortcut never enters worse
terrain than the original path. Path requests are queued and resolved a bounded
number per tick, in unit-id order (deterministic, no frame spikes).

**Group move.** Units keep their relative offsets from the group centroid
(compressed if the group is spread out), each offset target snapped to a
passable cell. **Line command:** the drawn polyline is resampled into N evenly
spaced slots by arc length; units are assigned to slots by sorting both units
and slots along the line's main axis (no crossing paths). Shift queues any of
these as waypoints.

**Collision / separation.** Spatial hash; pairs closer than r1+r2 are pushed
apart (heavier units move less), two relaxation passes in id order, then units
are slid out of mountain cells and clamped to the map. Units therefore form
lines instead of stacking.

**Combat.** Continuous damage-over-time. Each tick every unit picks the nearest
enemy within contact range (edge distance ≤ `CONTACT_RANGE`) and deals
`dps × terrainAttack(own cell) × staminaFactor × dt × terrainDefense(target cell)`.
All damage is computed first, then applied (order-independent). Engaged units
move at a fraction of their speed, so fronts "lock" but can still be pushed or
withdrawn from. No chasing — units only fight what they touch.

**Stamina.** 0–100. Moving drains (× terrain drain), fighting drains more.
`staminaFactor = lerp(STAMINA_MIN_FACTOR, 1, stamina / STAMINA_LOW)` clamped to
1 — applies to both damage and speed. Idle **and** supplied units regain stamina
and health slowly.

**Territory.** A control grid (1 cell = 1 terrain cell) holding `owner` and
`control ∈ [0,1]`. Every 5 ticks, units stamp "presence" in a radius; owned
cities stamp presence around themselves. Uncontested presence raises control
for that team (flipping enemy cells after draining their control); contested or
empty cells keep their state. Rendered as a soft tint plus crisp marching-squares
border lines per team, so a front line appears exactly where the armies meet.

**Cities & production.** Cities are captured by having units within
`CAPTURE_RADIUS` with no enemy units there, for `CAPTURE_TIME` seconds (progress
decays when contested/abandoned). Each owned city adds production points (PP)
to its owner's pool. The player queues light/heavy units; the queue head is
built when PP ≥ cost and spawns at its chosen city (or the nearest owned city if
that one fell).

**Supply.** Cap = 5 × owned cities. If a team has more units than its cap, the
excess units (those farthest from a friendly city; ties by id) starve and lose
health. Separately, a unit is *out of supply* if it is more than `SUPPLY_RANGE`
cells from friendly territory that is **connected to a friendly city** (0‑1 BFS
over the territory grid). That makes encirclement meaningful: a pocket cut off
from its cities withers. Out-of-supply and starving units don't regenerate and
lose health over time; both are shown on the unit.

**Victory.** Hold ≥ 80 % of all cities (rounded up), or the enemy has no units
left. (Decision: a team with zero units loses immediately, even if it still owns
cities — this matches the spec literally and avoids stalemates.)

**Determinism.** Seeded sfc32 RNG stored in the world state; only `+ − × ÷ √`,
`floor`, `min`, `max`, `abs` in sim math (these are IEEE-exact everywhere);
entities iterated in id order; `hash(world)` over all numeric state. Tests
assert same seed + same commands ⇒ identical hash after N ticks, including a full
AI-vs-AI match.

## 4. Controls

| Input | Action |
|---|---|
| Left click / drag | select unit / box-select (Shift adds) |
| Left click on own city | choose it as the spawn city |
| Right click | move (A* around mountains) |
| Shift + right click | queue waypoint |
| Right drag | draw a front line; selection spreads evenly along it |
| Q / E | queue light / heavy at spawn city |
| Space | pause / resume |
| + / − | game speed (0.5×, 1×, 2×, 4×) |
| Wheel | zoom at cursor |
| WASD / arrows / screen edge | pan |
| Ctrl+A, Ctrl+1‑9 / 1‑9 | select all, control groups |
| H | halt selected units |
| Esc | pause menu |

## 5. AI

Runs every `reactionTicks` (difficulty-dependent) on a `PlayerView`, emits normal
Commands. Each decision:

1. **Economy** – keep `units + queued ≤ supplyCap`; choose heavy vs light by how
   much open plains lies between our cities and the enemy; spawn at the owned
   city nearest to the most threatened / most active front.
2. **Expand** – early on, send the nearest free units (1–2) to each reachable
   neutral city, closest first.
3. **Defend** – threat score per owned city (enemy strength nearby vs ours);
   pull reinforcements to threatened cities.
4. **Hold the front** – find border cells between our territory and the enemy's,
   split them into sectors, and assign units to sectors proportionally to enemy
   pressure using the same *line* command a human would draw.
5. **Counterattack** – find enemy cities / sectors where local enemy strength is
   weak relative to what we can bring; send a strike group (heavies only if the
   route and target are mostly plains).
6. **Recover** – units with very low hp/stamina pull back behind the front.

Difficulty = reaction time + decision quality: *easy* (≈3 s reactions, noisy
estimates, no counterattacks, no terrain-aware unit choice), *normal* (≈1.5 s),
*hard* (≈0.5 s, full feature set, tighter supply management).

## 6. Milestones (each ends runnable, typechecked, tested, built, committed)

* **M1** – Vite/TS scaffold, config, RNG, map rasterizer + 2 JSON maps, terrain
  rendering, camera (pan/zoom/edge scroll), units as dots, selection, straight
  movement, fixed-timestep loop with interpolation.
* **M2** – terrain modifiers, A* + smoothing, separation/collision, group
  offsets, line-formation command, shift-queued waypoints.
* **M3** – combat, health, stamina, hit/death effects.
* **M4** – territory + front lines, cities, capture, production queue, supply &
  starvation, win condition, HUD.
* **M5** – AI opponent (3 difficulties), AI-vs-AI determinism test.
* **M6** – main menu, map select (2 maps + random seed), pause/game-over
  screens, sound hooks, control groups, minimap, balance pass via headless
  AI-vs-AI batches, README.

After each: `npm run typecheck && npm test && npm run build`, play-test in the
browser pane (screenshots), fix, `git commit`.

## 7. Tests (Vitest, node environment)

* combat math (terrain & stamina factors, simultaneous resolution, contact range)
* terrain modifiers and map rasterization
* pathfinding (routes around mountains, prefers cheap terrain, unreachable → null)
* formation (line slots evenly spaced, assignment doesn't cross)
* city capture (uncontested/contested/decay) and production/spawning
* supply cap, starvation, encirclement (out of supply)
* victory conditions
* determinism (scripted commands; full AI-vs-AI match) + forbidden-API scan of `src/sim`

## 8. Decisions & assumptions

* Name **Salient**; original "paper map" palette; teams are *Cobalt* (player)
  and *Vermilion* (AI).
* 2 teams in this version; code keeps team indices generic where cheap.
* No fog of war (both sides see everything, like a board game); the AI still
  only gets a `PlayerView`, so adding fog later is a change in one file.
* Production doesn't block at supply cap — over-building is allowed and punished
  by starvation (the HUD warns).
* "Far from friendly territory" is interpreted as far from territory *connected
  to a friendly city* (enables encirclement).
* Procedural maps are point-symmetric for fairness and verified to connect both
  capitals (regenerate with the next seed otherwise).
* Sound is synthesized with WebAudio (no asset files); `M` mutes.
