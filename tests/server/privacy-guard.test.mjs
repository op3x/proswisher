// Larry memo 21 R5: fail if any log/console line in server code could carry a raw IP or user agent.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const files = ["server", "scripts"].flatMap((d) => fs.readdirSync(path.join(ROOT, d)).filter((f) => /\.(mjs|js)$/.test(f)).map((f) => path.join(d, f)));
const LOGCALL = /\b(console\.(log|warn|error|info|debug)|log)\s*\(/;
const RAW = /clientIp\s*\(|x-forwarded-for|remoteAddress|user-agent|\bip\b|consent_ip|req\.ip\b|req\.headers\s*\)/i;

test("R5: no log statement interpolates an IP, X-Forwarded-For, remoteAddress or User-Agent", () => {
  const hits = [];
  for (const f of files) {
    fs.readFileSync(path.join(ROOT, f), "utf8").split("\n").forEach((line, i) => {
      if (LOGCALL.test(line)) {
        const call = line.slice(line.search(LOGCALL));
        if (RAW.test(call)) hits.push(`${f}:${i + 1}: ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(hits, []);
});

test("R5: express/morgan-style request loggers are not installed", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  for (const bad of ["morgan", "pino-http", "express-winston"]) assert.ok(!(pkg.dependencies || {})[bad], bad);
});
