# Arma3OpGenerators

A single-file HTML tool that rolls a random Arma 3 mission scaffold and exports a
version-54 `mission.sqm`. Open `altis-op-generator.html` directly in a browser — no build
step, no dependencies, no server.

Currently **Altis only**. Multi-map support via per-map presets is the planned direction;
`docs/INTEGRATION-MAP.md` is the work order for it.

## Layout

| Path | What |
|------|------|
| `altis-op-generator.html` | The whole tool — UI, generator core, `mission.sqm` emitter |
| `docs/json/` | Game data dumps (see below) |
| `tools/build-worlds.mjs` | Normalizes the raw location dump into valid JSON |
| `SOURCES.md` | Where the data came from, and its coverage caveats |
| `docs/INTEGRATION-MAP.md` | Where the data plugs into the generator |

`altis-op-generator.html` keeps its generator core pure and `module.exports`-able
(around line 963) so it can be driven from Node. Preserve that seam.

## Data

Two JSON dumps in `docs/json/`, extracted live from a running Arma 3 client via SQF in the
Eden debug console — **not** a third-party dataset:

- `worldLocation.json` — 61 worlds, 5396 map locations (`CfgWorlds`)
- `classes.json` — 35,294 unit/vehicle/object classnames (`CfgVehicles`)
- `worlds.json` — derived from `worldLocation.json` by `tools/build-worlds.mjs`; never
  hand-edit it

Two things to know before touching either:

> **`worldLocation.json` is NOT valid JSON.** It is 8 separate JSON arrays, one per line,
> each preceded by a `//` mod-group comment. A plain `JSON.parse` fails. Use
> `docs/json/worlds.json` instead, or the parser in the skill.

> **Most of `classes.json` is not units.** 22,637 of 35,294 entries are props, ammo,
> ruins, and sounds. Filter `side !== "UNKNOWN" && category !== "Other"` before showing
> anything to a user.

**Read `.claude/skills/arma3-data/SKILL.md` before consuming either file** — full field
tables, value domains, the remaining gotchas, and consumption recipes.

Coverage reflects the modset loaded when the extractor ran. An absent world or classname
means that mod was not loaded, not that it does not exist — and a present classname is not
a promise the player has that mod. See `SOURCES.md`.
