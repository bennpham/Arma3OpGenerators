#!/usr/bin/env node
/*
 * browser-test.mjs — drive op-generator.html in a real browser over file://.
 *
 * Half the multi-map work is UI: the world picker, the anchor rebuild, the grid scale
 * and the required-mods readout. None of that runs under the headless core harness in
 * smoke-test.mjs, and the property most worth protecting — that the tool works when
 * opened straight from disk with no server — can only be checked by actually doing it.
 *
 * Playwright is an optional dev dependency. The repository ships no package.json and is
 * dependency-free by design, so this exits 0 with a notice when Playwright is absent
 * rather than failing a check the repository never promised to satisfy.
 *
 *   npm i playwright && node tools/browser-test.mjs
 *
 * Usage: node tools/browser-test.mjs [--headed]
 */

import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PAGE = pathToFileURL(join(ROOT, "op-generator.html")).href;

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.log("Playwright is not installed — skipping the browser test.");
  console.log("  npm i playwright && node tools/browser-test.mjs");
  process.exit(0);
}

const failures = [];
let checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) failures.push(msg); };

/*
 * Prefer whatever browser Playwright resolves on its own. Where a Chromium is provisioned
 * separately from the npm package (a CI image with PLAYWRIGHT_BROWSERS_PATH set), the
 * build numbers can disagree and the default launch fails on a missing executable — fall
 * back to the provisioned binary rather than telling the user to re-download one.
 */
async function launch() {
  const headless = !process.argv.includes("--headed");
  try {
    return await chromium.launch({ headless });
  } catch (err) {
    const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
    if (!root) throw err;
    const { existsSync } = await import("node:fs");
    for (const candidate of [join(root, "chromium"), join(root, "chromium", "chrome")]) {
      if (existsSync(candidate)) {
        console.log(`Playwright's own browser is missing; using ${candidate}`);
        return chromium.launch({ headless, executablePath: candidate });
      }
    }
    throw err;
  }
}

const browser = await launch();
const page = await browser.newPage();

/* A console error on a page that generates a mission file is never benign. */
const consoleErrors = [];
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(`console: ${m.text()}`); });

await page.goto(PAGE);
await page.waitForTimeout(300);

const state = () => page.evaluate(() => ({
  world: document.querySelector("#worldTitle").textContent,
  suffix: document.querySelector("#worldSuffix").textContent,
  anchorKind: document.querySelector("#anchorKind").value,
  anchors: document.querySelectorAll("#anchor option").length,
  worlds: document.querySelectorAll("#world option").length,
  factions: document.querySelectorAll("#faction option").length,
  modRows: [...document.querySelectorAll("#mods li")].map((li) => li.textContent.trim()),
  addons: (document.querySelector("#sqm").value.match(/^\t"[A-Za-z0-9_]+",?$/gm) || [])
    .map((s) => s.trim().replace(/[",]/g, "")),
  sqm: document.querySelector("#sqm").value.length,
}));

const selectWorld = async (worldName) => {
  const index = await page.evaluate((w) =>
    [...document.querySelectorAll("#world option")].findIndex((o) => o.textContent.includes(w)),
    worldName);
  if (index < 0) throw new Error(`world not in picker: ${worldName}`);
  await page.selectOption("#world", { index });
  await page.waitForTimeout(120);
};

/* ---- initial load ---- */
const first = await state();
ok(first.worlds >= 56, `world picker lists every world (got ${first.worlds})`);
ok(first.factions >= 80, `faction picker lists every faction (got ${first.factions})`);
ok(first.world === "Altis", "opens on Altis");
ok(first.sqm > 1000, "generates a mission on load");
ok(first.addons.length > 0 && first.addons.every((a) => !/^(ace_|cba_|zen_)/i.test(a)),
  "a vanilla mission declares no compat addons");

/* ---- a modded world and modded factions on both sides ---- */
await selectWorld("Khe Sanh");
await page.selectOption("#faction", "EAST|O_PAVN");
await page.selectOption("#pfaction", "WEST|CUP_B_USMC");
await page.waitForTimeout(150);
const sog = await state();
ok(sog.suffix === "vn_khe_sanh", `save-folder suffix follows the world (got ${sog.suffix})`);
ok(sog.addons.includes("characters_f_vietnam_c"), "declares the S.O.G. character addon");
ok(sog.addons.some((a) => a.startsWith("CUP_")), "declares the CUP addon for the player faction");
ok(sog.modRows.some((r) => r.includes("S.O.G.")), "mod readout names S.O.G. Prairie Fire");
ok(sog.modRows.some((r) => r.includes("CUP")), "mod readout names CUP");

/* ---- a world with no hills must not claim a hill filter ---- */
await selectWorld("SPEX_Lingevres");
await page.selectOption("#anchorKind", "hill");
await page.waitForTimeout(120);
const small = await state();
ok(small.anchorKind === "settle", "anchor kind falls back to settlements where no hills exist");
ok(small.anchors > 0, "small world still offers an anchor");

/* ---- rolling repeatedly must not desync the anchor index ---- */
await selectWorld("Altis");
for (let i = 0; i < 12; i++) await page.click("#roll");
await page.waitForTimeout(200);
const rolled = await page.evaluate(() => {
  const sel = document.querySelector("#anchor");
  return {
    label: sel.options[sel.selectedIndex]?.textContent || "",
    shown: document.querySelector("#anchorName").textContent,
    sqm: document.querySelector("#sqm").value.length,
  };
});
ok(rolled.label.includes(rolled.shown),
  `rolled anchor select matches the plate readout (${rolled.label} vs ${rolled.shown})`);
ok(rolled.sqm > 1000, "still generating after repeated rolls");

/* ---- every world must render and generate ---- */
for (let i = 0; i < first.worlds; i++) {
  await page.selectOption("#world", { index: i });
}
await page.waitForTimeout(200);
const last = await state();
ok(last.sqm > 1000, "every world in sequence still generates");

ok(consoleErrors.length === 0, `no console errors (got ${consoleErrors.length}: ${consoleErrors[0] || ""})`);

await browser.close();

if (failures.length) {
  console.error(`FAILED — ${failures.length} of ${checks} checks:\n`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`OK — ${checks} browser checks passed across ${first.worlds} worlds.`);
