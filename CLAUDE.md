# Arma3OpGenerators

A single-file HTML tool that rolls a random Arma 3 mission scaffold and exports a
version-54 `mission.sqm`. Open `op-generator.html` directly in a browser — no build step,
no dependencies, no server.

Covers **56 worlds and 80 factions**, with the player's faction and the garrison's chosen
independently. `docs/INTEGRATION-MAP.md` records how the game data reaches the generator.

## Layout

| Path | What |
|------|------|
| `op-generator.html` | The whole tool — UI, generator core, `mission.sqm` emitter, inlined data |
| `altis-op-generator.html` | Pointer page for the tool's former name |
| `docs/json/` | Game data dumps (see below) |
| `tools/build-worlds.mjs` | Normalizes the raw location dump into valid JSON |
| `tools/build-data.mjs` | Distills the dumps into the tables inlined in `op-generator.html` |
| `tools/smoke-test.mjs` | Headless checks against the generator core |
| `tools/browser-test.mjs` | Drives the page in Chromium over `file://` (optional Playwright) |
| `SOURCES.md` | Where the data came from, and its coverage caveats |
| `docs/INTEGRATION-MAP.md` | How the data plugs into the generator |

`op-generator.html` keeps its generator core pure and `module.exports`-able so it can be
driven from Node. **Preserve that seam** — it is what the tests run against. The core is
loaded by slicing the `<script>` block out and evaluating it with `document` undefined; the
UI IIFE is guarded by `typeof document !== "undefined"` and self-skips, so that guard is
load-bearing.

> **`op-generator.html` contains generated regions.** The blocks between
> `/* >>> GENERATED: … <<< */` and `/* <<< END GENERATED: … >>> */` are built by
> `tools/build-data.mjs`. Never hand-edit them — edit the tool and re-run it.
> `node tools/build-data.mjs --check` fails if they are stale.

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
tables, value domains, the remaining gotchas, and consumption recipes. Several of those
gotchas are load-bearing here: `mapSize` lies, `addons[]` carries ACE/CBA compat noise,
location names repeat and are sometimes empty, and there is no role field at all.

Coverage reflects the modset loaded when the extractor ran. An absent world or classname
means that mod was not loaded, not that it does not exist — and a present classname is not
a promise the player has that mod. See `SOURCES.md`.

## Verifying a change

```sh
node tools/build-worlds.mjs --check   # worlds.json matches the raw dump
node tools/build-data.mjs --check     # the inlined regions match the dumps
node tools/smoke-test.mjs             # core: golden regression + structural checks
node tools/browser-test.mjs           # page over file:// (skips without playwright)
```

`smoke-test.mjs` pins a golden hash of the default mission's output. If a change moves it,
diff the output and confirm the change was intended before updating the constant — that
hash is the only thing standing between a refactor and a silently different `mission.sqm`.
