# Arma3OpGenerators

Random operation generators for Arma 3 — pick a spot on the map, roll an objective, and
export a version-54 `mission.sqm` you can drop straight into a mission folder.

## Use it

Open `altis-op-generator.html` in a browser. No build, no install, no server. Set a seed,
pick an anchor town, an objective type, a faction and a strength, then download
`mission.sqm` into a folder named `<something>.Altis` under your `MPMissions` directory.

Currently Altis only. More maps are planned, built from the location data in `docs/json/`.

## Data

Map locations and unit/vehicle classnames were extracted live from Arma 3's `CfgWorlds`
and `CfgVehicles` by SQF scripts run in the Eden debug console.

- [`SOURCES.md`](SOURCES.md) — provenance, field reference, coverage caveats
- [`docs/INTEGRATION-MAP.md`](docs/INTEGRATION-MAP.md) — where the data plugs into the generator
- [`.claude/skills/arma3-data/SKILL.md`](.claude/skills/arma3-data/SKILL.md) — data shapes and consumption recipes

`docs/json/worlds.json` is generated — regenerate it after any re-extraction:

```sh
node tools/build-worlds.mjs          # rebuild
node tools/build-worlds.mjs --check  # fail if stale
```
