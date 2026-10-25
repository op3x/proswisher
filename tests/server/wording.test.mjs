// Larry memo 23 §6: the only relationship wording is "ProSwisher is operated by Op3x LLC."
// (phrase form: "Op3x LLC, which operates ProSwisher"). Any other phrasing fails.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const walk = (d) => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(path.join(d, e.name)) : /\.(md|ts|tsx|json|mjs|html)$/.test(e.name) ? [path.join(d, e.name)] : []);
const files = [...walk("src"), ...walk("server"), "README.md", "index.html"];
const OK = ["ProSwisher is operated by Op3x LLC.", "Op3x LLC, which operates ProSwisher"];
const REL = /operated by|which operates|operator of|run by|owned by|a (product|service|brand) of|operates ProSwisher/gi;

test("relationship wording is exactly Larry's (memo 23 §6)", () => {
  const bad = [];
  for (const f of files) {
    const s = fs.readFileSync(path.join(ROOT, f), "utf8");
    for (const m of s.matchAll(REL)) {
      const ctx = s.slice(Math.max(0, m.index - 40), m.index + 60);
      if (!OK.some((ok) => ctx.includes(ok))) bad.push(`${f}: …${ctx.replace(/\s+/g, " ")}…`);
    }
  }
  assert.deepEqual(bad, []);
});

test("the sentence appears in the footer, contact page, terms and privacy, and README", () => {
  assert.match(fs.readFileSync(path.join(ROOT, "src/config/site.ts"), "utf8"), /operatedBy: "ProSwisher is operated by Op3x LLC\."/);
  for (const f of ["src/components/Layout.tsx", "src/pages/Contact.tsx"]) assert.match(fs.readFileSync(path.join(ROOT, f), "utf8"), /site\.operatedBy/, f);
  for (const f of ["src/content/terms-v1.md", "src/content/privacy-a.md", "src/content/privacy-b.md", "README.md"])
    assert.ok(fs.readFileSync(path.join(ROOT, f), "utf8").includes(OK[0]), f);
  assert.ok(fs.readFileSync(path.join(ROOT, "src/config/site.ts"), "utf8").includes(`"${OK[0]} These terms govern`)); // short Terms stub
});
