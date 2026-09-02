#!/usr/bin/env node
/*
 * build-data.mjs — distill the game-data dumps into the generator's inlined tables.
 *
 * Input : docs/json/worlds.json   (built by build-worlds.mjs from the raw CfgWorlds dump)
 *         docs/json/classes.json  (raw CfgVehicles dump)
 * Output: op-generator.html       (three delimited GENERATED regions, rewritten in place)
 *
 * The generator is a single self-contained file opened over file://, which cannot
 * fetch() a sibling JSON. So the data is distilled here and inlined. The dumps stay
 * the source of truth; the regions in the HTML are derived artifacts — do not hand-edit
 * them. Deterministic and idempotent: an unchanged input reproduces the file byte for byte.
 *
 * Usage: node tools/build-data.mjs [--check]
 *        --check  verify the committed regions match a fresh build (CI-friendly);
 *                 exits non-zero on drift, writes nothing.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WORLDS_SRC = join(ROOT, "docs/json/worlds.json");
const CLASSES_SRC = join(ROOT, "docs/json/classes.json");
const OUT = join(ROOT, "op-generator.html");

const CHECK = process.argv.includes("--check");
const warnings = [];
const warn = (m) => warnings.push(m);

/* ==========================================================================
 * Authored tables — these are judgement, not derived data.
 * ========================================================================== */

/*
 * Mod bundles, matched against addon classnames. Supplies the UI's "which mods does
 * this mission need" labelling and the AddonsMetaData author/url, which the generator
 * previously hardcoded to Bohemia Interactive for everything.
 *
 * `metaClass` is the parent pbo Eden names in AddonsMetaData when it differs from the
 * addon entries themselves. The build fails on an addon matching no rule — that is how
 * a re-extraction with a new mod loaded announces itself.
 */
const MOD_TAGS = [
  { id: "vanilla", re: /^A3_/, label: "Arma 3", author: "Bohemia Interactive", url: "https://www.arma3.com", vanilla: true },
  { id: "cup", re: /^CUP_/, label: "CUP", author: "CUP Team", url: "https://cup-arma3.org" },
  { id: "sog", re: /^characters_f_vietnam|^cam_|^vn_/i, label: "S.O.G. Prairie Fire", author: "Savage Game Design", url: "https://store.steampowered.com/app/1227700" },
  { id: "spe", re: /^WW2_SPE/, label: "Spearhead 1944", author: "Spearhead 1944 Team", url: "https://store.steampowered.com/app/1175380" },
  { id: "gm", re: /^gm_/, label: "Global Mobilization", author: "Vertexmacht", url: "https://store.steampowered.com/app/1042220" },
  { id: "cwr3", re: /^cwr3_/, label: "Cold War Rearmed III", author: "CWR3 Team", url: "https://cwr3.arma3.com" },
  { id: "ws", re: /^Characters_f_lxWS|^characters_1_F_lxWS|lxWS$/i, label: "Western Sahara", author: "Rotators Collective", url: "https://store.steampowered.com/app/1681170" },
  { id: "rf", re: /^RF_/, label: "Reaction Forces", author: "Bohemia Interactive", url: "https://store.steampowered.com/app/2647760" },
  { id: "ef", re: /^EF_/, label: "Expeditionary Forces", author: "Bohemia Interactive", url: "https://store.steampowered.com/app/2647830" },
  { id: "csla", re: /^CSLA/, label: "CSLA Iron Curtain", author: "CSLA Studio", url: "https://store.steampowered.com/app/1294440" },
  { id: "us85", re: /^US85/, label: "US Military 1985", author: "US85 Team", url: "https://steamcommunity.com/workshop/" },
  { id: "afmc", re: /^AFMC/, label: "AFMC", author: "AFMC Team", url: "https://steamcommunity.com/workshop/" },
  { id: "fia", re: /^FIA$/, label: "Arma 3", author: "Bohemia Interactive", url: "https://www.arma3.com", vanilla: true },
  { id: "ace", re: /^ace_/, label: "ACE3", author: "ACE3 Team", url: "https://ace3.acemod.org" },
  { id: "cba", re: /^cba_/, label: "CBA_A3", author: "CBA Team", url: "https://github.com/CBATeam/CBA_A3" },
];

/*
 * ACE and CBA entries ride along on units they patch — vanilla B_sniper_F lists
 * ace_explosives purely because ACE was loaded when the dump was extracted. They are
 * runtime compat patches, not content requirements: emitting them would make every
 * mission, including an all-vanilla one, hard-require ACE3. 259 usable units are affected.
 */
const COMPAT_ADDON = /^(ace_|cba_)/i;

/*
 * mapSize is unreliable. 7 worlds report 0 (the documented gotcha), and 4 more report a
 * non-zero size smaller than their own locations — CUP_Chernarus_A3 claims 8192 with towns
 * out to 13397. Anything not pinned here falls back to max(mapSize, ceil(maxCoord/1024)*1024)
 * and is reported as a warning, so a future re-extraction surfaces new bad worlds.
 */
const SIZE_OVERRIDE = {
  Eden: 12800, Abel: 12800, Noe: 12800, Cain: 12800,   // CWR3 remakes; report 0
  Chernarus_Summer: 15360, Chernarus_Winter: 15360,    // report 0; the autumn entry reports 15360
  CUP_Chernarus_A3: 15360,                             // reports 8192, locations reach 13397
  Enoch: 12800,                                        // Livonia; a location sits just outside
  Mountains_ACR: 12800,                                // reports 6400, locations reach 12288
  juju_sahatra: 8192,                                  // reports 4096, locations reach 6898
  SPEX_Lingevres: 4096,                                // reports 2048, one location at 3492
  Woodland_ACR: 8192, SPEX_Carentan: 8192, SPEX_Utah_Beach: 8192,
};

/*
 * Faction display names. classes.json carries no faction displayName, only the config
 * class. Unlabelled factions fall through to a prettifier and are reported, so the table
 * can be extended after a re-extraction rather than silently degrading.
 */
const FACTION_LABELS = {
  BLU_F: "NATO", BLU_T_F: "NATO (Pacific)", BLU_W_F: "NATO (Woodland)",
  BLU_G_F: "NATO (Enoch)", BLU_CTRG_F: "CTRG", BLU_GEN_F: "Gendarmerie",
  OPF_F: "CSAT", OPF_T_F: "CSAT (Pacific)", OPF_G_F: "CSAT (Enoch)",
  IND_F: "AAF", IND_C_F: "Syndikat", IND_G_F: "FIA", IND_E_F: "LDF",
  FIA: "FIA", FIA_DES: "FIA (Desert)",
  CUP_B_US_Army: "US Army", CUP_B_USMC: "USMC", CUP_B_GB: "British Army",
  CUP_B_GER: "Bundeswehr", CUP_B_CDF: "Chernarus Defence Forces", CUP_B_AFU: "Ukrainian Army",
  CUP_O_RU: "Russian Army", CUP_O_RUS_M: "Russian Army (Modern)", CUP_O_SLA: "SLA",
  CUP_O_TK: "Takistani Army", CUP_I_RACS: "RACS", CUP_I_NAPA: "NAPA",
  CUP_I_PMC_ION: "ION PMC", CUP_I_TK_GUE: "Takistani Militia",
  B_MACV: "MACV", B_AUS: "Australian Army", B_NZ: "New Zealand Army", B_ROK: "ROK Army",
  I_ARVN: "ARVN", O_PAVN: "PAVN", O_VC: "Viet Cong",
  SPE_US_ARMY: "US Army", SPE_WEHRMACHT: "Wehrmacht", SPE_STURM: "Sturmtruppen",
  SPE_FFI: "French Resistance", SPE_FR_ARMY: "French Army", SPE_MILICE: "Milice",
  SPEX_CW_ARMY: "Commonwealth Army", SPEX_CW_ARMY_TROP: "Commonwealth Army (Tropical)",
  SPEX_GER_DAK: "Deutsches Afrikakorps", SPEX_PL_ARMY: "Polish Army",
  cwr3_faction_usa: "US Army", cwr3_faction_usa_des: "US Army (Desert)",
  cwr3_faction_usmc: "USMC", cwr3_faction_rus: "Soviet Army",
  cwr3_faction_vdv: "VDV", cwr3_faction_vmf: "Naval Infantry",
  cwr3_faction_fia: "FIA", cwr3_faction_rebels_east: "Rebels (East)",
  cwr3_faction_rebels_west: "Rebels (West)",
  gm_fc_ge: "Bundeswehr", gm_fc_gc: "NVA", gm_fc_dk: "Danish Army", gm_fc_pl: "Polish Army",
  gm_fc_ge_bgs: "Bundesgrenzschutz", gm_fc_gc_bgs: "Grenztruppen",
  CSLA: "Czechoslovak People's Army", CSLA_DES: "Czechoslovak Army (Desert)",
  US85: "US Army 1985", US85_DES: "US Army 1985 (Desert)", AFMC: "AFMC",
  CUP_O_ChDKZ: "ChDKZ", CUP_O_TK_MILITIA: "Takistani Militia", CUP_I_UN: "UN Forces",
  CUP_B_CZ: "Czech Army", CUP_B_HIL: "Hilltop Security", cwr3_faction_uk: "British Army",
  O_CAM: "Khmer Rouge", O_PL: "Pathet Lao", I_CAM: "Khmer National Armed Forces",
  I_LAO: "Royal Lao Army", gm_fc_xx: "Unaffiliated",
  BLU_NATO_lxWS: "NATO (Sefrou-Ramal)", BLU_ION_lxWS: "ION Services",
  BLU_UN_lxWS: "UN Forces", OPF_SFIA_lxWS: "SFIA",
  BLU_TURA_lxWS: "Tura Militia (West)", OPF_TURA_lxWS: "Tura Militia (East)",
  IND_TURA_lxWS: "Tura Militia", EF_B_MJTF_Des: "MJTF (Desert)",
  EF_B_MJTF_Wdl: "MJTF (Woodland)", EF_B_MJTF_Navy: "MJTF (Navy)",
};

/*
 * Role inference. classes.json has no role field, and there is no cross-mod naming
 * convention, so roles are matched from displayName first (the more honest signal —
 * "Autorifleman", "Squad Leader", and localised consistently) then classname.
 *
 * Order matters: sl before tl before rifle, and aa is anchored to explicit AA wording so
 * "Bodyguard (AA-12)" (a shotgun) does not read as an AA specialist.
 */
const ROLES = ["sl", "tl", "rifle", "ar", "gl", "lat", "medic", "marksman", "sniper", "aa", "officer", "engineer", "mg"];

const ROLE_RULES = [
  ["sl", /\bsquad\s*lead|\bsection\s*lead|\bplatoon\s*lead|\bpatrol\s*lead|\bsquadlead|\bSL\b|gruppenf[üu]hrer/i],
  ["officer", /\bofficer|commander|captain|lieutenant|\bmajor\b|colonel|kommandeur/i],
  ["aa", /anti-?\s*air|\(\s*AA\s*\)|\bAA\s*(specialist|gunner|soldier)|MANPAD|stinger|strela|igla|fliegerfaust|redeye|\bAA\s*\(/i],
  ["lat", /anti-?\s*tank|\(\s*(light\s*)?AT\s*\)|\bAT\s*(specialist|gunner|soldier)|missile\s*specialist|rocket|\bRPG\b|\bLAW\b|bazooka|panzerschreck|panzerfaust|\bATGM\b|carl\s*gustaf/i],
  ["mg", /machine\s*-?\s*gun|machinegun|heavy\s*gunner|\bMG\b|\bLMG\b|\bGPMG\b|\bHMG\b|maschinengewehr/i],
  ["ar", /auto(matic)?\s*rifle|autorifle|\bAR\b(?!TY)|\bBAR\b/i],
  ["gl", /grenadier|grenade\s*launcher|\bGL\b/i],
  ["medic", /\bmedic|corpsman|combat\s*life|sanit[äa]|doctor|\bCLS\b/i],
  ["marksman", /marksman|designated|\bDMR\b|sharpshoot|scharfsch/i],
  ["sniper", /sniper|scout\s*sniper/i],
  ["engineer", /engineer|sapper|pioneer|demoli|explosive|\bEOD\b|mine\s*spec|repair\s*spec/i],
  ["tl", /\bteam\s*lead|\bfire\s*?team|\bTL\b|\bcorporal|asst\.?\s*squad|truppf[üu]hrer/i],
  ["rifle", /rifleman|\brifle\b|soldier|trooper|infantry|militia|guerrilla|fighter|paratroop|grenzer|sch[üu]tze|partisan|insurgent|volunteer|conscript/i],
];

/* Non-combat and specialist entries that must never fill a line role. */
const ROLE_EXCLUDE = /pilot|helicopter|crew(man)?\b|driver|diver|unarmed|survivor|\bUAV\b|hostage|prisoner|journalist|protagonist|\(story|bagged|\bdead\b|static|virtual|spectator|mortar|artillery|ammo\s*bearer|asst\.|assist|spotter|radio|\bRTO\b/i;

/* ==========================================================================
 * Helpers
 * ========================================================================== */

const EDEN_SIDE = { WEST: "West", EAST: "East", GUER: "Independent", CIV: "Civilian" };

/*
 * 230 display names in the dump are mojibake — UTF-8 bytes read as Latin-1 at extraction
 * ("Officer â€“ Paratrooper"). Repair only when the round-trip yields valid UTF-8 that is
 * actually shorter, so correctly-encoded names are left alone. Classnames are ASCII and
 * never affected.
 */
function fixEncoding(s) {
  if (!/[ÂÃâ€]/.test(s)) return s;
  const repaired = Buffer.from(s, "latin1").toString("utf8");
  if (repaired.includes("\uFFFD")) return s;
  return repaired.length < s.length ? repaired : s;
}

function modTagFor(addon) {
  for (const t of MOD_TAGS) if (t.re.test(addon)) return t;
  return null;
}

function prettyFaction(f) {
  return f
    .replace(/^(CUP_[BOIC]_|BLU_|OPF_|IND_|SPE_|SPEX_|cwr3_faction_|gm_fc_|B_|O_|I_)/, "")
    .replace(/_(F|lxWS)$/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim() || f;
}

/* ==========================================================================
 * 1. Worlds
 * ========================================================================== */

const SETTLEMENT = { NameCityCapital: "C", NameCity: "c", NameVillage: "v" };
const TYPE_CODE = { ...SETTLEMENT, Hill: "h", Airport: "a" };

function buildWorlds() {
  const raw = JSON.parse(readFileSync(WORLDS_SRC, "utf8"));
  const out = [];

  for (const world of raw) {
    const kept = world.locations.filter((l) => TYPE_CODE[l.type]);
    if (!kept.length) continue;   // 5 worlds carry no usable anchor at all

    const maxCoord = Math.max(0, ...kept.flatMap((l) => [l.x, l.y]));
    let size = SIZE_OVERRIDE[world.worldName];
    if (!size) {
      size = Math.max(world.mapSize || 0, Math.ceil(maxCoord / 1024) * 1024);
      if (!world.mapSize) warn(`${world.worldName}: mapSize is 0, estimated ${size} from locations`);
      else if (size !== world.mapSize) warn(`${world.worldName}: mapSize ${world.mapSize} is smaller than its locations, widened to ${size}`);
    }

    /* 110 Hill/Airport locations have an empty name, and 16 worlds repeat names within
     * the kept set. The generator keys anchors by index, but a blank label is unusable,
     * so synthesize one here — the blob should be self-describing. */
    let unnamedAir = 0;
    const locs = kept.map((l) => {
      let name = fixEncoding((l.name || "").trim());
      if (!name) {
        name = l.type === "Airport"
          ? (kept.filter((k) => k.type === "Airport").length > 1 ? `Airfield ${++unnamedAir}` : "Airfield")
          : `Hill ${Math.round(l.x / 100)}-${Math.round(l.y / 100)}`;
      }
      return [name, TYPE_CODE[l.type],
        Math.max(0, Math.round(l.x)), Math.max(0, Math.round(l.y)),
        Math.round(l.radiusA || 0)];
    }).sort((a, b) => a[0].localeCompare(b[0], "en") || a[2] - b[2] || a[3] - b[3]);

    out.push({ w: world.worldName, d: fixEncoding(world.displayName), g: world.group, s: size, l: locs });
  }

  /* Stable order: group as first seen in the dump, then display name. */
  const groupOrder = [...new Set(raw.map((w) => w.group))];
  out.sort((a, b) =>
    groupOrder.indexOf(a.g) - groupOrder.indexOf(b.g) ||
    a.d.localeCompare(b.d, "en") || a.w.localeCompare(b.w, "en"));

  return out;
}

/* ==========================================================================
 * 2. Factions
 * ========================================================================== */

/* Verified hand-written rosters. These predate the dump and are better than anything
 * inference picks, so they override it rather than being replaced by it. */
const VERIFIED = {
  "EAST|OPF_F": {
    label: "CSAT", tag: "CSAT",
    roster: { sl: "O_Soldier_SL_F", tl: "O_Soldier_TL_F", rifle: "O_Soldier_F", ar: "O_Soldier_AR_F", gl: "O_Soldier_GL_F", lat: "O_soldier_LAT_F", medic: "O_medic_F", marksman: "O_soldier_M_F", sniper: "O_sniper_F", aa: "O_soldier_AA_F", officer: "O_officer_F", engineer: "O_engineer_F", mg: "O_HeavyGunner_F" },
  },
  "EAST|OPF_T_F": {
    label: "CSAT (Pacific)", tag: "CSAT-P",
    roster: { sl: "O_T_Soldier_SL_F", tl: "O_T_Soldier_TL_F", rifle: "O_T_Soldier_F", ar: "O_T_Soldier_AR_F", gl: "O_T_Soldier_GL_F", lat: "O_T_Soldier_LAT_F", medic: "O_T_Medic_F", marksman: "O_T_Soldier_M_F", sniper: "O_T_Sniper_F", aa: "O_T_Soldier_AA_F", officer: "O_T_Officer_F", engineer: "O_T_Engineer_F", mg: "O_T_Soldier_HAT_F" },
  },
  "GUER|IND_F": {
    label: "AAF", tag: "AAF",
    roster: { sl: "I_Soldier_SL_F", tl: "I_Soldier_TL_F", rifle: "I_Soldier_F", ar: "I_Soldier_AR_F", gl: "I_Soldier_GL_F", lat: "I_Soldier_LAT_F", medic: "I_medic_F", marksman: "I_Soldier_M_F", sniper: "I_Sniper_F", aa: "I_Soldier_AA_F", officer: "I_officer_F", engineer: "I_engineer_F", mg: "I_Soldier_AR_F" },
  },
  "GUER|IND_G_F": {
    label: "FIA", tag: "FIA",
    roster: { sl: "I_G_Soldier_SL_F", tl: "I_G_Soldier_TL_F", rifle: "I_G_Soldier_F", ar: "I_G_Soldier_AR_F", gl: "I_G_Soldier_GL_F", lat: "I_G_Soldier_LAT_F", medic: "I_G_medic_F", marksman: "I_G_Soldier_M_F", sniper: "I_G_Sharpshooter_F", aa: "I_G_Soldier_LAT_F", officer: "I_G_officer_F", engineer: "I_G_engineer_F", mg: "I_G_Soldier_AR_F" },
  },
  /* The player default. These 8 recon classnames are a deliberately-chosen team and are
   * better than what role inference picks out of BLU_F. */
  "WEST|BLU_F": {
    label: "NATO", tag: "NATO",
    slots: ["B_recon_TL_F", "B_recon_M_F", "B_recon_LAT_F", "B_recon_medic_F", "B_recon_exp_F", "B_recon_JTAC_F", "B_recon_F", "B_recon_F"],
  },
};

/* A faction resolving fewer than this many of the 13 roles is dropped rather than
 * shipped as a squad of identical riflemen. */
const MIN_COVERAGE = 7;

/*
 * Where a faction genuinely has no unit for a role, prefer a near neighbour over the
 * generic rifleman fallback. PAVN, for instance, fields no squad leader or autorifleman
 * at all — an officer leading the squad beats a rifleman leading it, and the RPD gunner
 * is a better stand-in for the AR than another SKS rifleman.
 *
 * Applied after coverage is scored, so `c` keeps reporting directly-inferred roles and
 * the UI stays honest about how thin a roster really is. The runtime seam
 * (`roster[role] || roster.rifle`) is untouched — this only makes its input better.
 */
const ROLE_FALLBACK = {
  sl: ["officer", "tl"], tl: ["sl", "officer"], officer: ["sl", "tl"],
  ar: ["mg"], mg: ["ar"],
  marksman: ["sniper"], sniper: ["marksman"],
  aa: ["lat"], lat: ["aa"],
  gl: ["rifle"], medic: ["rifle"], engineer: ["rifle"],
};

function inferRole(entry) {
  const dn = entry.displayName;
  if (ROLE_EXCLUDE.test(dn) || ROLE_EXCLUDE.test(entry.classname)) return null;
  for (const [role, re] of ROLE_RULES) if (re.test(dn)) return role;
  for (const [role, re] of ROLE_RULES) if (re.test(entry.classname)) return role;
  return null;
}

function buildFactions() {
  const classes = JSON.parse(readFileSync(CLASSES_SRC, "utf8"));
  const infantry = classes.filter((e) =>
    e.side !== "UNKNOWN" && e.side !== "CIV" && e.category === "Infantry" && e.faction !== "Default");

  /* Arma classnames are case-insensitive in game, and the hand-written rosters do not
   * always match the dump's casing (O_soldier_LAT_F vs O_Soldier_LAT_F). Resolve case
   * insensitively or their addon requirements would be silently dropped. */
  const byLower = new Map();
  for (const e of classes) if (!byLower.has(e.classname.toLowerCase())) byLower.set(e.classname.toLowerCase(), e);
  const lookup = (cls) => byLower.get(cls.toLowerCase()) || null;

  const groups = new Map();
  for (const e of infantry) {
    const key = `${e.side}|${e.faction}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }

  const addonIndex = new Map();          // addon classname -> index in the shared table
  const addonTable = [];
  const idOf = (addon) => {
    if (!addonIndex.has(addon)) { addonIndex.set(addon, addonTable.length); addonTable.push(addon); }
    return addonIndex.get(addon);
  };

  const factions = [];
  const dropped = [];

  for (const [key, units] of [...groups].sort((a, b) => a[0].localeCompare(b[0], "en"))) {
    const [side, faction] = key.split("|");

    /* Role inference can pull a unit from a mod that merely adds to this faction —
     * BLU_F spans A3_Characters_F (64 units) but also RF_Characters and lxWS. Prefer
     * candidates from the faction's dominant addon so NATO does not come to require
     * Western Sahara. */
    const histogram = new Map();
    for (const u of units) {
      for (const a of u.addons) {
        if (COMPAT_ADDON.test(a)) continue;
        histogram.set(a, (histogram.get(a) || 0) + 1);
      }
    }
    const dominant = [...histogram].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "en"))[0]?.[0];

    const candidates = new Map();        // role -> entries
    for (const u of units) {
      const role = inferRole(u);
      if (!role) continue;
      if (!candidates.has(role)) candidates.set(role, []);
      candidates.get(role).push(u);
    }

    const roster = {};
    for (const role of ROLES) {
      const list = candidates.get(role);
      if (!list || !list.length) continue;
      const best = [...list].sort((a, b) => {
        const ad = a.addons.some((x) => x === dominant) ? 0 : 1;
        const bd = b.addons.some((x) => x === dominant) ? 0 : 1;
        if (ad !== bd) return ad - bd;                              // dominant addon wins
        const ac = a.addons.filter((x) => !COMPAT_ADDON.test(x)).length;
        const bc = b.addons.filter((x) => !COMPAT_ADDON.test(x)).length;
        if (ac !== bc) return ac - bc;                              // fewest requirements
        if (a.classname.length !== b.classname.length) return a.classname.length - b.classname.length;
        return a.classname.localeCompare(b.classname, "en");        // base over variants
      })[0];
      roster[role] = best.classname;
    }

    const verified = VERIFIED[key];
    if (verified?.roster) Object.assign(roster, verified.roster);

    const coverage = ROLES.filter((r) => roster[r]).length;
    if (!roster.rifle || coverage < MIN_COVERAGE) {
      dropped.push(`${key} (${coverage}/13)`);
      continue;
    }

    for (const [role, alternatives] of Object.entries(ROLE_FALLBACK)) {
      if (roster[role]) continue;
      const alt = alternatives.find((a) => roster[a]);
      if (alt) roster[role] = roster[alt];
    }

    /* Addon requirements, per classname rather than per faction: a faction-wide union
     * over-declares mods for roles a given mission never emits. */
    const addonsFor = {};
    const emitted = new Set([...Object.values(roster), ...(verified?.slots || [])]);
    const mods = new Set();
    for (const cls of emitted) {
      const entry = lookup(cls);
      if (!entry) {
        /* An inferred classname came from the dump so it always resolves. A verified one
         * that does not is a typo in the table above, and would emit a unit that fails to
         * spawn in game — fail the build rather than ship it. */
        if (verified) throw new Error(`${key}: hand-written classname "${cls}" is not in classes.json`);
        warn(`${key}: classname ${cls} is not in classes.json`);
        continue;
      }
      const needed = entry.addons.filter((a) => !COMPAT_ADDON.test(a));
      addonsFor[cls] = needed.map(idOf);
      for (const a of needed) {
        const tag = modTagFor(a);
        if (!tag) throw new Error(`addon "${a}" matches no MOD_TAGS rule — add one`);
        mods.add(tag.id);
      }
    }

    if (!FACTION_LABELS[faction]) warn(`${faction}: no display label, using "${prettyFaction(faction)}"`);

    const nonVanilla = [...mods].filter((m) => !MOD_TAGS.find((t) => t.id === m)?.vanilla);
    factions.push({
      k: key,
      s: EDEN_SIDE[side],
      n: verified?.label || FACTION_LABELS[faction] || prettyFaction(faction),
      t: verified?.tag || FACTION_LABELS[faction] || prettyFaction(faction),
      m: nonVanilla.length ? nonVanilla.sort()[0] : "vanilla",
      c: coverage,
      r: roster,
      a: addonsFor,
      ...(verified?.slots ? { p: verified.slots } : {}),
    });
  }

  return { factions, addonTable, dropped };
}

/* ==========================================================================
 * 3. Emit
 * ========================================================================== */

/* One element per line: a re-extraction rewrites thousands of lines inside the HTML,
 * and a readable diff is what keeps that survivable. Never minify. */
const j = JSON.stringify;

function emitWorlds(worlds) {
  return `var WORLD_DATA = [\n${worlds.map((w) =>
    ` {w:${j(w.w)},d:${j(w.d)},g:${j(w.g)},s:${w.s},l:[\n` +
    w.l.map((l) => `  [${j(l[0])},${j(l[1])},${l[2]},${l[3]},${l[4]}]`).join(",\n") +
    `\n ]}`).join(",\n")}\n];`;
}

function emitFactions({ factions, addonTable }) {
  return `var ADDONS = [\n${addonTable.map((a) => ` ${j(a)}`).join(",\n")}\n];\n\n` +
    `var FACTION_DATA = [\n${factions.map((f) =>
      ` {k:${j(f.k)},s:${j(f.s)},n:${j(f.n)},t:${j(f.t)},m:${j(f.m)},c:${f.c},\n` +
      `  r:${j(f.r)},\n` +
      (f.p ? `  p:${j(f.p)},\n` : "") +
      `  a:${j(f.a)}}`).join(",\n")}\n];`;
}

function emitMods() {
  return `var MOD_TAGS = {\n${MOD_TAGS.map((t) =>
    ` ${t.id}:{label:${j(t.label)},author:${j(t.author)},url:${j(t.url)}${t.vanilla ? ",vanilla:1" : ""}}`)
    .join(",\n")}\n};`;
}

function region(key, body) {
  return `/* >>> GENERATED: ${key} — do not edit; run: node tools/build-data.mjs <<< */\n` +
    `${body}\n` +
    `/* <<< END GENERATED: ${key} >>> */`;
}

function replaceRegion(html, key, body) {
  const re = new RegExp(
    `/\\* >>> GENERATED: ${key} [^\\n]*<<< \\*/\\n(?:[\\s\\S]*?\\n)?/\\* <<< END GENERATED: ${key} >>> \\*/`,
    "g");
  const hits = html.match(re);
  if (!hits) throw new Error(`${OUT}: no GENERATED region named "${key}"`);
  if (hits.length > 1) throw new Error(`${OUT}: GENERATED region "${key}" appears ${hits.length} times`);
  return html.replace(re, () => region(key, body));
}

/* ---- run ---- */

const worlds = buildWorlds();
const factionData = buildFactions();

let html = readFileSync(OUT, "utf8");
const before = html;
html = replaceRegion(html, "MOD_TAGS", emitMods());
html = replaceRegion(html, "WORLD_DATA", emitWorlds(worlds));
html = replaceRegion(html, "FACTION_DATA", emitFactions(factionData));

const locations = worlds.reduce((n, w) => n + w.l.length, 0);
const groups = [...new Set(worlds.map((w) => w.g))];

if (CHECK) {
  if (html !== before) {
    console.error("op-generator.html is stale — run: node tools/build-data.mjs");
    process.exit(1);
  }
  console.log(`op-generator.html is up to date (${worlds.length} worlds, ${factionData.factions.length} factions).`);
} else {
  writeFileSync(OUT, html);
  console.log(`Wrote op-generator.html`);
  console.log(`  ${worlds.length} worlds, ${locations} anchors, ${groups.length} groups`);
  console.log(`  ${factionData.factions.length} factions, ${factionData.addonTable.length} distinct addons`);
  console.log(`  ${factionData.dropped.length} factions dropped below ${MIN_COVERAGE}/13 coverage`);
  console.log(`  ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB total`);
}

if (warnings.length) {
  console.warn(`\n${warnings.length} warnings:`);
  for (const w of warnings.slice(0, 25)) console.warn(`  ! ${w}`);
  if (warnings.length > 25) console.warn(`  ... and ${warnings.length - 25} more`);
}
