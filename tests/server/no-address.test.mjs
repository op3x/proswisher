// Ryan 10/31: no physical/mailing address anywhere on the site; contact is email only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["src", "server", "legal", "docs", "index.html", "README.md", ".env.example"];
const BAD = /mailing address|MAILING[_ ]ADDRESS|LEGAL[_ ]ADDRESS|physical address|P\.?\s?O\.? Box|\[address\]|mailingAddress/i;
const files = (p) => statSync(p).isDirectory() ? readdirSync(p).flatMap((f) => files(join(p, f))) : [p];

test("no street or mailing address (or placeholder) in site source, legal text or docs", () => {
  const hits = [];
  for (const r of ROOTS) for (const f of files(r)) {
    if (!/\.(tsx?|mjs|js|json|md|html|example)$/.test(f) && !f.endsWith(".env.example")) continue;
    readFileSync(f, "utf8").split("\n").forEach((l, i) => { if (BAD.test(l) && !/no physical address|physical address comes later|no (street|mailing|physical)/i.test(l)) hits.push(`${f}:${i + 1}: ${l.trim().slice(0, 120)}`); });
  }
  assert.deepEqual(hits, []);
});
