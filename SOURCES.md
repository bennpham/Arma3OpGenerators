# Data sources

This repository ships two JSON data dumps under `docs/json/`. This document records
where they came from, what they contain, and what their coverage does and does not mean.

## Provenance

**Both files were extracted live from a running Arma 3 client**, by custom SQF scripts
executed in the Eden Editor debug console, walking the game's own runtime configs:

| File | Config walked |
|------|---------------|
| `docs/json/worldLocation.json` | `CfgWorlds` — per-world `Names` location classes |
| `docs/json/classes.json` | `CfgVehicles` — every spawnable entity class |

This is **not a third-party dataset**. It was not scraped from the Bohemia wiki, taken
from a community classname list, or produced by the Bohemia developer tools. There is no
upstream URL to re-pull from and no upstream versioning to track. The data is factual
config metadata read out of the game the same way any mission script would read it.

The practical consequence: **the dump is only as current as the last extraction run.**
To update it, re-run the extractor in-game and replace the file. Diffing a fresh dump
against the committed one is the only way to see what changed.

### Reproducing an extraction

The SQF extractor scripts are the reproduction recipe for this data and belong in the
repository next to it. If they are not yet committed, add them under `docs/extractors/`
so the dumps stay reproducible rather than becoming one-off blobs nobody can regenerate.

A re-extraction should record, alongside the data:

- the date of the run,
- the Arma 3 build, and
- the modset loaded (the `//` group headers in `worldLocation.json` serve this purpose
  today — keep them accurate).

## Coverage depends on the modset loaded at extraction time

This is the most important caveat in this document.

The extractor can only see what the game had loaded when it ran. Coverage is therefore a
**snapshot of one machine's modset**, not a complete census of Arma 3.

**An absent world or classname means that mod was not loaded — not that it does not
exist.** Equally, the presence of a classname is not a promise: a mission referencing a
CUP or Spearhead classname will fail for any player without that mod. Anything consuming
this data for mission generation must treat mod availability as the user's problem to
declare, and should surface the `addons[]` requirements rather than hiding them.

Re-running the extractor with a different modset produces a different file that is just
as valid. Neither is more correct than the other.

The current `worldLocation.json` was extracted with these mod bundles loaded, recorded as
`//` group headers in the file itself:

| Group header | Worlds | Locations |
|--------------|-------:|----------:|
| Vanilla maps | 5 | 468 |
| Global mobilization or mods relating to it | 7 | 262 |
| Vietnam | 5 | 443 |
| CUP | 17 | 1705 |
| CWR3 | 4 | 151 |
| CUP 2.0 | 2 | 447 |
| WW2 (Spearhead 1944) | 5 | 1310 |
| All other Custom | 16 | 610 |
| **Total** | **61** | **5396** |

`classes.json` carries no such grouping, but was extracted from the same environment; its
120 distinct `faction` values reflect the same modset.

---

## `docs/json/worldLocation.json` — map locations

> **This file is not valid JSON.** A plain `JSON.parse` of its contents fails.

It is **8 independent JSON arrays, one per line**, each preceded by a `//` comment
labelling its mod provenance, with blank lines between blocks:

```
// Vanilla maps
[{"worldName":"Altis", ... }, ... ]

// Global mobilization or mods relating to it
[{"worldName":"gm_weferlingen_summer", ... }, ... ]
```

To read it: split into lines, skip blanks and `//` lines, `JSON.parse` each remaining
line, and concatenate — carrying the most recent `//` label as the group for the worlds
that follow. `tools/build-worlds.mjs` does exactly this; see **Derived files** below.

### World object

| Field | Type | Notes |
|-------|------|-------|
| `worldName` | string | Config class name, e.g. `"Altis"`, `"CUP_Chernarus_A3"`. This is the identifier a mission folder suffix must match (`myOp.Altis`). |
| `displayName` | string | Human-readable name, e.g. `"Chernarus 2020"`. Use for UI. |
| `mapSize` | number | Terrain edge length in metres, e.g. `30720`. **May be `0`** — see gotchas. |
| `locationCount` | number | Count of `locations`. Redundant with `locations.length`. |
| `locations` | array | Location objects, below. |

### Location object

| Field | Type | Notes |
|-------|------|-------|
| `name` | string | In-game place name, e.g. `"Kavala"`. Not guaranteed unique across a world. |
| `type` | string | Location class — see the type table below. |
| `x` | number | World easting, metres. |
| `y` | number | World **northing**, metres. Not an elevation. |
| `radiusA` | number | Footprint semi-axis, metres. |
| `radiusB` | number | Footprint semi-axis, metres. |
| `angle` | number | Footprint rotation, degrees. `0` for the overwhelming majority. |

Example row:

```json
{"name":"Kavala","type":"NameCity","x":3458.95,"y":12966.4,"radiusA":500,"radiusB":250,"angle":0}
```

### Location types present in this dump

| `type` | Count | What it is |
|--------|------:|------------|
| `NameLocal` | 1466 | Minor named locality — hamlet, farm, landmark |
| `StrongpointArea` | 1418 | AI strongpoint marker, not a settlement |
| `NameVillage` | 1308 | Village |
| `Hill` | 382 | Named high ground |
| `NameMarine` | 366 | Bay, cape, sea feature |
| `NameCity` | 253 | Town / city |
| `RockArea` | 111 | Rock formation |
| `NameCityCapital` | 47 | Capital |
| `Airport` | 33 | Airfield |
| `BorderCrossing` | 12 | Border crossing |

The three `Name*` settlement types — `NameVillage`, `NameCity`, `NameCityCapital` — are
the set that reads as "a town you can attack". For Altis these 48 entries are exactly the
hardcoded `TOWNS` list in the pre-multi-map generator.

---

## `docs/json/classes.json` — units and vehicles

A **single valid JSON array** of 35,294 entries. Every entry has the same 7 keys.

| Field | Type | Notes |
|-------|------|-------|
| `classname` | string | The config class — what you write into `mission.sqm`. |
| `displayName` | string | Human-readable name. Use for UI. |
| `side` | string | One of `WEST`, `EAST`, `GUER`, `CIV`, `UNKNOWN`. Config spelling, **not** Eden's (`"West"`, `"East"`, `"Independent"`, `"Civilian"`) — a mapping is required when emitting `mission.sqm`. |
| `faction` | string | Config faction class, e.g. `"OPF_F"`, `"CUP_B_USMC"`. 120 distinct. `"Default"` is the catch-all for non-faction objects. |
| `category` | string | One of `Infantry`, `Wheeled`, `Tracked`, `Air`, `Sea`, `Static`, `Other`. |
| `vehicleClass` | string | Free-form editor grouping hint, 260 distinct and mod-specific. A display hint, **not** a reliable filter key. |
| `addons` | string[] | Addon classes required by this entity, 0–13 entries. 13 entries have an empty array. Union these across every emitted classname to build `mission.sqm`'s `addons[]`. |

Example row:

```json
{"classname":"O_Soldier_SL_F","displayName":"Squad Leader","side":"EAST","faction":"OPF_F","category":"Infantry","vehicleClass":"Men","addons":["A3_Characters_F"]}
```

### Distributions in this dump

| `side` | Count |     | `category` | Count |
|--------|------:|-----|------------|------:|
| `UNKNOWN` | 22651 | | `Other` | 23619 |
| `WEST` | 5878 | | `Infantry` | 6314 |
| `EAST` | 3400 | | `Wheeled` | 2554 |
| `GUER` | 2481 | | `Air` | 905 |
| `CIV` | 884 | | `Static` | 833 |
| | | | `Tracked` | 822 |
| | | | `Sea` | 247 |

### The filter every consumer needs

`CfgVehicles` contains far more than units and vehicles: props, ammo crates, ruins,
ambient sounds, structures, and editor modules are all in there.

**22,637 of 35,294 entries are `side: "UNKNOWN"` *and* `category: "Other"`.** Filtering
those out leaves roughly 12,600 genuinely mission-usable units and vehicles:

```js
const usable = classes.filter(e => e.side !== "UNKNOWN" && e.category !== "Other");
```

Skip this filter and a faction picker will happily offer the player `"Owl"`,
`"Concrete Dam (20m)"`, and `"Cricket 1"` as infantry.

### What the dump does not contain

There is no `role` field. Nothing marks a classname as a squad leader, autorifleman, or
medic. Any consumer building a role-keyed roster (as the generator's `FACTIONS` needs)
must infer roles from `classname` / `displayName` patterns. This is the one place the
data does not map cleanly onto the generator's existing shape.

Addon **display** names are also absent — `addons[]` gives classes only.

---

## Gotchas

1. **`worldLocation.json` is not valid JSON.** Line-oriented, `//`-commented. See above.
2. **`mapSize` can be `0`** — true for 7 of 61 worlds in this dump (4 CWR3, 3 CUP). Never
   divide by it without a fallback; it is used for coordinate-to-pixel scaling.
3. **`side` uses config spelling** (`WEST`/`GUER`), not Eden's (`"West"`/`"Independent"`).
   `mission.sqm` wants Eden's.
4. **`y` is a northing**, not an elevation. Arma world coordinates are `[x, y, z]` with
   `z` as height; the dump carries no `z`.
5. **`vehicleClass` is unreliable** for filtering — free-form and mod-specific. Use
   `category` instead.
6. **`locationCount` is redundant.** It matches `locations.length` throughout the current
   dump; trust `.length`.
7. **`addons` can be empty** (13 entries).
8. **`name` is not unique.** Two locations in one world can share a name.

---

## Derived files

### `docs/json/worlds.json`

Generated by `tools/build-worlds.mjs` from `worldLocation.json`. A single **valid** JSON
array of all 61 worlds, each carrying an added `group` field taken from its `//` header.
All other fields are passed through unchanged.

```sh
node tools/build-worlds.mjs          # regenerate
node tools/build-worlds.mjs --check  # fail if the committed file is stale
```

**Do not hand-edit it.** The raw `worldLocation.json` is the source of truth; this file is
a regenerable artifact. Re-run the build after every re-extraction. The build is
deterministic and idempotent — an unchanged input reproduces the file byte for byte.

> **Browser note — decided.** A page opened over `file://` cannot `fetch()` a sibling JSON
> file under default browser CORS rules, and `op-generator.html` is a single self-contained
> file opened directly from disk. The data is therefore **distilled and inlined** by
> `tools/build-data.mjs` into delimited `GENERATED` regions in the HTML: about 110 KB
> covering 56 worlds and 80 factions, bringing the tool to ~186 KB. No fetch, no server, no
> second file — the single-file property is preserved.

---

## Licensing and redistribution

Classnames, place names, and display names are the property of Bohemia Interactive and
the respective mod authors. What is stored here is factual configuration metadata —
identifiers and coordinates — retained so that missions generated by this tool reference
valid game content. No game assets, models, textures, or code are included or
redistributed.

---

## See also

- `.claude/skills/arma3-data/SKILL.md` — the data shape in consumption terms, with parse
  snippets and recipes.
- `docs/INTEGRATION-MAP.md` — where each dataset plugs into the generator.
