---
name: arma3-data
description: How to read and consume this repo's Arma 3 game-data dumps in docs/json — map locations from CfgWorlds (worldLocation.json, worlds.json) and unit/vehicle classnames from CfgVehicles (classes.json). Use when working with map locations, towns, world sizes, unit or vehicle classnames, factions, sides, rosters, addon requirements, or when generating or editing mission.sqm content in this repository.
---

# Arma 3 data dumps

Two data dumps live in `docs/json/`, extracted live from a running Arma 3 client via SQF
in the Eden debug console. See `SOURCES.md` for provenance and coverage caveats; see
`docs/INTEGRATION-MAP.md` for where they plug into the generator.

**Read this before parsing either file.** The first one will break a naive `JSON.parse`.

| File | Contents | Valid JSON? |
|------|----------|-------------|
| `docs/json/worldLocation.json` | 61 worlds, 5396 locations (`CfgWorlds`) | **No** — see below |
| `docs/json/worlds.json` | Same data, normalized, `group` field added | Yes (derived) |
| `docs/json/classes.json` | 35,294 unit/vehicle/object classes (`CfgVehicles`) | Yes |

---

## 1. Map locations

### The raw file is not valid JSON

`worldLocation.json` is **8 independent JSON arrays, one per line**, each preceded by a
`//` comment naming its mod bundle, with blank lines between:

```
// Vanilla maps
[{"worldName":"Altis", ...}, ...]

// CUP
[{"worldName":"Sara", ...}, ...]
```

Parse it like this — the `//` label is meaningful data (mod provenance), not noise:

```js
function parseWorldLocationDump(text) {
  const worlds = [];
  let group = null;
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (s === "") continue;
    if (s.startsWith("//")) { group = s.slice(2).trim(); continue; }
    for (const w of JSON.parse(s)) worlds.push({ group, ...w });
  }
  return worlds;
}
```

**Prefer the normalized file.** `docs/json/worlds.json` is this output, pre-built and
valid — just `JSON.parse` it. Regenerate with `node tools/build-worlds.mjs` after any
re-extraction; `--check` fails if it is stale. Never hand-edit it; edit the raw dump's
source (the extractor) instead.

### Shape

```jsonc
{
  "group": "Vanilla maps",      // worlds.json only; from the // header
  "worldName": "Altis",         // config class — mission folder suffix must match (myOp.Altis)
  "displayName": "Altis",       // for UI
  "mapSize": 30720,             // terrain edge in metres — MAY BE 0
  "locationCount": 172,         // redundant with locations.length
  "locations": [
    {
      "name": "Kavala",         // place name, not unique within a world
      "type": "NameCity",       // see table below
      "x": 3458.95,             // easting, metres
      "y": 12966.4,             // NORTHING, metres — not elevation
      "radiusA": 500,           // footprint semi-axis, metres
      "radiusB": 250,           // footprint semi-axis, metres
      "angle": 0                // footprint rotation, degrees
    }
  ]
}
```

### Location types

| `type` | Count | Meaning |
|--------|------:|---------|
| `NameLocal` | 1466 | Minor locality — hamlet, farm, landmark |
| `StrongpointArea` | 1418 | AI strongpoint marker, **not a settlement** |
| `NameVillage` | 1308 | Village |
| `Hill` | 382 | Named high ground |
| `NameMarine` | 366 | Bay, cape, sea feature |
| `NameCity` | 253 | Town / city |
| `RockArea` | 111 | Rock formation |
| `NameCityCapital` | 47 | Capital |
| `Airport` | 33 | Airfield |
| `BorderCrossing` | 12 | Border crossing |

`NameVillage` + `NameCity` + `NameCityCapital` is the "attackable settlement" set. For
Altis that is exactly the 48 entries the generator used to hardcode as `TOWNS`,
coordinates matching to the last digit.

`Hill` and `Airport` are useful anchors this repo does not yet use — a hilltop OP or an
airfield raid wants those, not a town.

---

## 2. Units and vehicles

`classes.json` is a single valid JSON array. Every entry has the same 7 keys:

```jsonc
{
  "classname": "O_Soldier_SL_F",   // what goes into mission.sqm
  "displayName": "Squad Leader",   // for UI
  "side": "EAST",                  // WEST | EAST | GUER | CIV | UNKNOWN — config spelling
  "faction": "OPF_F",              // config faction class; 120 distinct; "Default" = catch-all
  "category": "Infantry",          // Infantry|Wheeled|Tracked|Air|Sea|Static|Other
  "vehicleClass": "Men",           // free-form editor hint, 260 distinct — do not filter on this
  "addons": ["A3_Characters_F"]    // required addon classes, 0–13; union these for mission.sqm
}
```

### Always filter the junk first

`CfgVehicles` includes props, ammo, ruins, sounds, structures, and modules.
**22,637 of 35,294 entries are `side: "UNKNOWN"` AND `category: "Other"`.**

```js
const usable = classes.filter(e => e.side !== "UNKNOWN" && e.category !== "Other");
// ~12,600 real units and vehicles
```

Without this, a unit picker offers "Owl", "Concrete Dam (20m)", and "Cricket 1" as infantry.

### Distributions

`side`: `UNKNOWN` 22651 · `WEST` 5878 · `EAST` 3400 · `GUER` 2481 · `CIV` 884
`category`: `Other` 23619 · `Infantry` 6314 · `Wheeled` 2554 · `Air` 905 · `Static` 833 · `Tracked` 822 · `Sea` 247

### There is no role field

Nothing marks a class as squad leader, autorifleman, or medic. A role-keyed roster (what
the generator's `FACTIONS` needs) must be **inferred** from `classname` / `displayName`
patterns, and inference must be mod-aware — `O_Soldier_AR_F`, `CUP_O_RU_Soldier_AR`, and
`vn_o_pavn_men_05` do not share a convention. Always provide a fallback role (the existing
generator falls back to `rifle`) and expect gaps.

Inferring from `displayName` first, then `classname`, resolves all 13 roles for 18 of the 92
non-civilian factions, ≥10 for 54, and ≥7 for 80. Two things make the difference:

1. **Prefer candidates from the faction's dominant addon.** `BLU_F` infantry span
   `A3_Characters_F` (64 units) but also `RF_Characters` (10) and `Characters_f_lxWS` (1),
   so a naive first-match roster can make NATO require Western Sahara.
2. **Anchor the AA rule.** A bare `\bAA\b` matches `Bodyguard (AA-12)`, which is a shotgun.

Addon **display** names are also absent; `addons[]` gives classes only.

---

## Gotchas checklist

- [ ] `worldLocation.json` is **not valid JSON** — use the parser above or `worlds.json`.
- [ ] `mapSize` is `0` for 7 of 61 worlds (4 CWR3, 3 CUP). **Never divide by it unguarded** — it
      drives coordinate scaling.
- [ ] `mapSize` is also **wrong when non-zero** for 4 worlds — it can be smaller than the
      world's own locations. `CUP_Chernarus_A3` reports 8192 with towns out to 13397;
      `Mountains_ACR` reports 6400 with locations to 12288; also `juju_sahatra` and
      `SPEX_Lingevres`. Widen with `max(mapSize, ceil(maxCoord/1024)*1024)` or pin by hand.
- [ ] `addons` carries **compat noise**. 259 usable units list `ace_*`/`cba_*` entries
      because ACE was loaded at extraction — vanilla `B_sniper_F` lists `ace_explosives`,
      and the Zeus modules list `zen_*`/`EF_Curator`. These are patches applied *to* content,
      not content requirements: strip them, or every mission hard-requires ACE3.
- [ ] Classnames are **case-insensitive in game but not in this file**. `O_soldier_LAT_F`
      (as written in mission.sqm) is `O_Soldier_LAT_F` here. Look up case insensitively.
- [ ] `displayName` is **mojibake for 230 entries** — UTF-8 read as Latin-1 at extraction
      (`Officer â€“ Paratrooper`). Classnames are ASCII and unaffected. Repair with a
      `Buffer.from(s,"latin1").toString("utf8")` round-trip, guarded by a validity check.
- [ ] Filter `side !== "UNKNOWN" && category !== "Other"` before showing units to a user.
- [ ] `side` is config spelling (`WEST`/`GUER`); `mission.sqm` wants Eden's
      (`"West"`/`"Independent"`). Map explicitly.
- [ ] `y` is a **northing**, not elevation. There is no `z` in the dump.
- [ ] Filter on `category`, never `vehicleClass`.
- [ ] Trust `locations.length` over `locationCount`.
- [ ] `addons` can be empty (13 entries).
- [ ] Location `name` is not unique within a world, **and can be empty**. 16 worlds have
      duplicates within the settlement+hill+airport set (Abel: 27 of 43); 110 Hill and
      Airport entries have `name: ""`. **Key locations by index, never by name** — a name
      lookup silently resolves to the wrong place — and synthesize a label for the blanks.
- [ ] Coverage = the modset loaded at extraction time. Absent ≠ nonexistent, and present
      ≠ available to the player. See `SOURCES.md`.

---

## Recipes

**Settlements for a world, as the generator's `TOWNS` shape:**

```js
const SETTLEMENTS = new Set(["NameVillage", "NameCity", "NameCityCapital"]);
const world = worlds.find(w => w.worldName === "Altis");
const towns = world.locations
  .filter(l => SETTLEMENTS.has(l.type))
  .map(l => ({ n: l.name, x: l.x, y: l.y }))
  .sort((a, b) => a.n.localeCompare(b.n));
```

**Map size with a safe fallback** (7 worlds report `0`):

```js
const size = world.mapSize > 0
  ? world.mapSize
  : Math.ceil(Math.max(...world.locations.flatMap(l => [l.x, l.y])) / 1024) * 1024;
```

The fallback rounds the furthest location out to the next 1024 m. It lands on the real
value for well-populated terrains (`Chernarus_Summer`, 306 locations, resolves to the
correct 15360) but **under-reads any world whose locations cluster inland** — worst case
here is CUP's `Desert_Island`, which has 2 locations. If a world matters, hardcode its
size in a per-map preset rather than trusting the estimate.

**Faction infantry, grouped for a roster:**

```js
const roster = classes.filter(e =>
  e.side === "EAST" && e.faction === "OPF_F" && e.category === "Infantry");
```

**Faction list for a UI** (only factions with real infantry):

```js
const factions = [...new Set(usable
  .filter(e => e.category === "Infantry" && e.faction !== "Default")
  .map(e => e.faction))].sort();
```

**`addons[]` for `mission.sqm`** — the union over every emitted classname:

```js
const byClass = new Map(classes.map(e => [e.classname, e]));
const addons = [...new Set(
  emittedClassnames.flatMap(c => byClass.get(c)?.addons ?? [])
)].sort();
```

Getting this right removes the "open in Eden once and re-save" workaround the tool
currently documents.

**Side token → Eden spelling:**

```js
const EDEN_SIDE = { WEST: "West", EAST: "East", GUER: "Independent", CIV: "Civilian" };
```
