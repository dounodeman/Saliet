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
      rng.ts              seeded PRNG (sfc32) + string hash
      vec.ts              tiny 2D helpers
      noise.ts            deterministic value noise (maps, terrain art)
      units.ts            unit creation, death, stamina/health upkeep
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
      minimap.ts          overview map (click/drag to move the camera)
      renderer.ts         draws a frame
    input/input.ts        mouse/keyboard → selection + Commands
    ui/hud.ts, menu.ts, style.css
    audio/sound.ts        sound hooks (tiny WebAudio synth, mutable)
    game/loop.ts          fixed-timestep loop with speed + pause
    game/session.ts       wires everything for one match
    maps/*.json, maps/index.ts
  tests/*.test.ts         Vitest (node env, sim only)
  scripts/balance.test.ts headless AI-vs-AI batch for balance passes (npm run balance)
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

## 9. Decisions made during implementation

* **Tooling:** Node 24 LTS, TypeScript 7, Vite 8, Vitest 5 (latest at build time).
* **Territory smoothing.** Pure presence painting produced "spaghetti" (raid
  trails everywhere, no readable front). Two extra rules fixed it: unoccupied
  cells follow their 8-neighbourhood majority (thin trails in enemy land erode,
  specks in neutral land fade), and small neutral pockets fully enclosed by one
  team (≤ 600 cells, not touching the map edge) are absorbed.
* **Owned cities claim a 5-cell radius** (up from 3.5) so captured cities hold
  real ground.
* **Water path penalty.** A* cost = travel time × a per-terrain penalty
  (`PATH_COST_MULT`, water ×2), because units are weak in water, not just slow.
* **Hold points.** Idle units remember where they stand and drift back after
  being shoved, so drawn lines keep their shape. A walking unit bumping a
  stationary friend gets a sideways component in the push (prevents head-on
  deadlocks).
* **Sandbox rules.** `createWorld(scenario, seed, rules)` can disable victory
  and supply; unit-level tests use this so they don't end instantly.
* **AI front pushing.** Holding alone produced stalemates. A front sector with
  local superiority advances its line 3 cells into enemy land (easy never
  pushes). Measured: normal-with-push beats normal-without 9–6.
* **Spawn positions are mirrored for team 1** so neither side spawns nearer the front.
* **Balance pass:** capture time 6 → 8 s (lone raiders snowballed too easily);
  random-map terrain thresholds retuned from ~50% to ~65% plains (heavies had
  no ground to fight on). Result over 20 random-map games per pairing, both
  sides: hard beats normal 15–3 (2 draws), hard beats easy 16–0 (4 draws),
  normal beats easy 14–0 (6 draws); the weaker side never won against easy.
* **Menu backdrop** is a live hard-vs-hard match on a random map.

## 10. Status

All six milestones are complete; each was type-checked, tested, built,
play-tested in the browser and committed. Possible next steps: fog of war (filter
`makeView`), replays from the command log, lockstep multiplayer, more maps,
per-unit supply-range overlay.

## 11. Online multiplayer (added after M6)

* **Model:** two-player deterministic lockstep. Only `Command`s cross the
  network; both browsers run the identical simulation. Local commands are
  scheduled `delay` ticks ahead (2–10 ticks, chosen by the host from the median
  of 5 pings) and every tick's command list is sent, even when empty, so a tick
  runs only when both players' inputs are known. Commands execute in team order.
* **Integrity:** remote commands for the local player's team are dropped;
  state hashes are exchanged every 100 ticks (desync → both continue vs the AI);
  build id + `PROTOCOL_VERSION` must match or the guest is turned away.
* **Transport:** WebRTC data channel via PeerJS (public signalling server and
  TURN relay, so the static GitHub Pages site needs no backend). Invite links
  are `?join=CODE` with 6-character codes.
* **Robustness:** messages arriving before a handler or game exists are buffered;
  a Web Worker timer keeps online games ticking when the tab is in the background
  (browsers freeze animation frames there); a watchdog treats 10 s of silence
  while waiting as a disconnect; when a player leaves, the AI takes over their army.
* **Rules online:** no pause, fixed 1× speed; the host can start rematches (the
  game id increments so stray messages from an old game are ignored).
* **Tests:** two simulated clients over a lossy-latency fake network, each played
  by an AI through its own lockstep, finish full games with identical hashes.
