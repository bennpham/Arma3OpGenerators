# Arma3OpGenerators

Random operation generators for Arma 3 — pick a map and a spot on it, roll an objective,
and export a version-54 `mission.sqm` you can drop straight into a mission folder.

## Use it

Open `op-generator.html` in a browser. No build, no install, no server.

Pick a world, an anchor, an objective type, a garrison and your own faction, then download
`mission.sqm` into a folder named `<something>.<worldName>` under your `MPMissions`
directory — the suffix is what binds the mission to the map, and the tool shows you the
exact name to use.

- **56 worlds**, grouped by mod bundle: vanilla, CUP, S.O.G. Prairie Fire, Spearhead 1944,
  Global Mobilization, Cold War Rearmed III, and assorted custom terrains.
- **80 factions**, selectable independently for your squad and for the garrison.
- **Anchors** can be settlements, named hills, or airfields — an observation post wants
  high ground, not a village square.
- **`addons[]` is derived** from the units actually emitted, so a mission states exactly
  which content it needs. The UI lists the required mods and their authors before you
  download, and Eden should not need to rewrite anything on first save.

## Data

Map locations and unit/vehicle classnames were extracted live from Arma 3's `CfgWorlds`
and `CfgVehicles` by SQF scripts run in the Eden debug console.

- [`SOURCES.md`](SOURCES.md) — provenance, field reference, coverage caveats
- [`docs/INTEGRATION-MAP.md`](docs/INTEGRATION-MAP.md) — how the data reaches the generator
- [`.claude/skills/arma3-data/SKILL.md`](.claude/skills/arma3-data/SKILL.md) — data shapes and consumption recipes

Coverage reflects the modset loaded when the extractor ran. A faction being listed is not a
promise that the player has that mod — that is what the required-mods readout is for.

## Tools

The generator is a single self-contained file, but the data inside it is generated. A page
opened over `file://` cannot `fetch()` a sibling JSON, so the distilled tables are inlined
into `op-generator.html` between `GENERATED` marker comments. **Do not hand-edit those
regions.**

```sh
node tools/build-worlds.mjs         # raw CfgWorlds dump -> docs/json/worlds.json
node tools/build-data.mjs           # worlds.json + classes.json -> op-generator.html
node tools/smoke-test.mjs           # drive the generator core headlessly
node tools/browser-test.mjs         # drive the page in Chromium over file:// (needs playwright)
```

Every tool takes `--check` where it makes sense; run all four after any re-extraction:

```sh
node tools/build-worlds.mjs --check && node tools/build-data.mjs --check && node tools/smoke-test.mjs
```

`tools/browser-test.mjs` needs `npm i playwright` and skips itself when it is absent.
