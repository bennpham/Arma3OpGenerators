# Integration map — where the data plugs into the generator

Every place in `altis-op-generator.html` that hardcodes game data, and which dataset
replaces it. **This document describes; it changes nothing.** No generator logic has been
modified.

For the data shapes see `.claude/skills/arma3-data/SKILL.md`; for provenance see
`SOURCES.md`.

Line numbers were verified against the current `altis-op-generator.html`. If they drift,
re-check with `grep -n` before trusting them.

## The current state in one paragraph

`altis-op-generator.html` is a single self-contained file that hardcodes everything about
Altis: 48 settlements, a `30720` map size, 4 hand-written faction rosters, 8 player-slot
classnames, and a 2-entry `addons[]` list. The generator core is otherwise map-agnostic —
`rollPlan` and `buildSQM` take coordinates and classnames and do not care where they came
from. **The data is the only thing tying the tool to Altis.**

## Verified: the Altis data is already a subset of the dump

The hardcoded `TOWNS` array at `:289` is *exactly* the 48 `NameVillage` + `NameCity` +
`NameCityCapital` entries for Altis in `worldLocation.json`:

- 48 of 48 names present in the dump
- 0 coordinate mismatches beyond 0.05 m
- The dump's Altis entry has 172 locations and `mapSize: 30720`

So the dump is a strict superset, adding 79 `NameLocal`, 25 `Hill`, and 20 `NameMarine`
locations Altis mode does not currently offer. **Replacing `TOWNS` with dump-derived data
is a drop-in that cannot regress Altis** — a useful property, since the stated plan is to
get Altis right first and then generalise to presets for other maps.

## Plug points

### Map location data → `worldLocation.json` / `worlds.json`

| # | Anchor | Today | Replacement |
|---|--------|-------|-------------|
| 1 | `:289` `TOWNS` | 48 hardcoded Altis `{n,x,y}` | World's `locations[]` filtered to the 3 `Name*` settlement types. Also unlocks `radiusA`/`radiusB`/`angle` for objective sizing, and `Hill` / `Airport` as new anchor kinds |
| 2 | `:971` `var WORLD = 30720` | Altis constant | World `mapSize`. **The blocker for multi-map** |
| 3 | `:1030` `toPx` / `toWorld` | divides by `WORLD` | reads from selected world |
| 4 | `:1045` grid drawing | `1000/WORLD*CS` | same |
| 5 | `:1119`, `:1220` coordinate clamps | `Math.min(WORLD, …)` | same |
| 6 | `:987–994` anchor `<select>` | populated from `TOWNS` | same source; needs a **world selector** above it |
| 7 | `:1060–1070` map render | draws `TOWNS` as dots | same; `radiusA/B` + `angle` allow real footprint ellipses |
| 8 | `:1126–1128` nearest-anchor snap | scans `TOWNS` | same |
| 9 | `:1213` anchor lookup by name | `TOWNS.filter(…)` | same |
| 10 | `:1232` random anchor | `r.pick(TOWNS)` | same |
| 11 | `:280` save-folder instruction | text says `<something>.Altis` | World `worldName`. **The `.sqm` carries no world name** — the world binding is purely the mission folder suffix, so this text is load-bearing, not cosmetic |
| 12 | `:6`, `:141`, `:156` title/header | "Altis" | World `displayName` |

**`WORLD` (#2) is the real work.** It is a single `var` but it feeds coordinate transforms,
grid rendering, and input clamping. Making it per-world touches items 3–5 mechanically.
Guard `mapSize === 0` (7 of 61 worlds) — see the fallback recipe in the skill, and prefer
a hardcoded size in a per-map preset for any world that matters.

### Unit / vehicle data → `classes.json`

| # | Anchor | Today | Replacement |
|---|--------|-------|-------------|
| 13 | `:316–337` `FACTIONS` | 4 hand-built rosters, each mapping 13 role keys to classnames | Filter `side` + `faction` + `category: "Infantry"`. **120 factions available** vs 4 |
| 14 | `:511` `fac.roster[role]` | direct object index, falls back to `rifle` | **Unchanged.** Keep this interface — only roster *construction* changes |
| 15 | `:690`, `:702`, `:733`, `:745` | writes `side="West"` / `plan.fac.side` | Dump uses `WEST`/`EAST`/`GUER`/`CIV`; `mission.sqm` wants Eden's `West`/`East`/`Independent`/`Civilian`. Needs an explicit mapping table |
| 16 | `:425–434` `PLAYER_SLOTS` | 8 hardcoded BLUFOR recon classnames | `side: "WEST"`, `category: "Infantry"`. Lowest priority — works fine today |
| 17 | `:586–590` `addons[]` | 2 hardcoded + 3 conditional Zeus entries | Union of `addons[]` over every emitted classname |
| 18 | `:594–596` addon display names | 1 hardcoded pair | **Not in the dump.** Classnames only; needs a separate lookup or omission |

### Untouched by either dataset

`OPS` (`:339`), `STRENGTH` (`:411`), `WEATHER` (`:418`) are authored mission design, not
game data. `OPS` templates reference **role keys**, not classnames, which is why swapping
factions works at all — keep that indirection.

`module.exports` at `:963` exports `TOWNS`, `FACTIONS`, `OPS`, `STRENGTH`, `WEATHER`,
`rollPlan`, `buildSQM`, `gridRef` for Node. **Preserve it.** It is the seam a test harness
or an offline per-map preset builder would use, and it is the natural place to feed
dump-derived data in headless.

## The one place the data does not map cleanly

`FACTIONS` (#13) needs 13 named roles — `sl`, `tl`, `rifle`, `ar`, `gl`, `lat`, `medic`,
`marksman`, `sniper`, `aa`, `officer`, `engineer`, `mg`.

**`classes.json` has no role field.** Roles must be inferred from `classname` /
`displayName` patterns, and there is no cross-mod convention to lean on:

```
O_Soldier_AR_F           vanilla CSAT autorifleman
CUP_O_RU_Soldier_AR      CUP Russian autorifleman
vn_o_pavn_men_05         Vietnam PAVN — carries no role token at all
```

Vanilla and CUP are tractable via suffix matching. Others are not. Practical approach:

1. Pattern-match `classname` first, `displayName` second (`displayName` is often the more
   honest signal — "Autorifleman", "Squad Leader" — and is localised consistently).
2. Always fall back — `:511` already degrades to `rifle`, so partial coverage is safe.
3. Treat any faction whose roster resolves under some threshold of the 13 roles as
   unsupported, and keep it out of the picker rather than shipping a broken roster.

**Recommendation:** keep the 4 existing hand-written rosters as verified presets, and treat
dump-derived rosters as an additive tier. Do not delete working data to prove a point.

## `addons[]` is the sleeper win

Item #17 is independently valuable and does not depend on anything else here.

`buildSQM` currently emits a fixed 2-entry `addons[]`, which is why `:280` instructs the
user to "open in Eden once and save to let it rewrite `addons[]`". Since every entry in
`classes.json` carries its own `addons[]`, the correct list is a union over the classnames
actually emitted — computable exactly, with no inference. That removes a manual step from
every single mission the tool produces, and it becomes *required* the moment a non-vanilla
faction is selectable.

## Suggested ordering

1. **`addons[]` (#17)** — self-contained, no dependencies, fixes a real defect today.
2. **World data (#1–#12)** — `mapSize` and `TOWNS` are one coherent change; do it on Altis
   first, where the dump is proven identical to the hardcoded list, then add a world
   selector. Solve the `file://` fetch problem before starting (see `SOURCES.md`).
3. **Factions (#13–#16)** — gated on role inference; the hardest and least certain. Worth
   doing behind the existing hand-written presets rather than instead of them.
