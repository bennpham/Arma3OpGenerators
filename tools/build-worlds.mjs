#!/usr/bin/env node
/*
 * build-worlds.mjs — normalize the raw CfgWorlds dump into valid JSON.
 *
 * Input : docs/json/worldLocation.json  (raw extractor output; NOT valid JSON —
 *         one JSON array per line, each preceded by a `// group name` comment)
 * Output: docs/json/worlds.json         (a single valid JSON array; each world
 *         gains a `group` field carrying its `//` header)
 *
 * The raw dump is the source of truth and is never modified. This output is a
 * derived, regenerable artifact — do not hand-edit it. Deterministic and
 * idempotent: re-running on an unchanged input reproduces the file byte for byte.
 *
 * Usage: node tools/build-worlds.mjs [--check]
 *        --check  verify the committed output matches a fresh build (CI-friendly);
 *                 exits non-zero on drift, writes nothing.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "docs/json/worldLocation.json");
const OUT = join(ROOT, "docs/json/worlds.json");

/**
 * Parse the line-oriented dump. Blank lines are skipped; a `//` line sets the
 * group label applied to every world on the following array lines.
 */
export function parseWorldLocationDump(text) {
  const worlds = [];
  let group = null;

  text.split(/\r?\n/).forEach((line, i) => {
    const s = line.trim();
    if (s === "") return;
    if (s.startsWith("//")) { group = s.slice(2).trim(); return; }
    if (!s.startsWith("[")) {
      throw new Error(`line ${i + 1}: expected a JSON array, a // comment, or a blank line`);
    }
    let arr;
    try {
      arr = JSON.parse(s);
    } catch (err) {
      throw new Error(`line ${i + 1}: ${err.message}`);
    }
    if (!Array.isArray(arr)) throw new Error(`line ${i + 1}: expected an array`);
    for (const w of arr) worlds.push({ group, ...w });
  });

  return worlds;
}

const worlds = parseWorldLocationDump(readFileSync(SRC, "utf8"));
const json = JSON.stringify(worlds, null, 1) + "\n";

const locations = worlds.reduce((n, w) => n + w.locations.length, 0);
const groups = [...new Set(worlds.map((w) => w.group))];

if (process.argv.includes("--check")) {
  const current = readFileSync(OUT, "utf8");
  if (current !== json) {
    console.error("docs/json/worlds.json is stale — run: node tools/build-worlds.mjs");
    process.exit(1);
  }
  console.log(`worlds.json up to date (${worlds.length} worlds, ${locations} locations)`);
} else {
  writeFileSync(OUT, json);
  console.log(`wrote docs/json/worlds.json — ${worlds.length} worlds, ${locations} locations, ${groups.length} groups`);
  for (const g of groups) {
    const ws = worlds.filter((w) => w.group === g);
    const n = ws.reduce((a, w) => a + w.locations.length, 0);
    console.log(`  ${String(ws.length).padStart(3)} worlds  ${String(n).padStart(5)} locations  ${g}`);
  }
}
