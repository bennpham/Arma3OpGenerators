# Integration map — how the data reaches the generator

`op-generator.html` used to hardcode everything about Altis: 48 settlements, a `30720` map
size, 4 hand-written faction rosters, 8 player-slot classnames, and a 2-entry `addons[]`
list. It now draws all of that from `docs/json/`.

This document records what was wired and what is still open. For the data shapes see
`.claude/skills/arma3-data/SKILL.md`; for provenance see `SOURCES.md`.

## How the data gets in

The generator is a single file opened over `file://`, which cannot `fetch()` a sibling
JSON. So `tools/build-data.mjs` distills the dumps and **rewrites three delimited regions
inside `op-generator.html`**:

| Region | Contents |
|--------|----------|
| `MOD_TAGS` | Mod bundle labels, authors and urls, keyed by addon-name prefix |
| `WORLD_DATA` | 56 worlds × 2023 anchors — name, type code, easting, northing, radius |
| `FACTION_DATA` | 80 factions — Eden side, label, mod, role roster, per-classname addons |

Roughly 110 KB inlined, bringing the tool to ~186 KB. `--check` fails if the regions are
stale. The regions are emitted one element per line and in a stable order, so a
re-extraction produces a readable diff rather than one enormous line.

## What each plug point became

### Map locations → `worlds.json`

| Was | Now |
|-----|-----|
| `TOWNS`, 48 hardcoded Altis `{n,x,y}` | `WORLD_DATA` + `anchorsFor(world, kind)`; settlements, hills and airfields |
| `var WORLD = 30720` | `world.s`, resolved at build time (see below) |
| `toPx`/`toWorld`, coordinate clamps | unchanged — they already read `WORLD` |
| grid loop `for (i=0; i<=30; i++)` | `Math.ceil(WORLD/1000)`, with a 2 km label step below 10 km |
| anchor `<select>` keyed by name | keyed by **index** — see the gotcha below |
| save-folder text `<something>.Altis` | the selected world's `worldName` |
| title/header "Altis" | the selected world's `displayName` |

### Units → `classes.json`

| Was | Now |
|-----|-----|
| `FACTIONS`, 4 hand-built rosters | `FACTION_DATA`, 80 factions, gated at ≥7 of 13 roles |
| `fac.roster[role] \|\| fac.roster.rifle` | **unchanged** — only roster construction moved |
| `side="West"` hardcoded on the player | the chosen player faction's Eden side |
| `type="o_installation"`, `ColorOPFOR` | follow the side each marker represents |
| `PLAYER_SLOTS`, 8 NATO classnames | 16 role keys; NATO's recon team kept as an override over the first 8 |
| `addons[]`, 2 fixed entries | the exact union over emitted classnames |
| `AddonsMetaData`, always Bohemia | the real author and url per mod bundle |

`OPS`, `STRENGTH` and `WEATHER` are authored mission design, not game data, and are
untouched. `OPS` templates reference **role keys**, not classnames, which is why swapping
factions works at all — keep that indirection.

## Gotchas that bit, and must not be reintroduced

These are properties of the data, not of the code. Each one shipped as a bug or nearly did.

- **`mapSize` lies, and not only when it is `0`.** 7 worlds report `0`; 4 more report a
  size smaller than their own locations (`CUP_Chernarus_A3` claims 8192 with towns out to
  13397). Sizes are pinned in `SIZE_OVERRIDE` where known and widened to
  `ceil(maxCoord/1024)*1024` otherwise, with a warning printed either way. The smoke test
  asserts every anchor falls inside its world's size.
- **Location names repeat and are sometimes empty.** 16 worlds have duplicates within their
  anchor set (Abel: 27 of 43) and 110 Hill/Airport entries have no name at all. **Key
  anchors by index.** A name lookup silently snaps to the wrong place. Blank names are
  synthesized at build time so the blob is self-describing.
- **`addons[]` in the dump carries compat noise.** 259 usable units list `ace_*`/`cba_*`
  entries purely because ACE was loaded at extraction — vanilla `B_sniper_F` lists
  `ace_explosives`. Emitting them verbatim makes every mission hard-require ACE3. Stripped
  at build time, along with `zen_*`/`EF_Curator` on the Zeus modules.
- **Role inference can drag in a foreign mod.** `BLU_F` infantry span `A3_Characters_F`,
  `RF_Characters` and `Characters_f_lxWS`. Candidates are scored to prefer a faction's
  dominant addon, or NATO comes to require Western Sahara.
- **230 display names are mojibake** — UTF-8 read as Latin-1 at extraction. Labels only;
  classnames are ASCII. Repaired at build time when the round-trip is unambiguous.
- **Classnames are case-insensitive in game but not in the dump.** The hand-written rosters
  use `O_soldier_LAT_F` where the dump has `O_Soldier_LAT_F`. Look them up case
  insensitively or their addon requirements vanish silently.

## The one place the data still does not map cleanly

`classes.json` has **no role field**, and no cross-mod naming convention to lean on:

```
O_Soldier_AR_F           vanilla CSAT autorifleman
CUP_O_RU_Soldier_AR      CUP Russian autorifleman
vn_o_men_nva_02          Vietnam PAVN — carries no role token at all
```

Roles are inferred from `displayName` first (the more honest and more consistently
localised signal) then `classname`. Current coverage of the 13 roles across the 92
non-civilian side|faction groups:

- 18 resolve all 13
- 54 resolve ≥10
- 80 resolve ≥7 and are shipped
- 12 fall below 7 and are dropped rather than shipped as a squad of identical riflemen

Where a faction genuinely lacks a role — PAVN fields no squad leader or autorifleman at
all — a build-time fallback chain substitutes a near neighbour (officer for squad leader,
machine gunner for autorifleman) rather than the generic rifleman. The reported coverage
number stays the directly-inferred count, so the UI does not overstate how complete a
roster is.

## Still open

- **No vehicles or statics are ever emitted.** `classes.json` has 2554 wheeled, 822 tracked,
  905 air and 833 static entries that the generator does not touch. An air defence site with
  no launcher object is the most visible consequence.
- **`MarkerIDProvider.nextID` is still `1`** despite three markers being emitted.
- **The FHQ "complete" trigger has no `condition=`**, so it fires immediately unless edited.
- **Faction display labels are hand-authored** in `tools/build-data.mjs` and will rot on
  re-extraction. The build warns for any faction without one.
- **`Desert_Island`'s size is an estimate** from 2 locations; it has no usable anchors and
  is not shipped, but the estimate would need verifying if that changed.
