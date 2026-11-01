// Larry/Ryan 10/31 10:23 PM: basketball comes later, so user-visible copy is sport-neutral ("game start", not
// "kickoff" or "tip-off"). Fails on "tip-off", "tip time", "NBA" or "kickoff" anywhere a visitor can read it:
// site/commerce config, legal + content markdown, pages and components (string literals and JSX text), index.html,
// the webmanifest, and the server's user-facing strings (server-rendered pages and API messages).
// Not scanned: code comments, log lines, identifiers (tipTime, homeCourt, g.kickoff), and the simulator's play-by-play
// event names (server/sim, the football "kickoff" PLAY type, a football play, not a game-start time).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const BANNED = /tip-?off|tip[ -]time|\bNBA\b|\bkick-?off/i;
const ls = (d, re) => fs.readdirSync(path.join(ROOT, d)).filter((f) => re.test(f)).map((f) => path.join(d, f));

const stripComments = (s) => s
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")                      // {/* JSX comments */}
  .replace(/\/\*[\s\S]*?\*\//g, "")                         // /* block comments */
  .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");                 // // line comments (not https://)
const dropLogs = (s) => s.split("\n").filter((l) => !/\b(console\.(log|warn|error)|log)\(/.test(l)).join("\n");
// string literals + JSX text: the parts of a code file a visitor can actually see
function visibleStrings(code, jsx) {
  const out = [];
  for (const m of code.matchAll(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g)) out.push(m[0]);
  if (jsx) for (const m of code.matchAll(/>([^<>]+)</g)) out.push(m[1].replace(/\{[^{}]*\}/g, " ")); // JSX text, {expressions} removed
  return out;
}
export function violations(file, text) {
  const code = /\.(m?js|tsx?)$/.test(file);
  const bits = code ? visibleStrings(dropLogs(stripComments(text)), /\.tsx$/.test(file)) : text.split("\n");
  return bits.filter((b) => BANNED.test(b)).map((b) => `${file}: ${b.trim().slice(0, 140)}`);
}

const FILES = [
  "src/config/site.ts", "src/config/commerce.json", "index.html", "public/site.webmanifest",
  ...ls("src/content", /\.md$/), ...ls("src/pages", /\.tsx$/), ...ls("src/components", /\.tsx$/),
  ...ls("server", /\.mjs$/), ...ls("server/football", /\.mjs$/),
].filter((f) => fs.existsSync(path.join(ROOT, f)));

test("no tip-off / tip time / NBA / kickoff in user-visible copy (use 'game start', 'game', 'team')", () => {
  const bad = FILES.flatMap((f) => violations(f, fs.readFileSync(path.join(ROOT, f), "utf8")));
  assert.deepEqual(bad, []);
});

test("the guard itself catches each banned word and ignores comments, logs and identifiers", () => {
  for (const s of ['x = "Tip-off 7:00 CT";', "<div>Kickoff {t} CT</div>", 'm = "posted before tipoff"', 'a = "Tip time"', 't = "Lakers | NBA |"'])
    assert.equal(violations("x.tsx", s).length, 1, s);
  for (const s of ["// before tip-off", "/* NBA */", "{/* kickoff */}", "const k = g.kickoff; const t = g.tipTime;", 'log("legacy NBA pipeline off");'])
    assert.equal(violations("x.mjs", s).length, 0, s);
  assert.equal(violations("terms.md", "We post before kickoff.").length, 1);
  assert.equal(violations("terms.md", "We post before game start.").length, 0);
});
