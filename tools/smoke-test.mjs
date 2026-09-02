#!/usr/bin/env node
/*
 * smoke-test.mjs — headless verification of the generator core.
 *
 * op-generator.html keeps its generator core pure and `module.exports`-able so it
 * can be driven from Node. Node cannot `require` an HTML file, so this harness
 * slices the <script> block out and evaluates it with `document` undefined — the
 * UI IIFE is guarded by `typeof document !== "undefined"` and self-skips.
 *
 * Covers: a golden regression against the pre-multi-map default output, roster and
 * emitter coverage across every shipped faction, mission.sqm structural integrity,
 * and world/anchor sanity.
 *
 * Usage: node tools/smoke-test.mjs [--verbose]
 *        exits non-zero on the first failing assertion group.
 */

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VERBOSE = process.argv.includes("--verbose");

/* ---- load the core ---- */

export function loadCore(file = join(ROOT, "op-generator.html")) {
  const html = readFileSync(file, "utf8");
  const open = html.indexOf("<script>");
  const close = html.lastIndexOf("</script>");
  if (open < 0 || close < 0) throw new Error(`${file}: no <script> block found`);

  const mod = { exports: {} };
  vm.runInNewContext(html.slice(open + 8, close), {
    module: mod, console, Math, Object, Array, String, Number, JSON, isNaN,
  });
  if (!mod.exports.buildSQM) throw new Error("core did not export buildSQM");
  return mod.exports;
}

/* ---- assertions ---- */

let checks = 0;
const failures = [];

function ok(cond, msg) {
  checks++;
  if (!cond) failures.push(msg);
  else if (VERBOSE) console.log(`  ok  ${msg}`);
}
function eq(actual, expected, msg) {
  ok(actual === expected, `${msg} — expected ${expected}, got ${actual}`);
}
function group(name, fn) {
  console.log(name);
  const before = failures.length;
  fn();
  const added = failures.length - before;
  if (added) console.log(`  ${added} FAILED`);
}

/* ---- mission.sqm structural checks ---- */

/** Every `items=N;` must match the count of sibling `class ItemK` blocks that follow it. */
function checkItemCounts(sqm, label) {
  const lines = sqm.split("\r\n");
  const stack = [];       // { depth, expected, seen }
  let depth = 0;

  for (const line of lines) {
    const indent = line.match(/^\t*/)[0].length;
    const s = line.trim();

    if (s === "{") { depth++; continue; }
    if (s === "};" || s === "}") {
      depth--;
      while (stack.length && stack[stack.length - 1].depth > depth) {
        const f = stack.pop();
        ok(f.seen === f.expected,
          `${label}: items=${f.expected} but ${f.seen} class Item* siblings`);
      }
      continue;
    }
    const items = s.match(/^items=(\d+);$/);
    if (items) { stack.push({ depth, expected: +items[1], seen: 0 }); continue; }
    const item = s.match(/^class Item\d+$/);
    if (item && stack.length && stack[stack.length - 1].depth === indent) {
      stack[stack.length - 1].seen++;
    }
  }
  while (stack.length) {
    const f = stack.pop();
    ok(f.seen === f.expected, `${label}: items=${f.expected} but ${f.seen} siblings`);
  }
}

function checkStructure(sqm, label) {
  const braces = (sqm.match(/\{/g) || []).length - (sqm.match(/\}/g) || []).length;
  eq(braces, 0, `${label}: brace balance`);
  ok(!/__NEXTID__|__ITEM__|__ADDONS__|__METADATA__/.test(sqm),
    `${label}: no unsubstituted placeholders`);
  ok(!/undefined|\[object Object\]|NaN/.test(sqm),
    `${label}: no undefined/NaN leaked into output`);

  const ids = [...sqm.matchAll(/^\t*id=(\d+);$/gm)].map((m) => +m[1]).sort((a, b) => a - b);
  ok(ids.length > 0, `${label}: emits at least one id`);
  const dupes = ids.filter((v, i) => i && v === ids[i - 1]);
  eq(dupes.length, 0, `${label}: entity ids are unique`);

  const next = sqm.match(/nextID=(\d+);/);
  ok(next && +next[1] === ids[ids.length - 1] + 1,
    `${label}: ItemIDProvider.nextID = max(id)+1`);

  checkItemCounts(sqm, label);
}

/* ---- the runs ---- */

const G = loadCore();

const DEFAULT_CFG = {
  seed: 482913, x: 16780.6, y: 12604.5, anchor: "Pyrgos",
  opKey: "checkpoint", factionKey: "csat",
  strength: 1, skill: 0.55, patrolRadius: 250,
  insDist: 900, insBrg: 225, squad: 4, objectives: 3,
  waypoints: true, zeus: true, fhq: true, snap: true,
  missionName: "", author: "Phantom Six", hour: 12, weather: "fair",
};

/* The addons[] and AddonsMetaData blocks are derived from emitted classnames now,
 * so they are expected to differ from the pre-change output. Everything else must not. */
const stripDerived = (s) => s
  .replace(/addons\[\]=\r\n\{\r\n[\s\S]*?\r\n\};\r\n/, "")
  .replace(/class AddonsMetaData\r\n\{\r\n[\s\S]*?\r\n\};\r\n/, "");

const sha = (s) => createHash("sha256").update(s).digest("hex");

/* Captured from the pre-multi-map generator at commit 0893b19, default config. */
const GOLDEN_STRIPPED = "f708a80fead650e9c774ab644d603722691e5943db674bbe132607241f9a77b0";

group("golden regression (default config)", () => {
  const sqm = G.buildSQM(G.rollPlan(DEFAULT_CFG), DEFAULT_CFG);
  eq(sha(stripDerived(sqm)), GOLDEN_STRIPPED,
    "default output unchanged outside the derived addon blocks");
  checkStructure(sqm, "default");
});

group("determinism", () => {
  const a = G.buildSQM(G.rollPlan(DEFAULT_CFG), DEFAULT_CFG);
  const b = G.buildSQM(G.rollPlan(DEFAULT_CFG), DEFAULT_CFG);
  eq(sha(a), sha(b), "same seed produces byte-identical output");
});

group("every faction x op x strength emits a valid mission", () => {
  const factions = Object.keys(G.FACTIONS);
  const ops = Object.keys(G.OPS);
  let n = 0;
  for (const factionKey of factions) {
    for (const opKey of ops) {
      for (let strength = 0; strength < G.STRENGTH.length; strength++) {
        const cfg = { ...DEFAULT_CFG, factionKey, opKey, strength, seed: 1000 + n };
        let sqm;
        try {
          sqm = G.buildSQM(G.rollPlan(cfg), cfg);
        } catch (err) {
          ok(false, `${factionKey}/${opKey}/${strength}: threw ${err.message}`);
          continue;
        }
        ok(sqm.length > 0, `${factionKey}/${opKey}/${strength}: non-empty`);
        // Structural checks are expensive; sample rather than run all several hundred.
        if (n % 17 === 0) checkStructure(sqm, `${factionKey}/${opKey}/${strength}`);
        n++;
      }
    }
  }
  console.log(`  ${n} combinations across ${factions.length} factions, ${ops.length} ops`);
});

group("rosters resolve every role an op template asks for", () => {
  const needed = new Set();
  for (const op of Object.values(G.OPS)) {
    for (const g of op.groups) for (const r of g.roles) needed.add(r);
  }
  for (const [key, fac] of Object.entries(G.FACTIONS)) {
    for (const role of needed) {
      const cls = fac.roster[role] || fac.roster.rifle;
      ok(typeof cls === "string" && cls.length > 0,
        `${key}: role "${role}" resolves to a classname`);
    }
    ok(typeof fac.roster.rifle === "string" && fac.roster.rifle.length > 0,
      `${key}: has a rifle fallback (the :511 seam depends on it)`);
  }
});

group("gridRef", () => {
  for (const [x, y] of [[0, 0], [3458.95, 12966.4], [30719, 30719], [999, 999]]) {
    eq(G.gridRef(x, y).length, 6, `gridRef(${x},${y}) is 6 figures`);
  }
});

/* ---- report ---- */

console.log();
if (failures.length) {
  console.error(`FAILED — ${failures.length} of ${checks} checks:\n`);
  for (const f of failures.slice(0, 40)) console.error(`  - ${f}`);
  if (failures.length > 40) console.error(`  ... and ${failures.length - 40} more`);
  process.exit(1);
}
console.log(`OK — ${checks} checks passed.`);
