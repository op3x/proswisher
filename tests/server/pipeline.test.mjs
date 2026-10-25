// First data run: dir resolution (/tmp fallback without a volume), graceful skips (no keys, no python3, refusal),
// and an end-to-end dry run (synthetic fixtures) after which game pages and /data render from the pipeline output.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { createApp } from "../../server/index.mjs";
import { resolveDataDirs, createPipeline } from "../../server/pipeline.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "psw-pipe-"));
const serve = async (app) => { const srv = app.listen(0); await new Promise((r) => srv.once("listening", r)); return { url: `http://127.0.0.1:${srv.address().port}`, close: () => srv.close() }; };
const fakeSpawn = (code) => { const calls = []; const fn = (cmd, args, opts) => { calls.push({ cmd, args, opts }); const c = new EventEmitter(); setImmediate(() => c.emit("exit", code, null)); return c; }; fn.calls = calls; return fn; };

test("no volume: falls back to ephemeral /tmp and says so; Railway dirs only count when on the mounted volume", () => {
  const base = tmp(), logs = [];
  let d = resolveDataDirs({}, (m) => logs.push(m), base);
  assert.equal(d.publicDir, path.join(base, "public-data")); assert.equal(d.privateDir, path.join(base, "private-data")); assert.ok(d.ephemeral);
  assert.ok(logs.some((l) => /PUBLIC_DATA_DIR not set: using ephemeral .*lost on every redeploy/.test(l)));
  logs.length = 0;   // Railway, dirs set, but no volume attached -> still /tmp
  d = resolveDataDirs({ RAILWAY_ENVIRONMENT: "preview", PUBLIC_DATA_DIR: path.join(base, "v/public"), PREDICTIONS_PRIVATE_DIR: path.join(base, "v/private") }, (m) => logs.push(m), base);
  assert.ok(d.ephemeral); assert.ok(logs.some((l) => /is not on a mounted volume: using ephemeral/.test(l)));
  logs.length = 0;   // Railway with a volume mounted at base/v -> uses it
  d = resolveDataDirs({ RAILWAY_ENVIRONMENT: "preview", RAILWAY_VOLUME_MOUNT_PATH: path.join(base, "v"), PUBLIC_DATA_DIR: path.join(base, "v/public"), PREDICTIONS_PRIVATE_DIR: path.join(base, "v/private") }, (m) => logs.push(m), base);
  assert.equal(d.ephemeral, false); assert.equal(d.publicDir, path.join(base, "v/public")); assert.ok(logs.some((l) => /data dirs on volume/.test(l)));
  // dry run never touches the volume, and is ignored in production
  assert.ok(resolveDataDirs({ PIPELINE_DRY_RUN: "true", RAILWAY_VOLUME_MOUNT_PATH: "/data" }, () => {}).publicDir.startsWith("/tmp/proswisher-dryrun"));
  assert.equal(resolveDataDirs({ PIPELINE_DRY_RUN: "true", APP_ENV: "production" }, () => {}, base).dryRun, false);
  fs.rmSync(base, { recursive: true });
});

test("missing keys: one clear log line, no spawn, no crash, no repeat timer", async () => {
  const logs = [], spawn = fakeSpawn(0);
  const p = createPipeline({ env: {}, dirs: { publicDir: "/x", privateDir: "/y" }, log: (m) => logs.push(m), spawn });
  const r = await p.start();
  assert.equal(r.result, "skipped-no-key"); assert.equal(spawn.calls.length, 0);
  assert.match(logs[0], /^\[pipeline\] python3 (available: Python 3|is NOT available)/);
  assert.deepEqual(logs.slice(1), ["[pipeline] skipped: BALLDONTLIE_API_KEY is not set, so no games were fetched (set it in Railway to enable)"]);
});

test("python3 missing: logs it and resolves (server keeps running)", async () => {
  const logs = [];
  const p = createPipeline({ env: { BALLDONTLIE_API_KEY: "x" }, dirs: { publicDir: "/x", privateDir: "/y" }, log: (m) => logs.push(m), python: "psw-no-such-python" });
  const r = await p.run();
  assert.equal(r.result, "no-python"); assert.ok(logs.some((l) => /psw-no-such-python is not installed in this image/.test(l)));
});

test("child gets a minimal env (keys + dirs only, no Stripe/admin secrets); keys never logged; refusal stops the schedule", async () => {
  const logs = [], spawn = fakeSpawn(3);
  const env = { BALLDONTLIE_API_KEY: "bdl-fixture-key", ODDS_API_KEY: "odds-fixture-key", STRIPE_SECRET_KEY: "fixture-stripe", ADMIN_TOKEN: "fixture-admin", PATH: process.env.PATH, PIPELINE_INTERVAL_MIN: "30" };
  const p = createPipeline({ env, dirs: { publicDir: "/pub", privateDir: "/priv" }, log: (m) => logs.push(m), spawn });
  const r = await p.start();
  const ce = spawn.calls[0].opts.env;
  assert.equal(ce.PUBLIC_DATA_DIR, "/pub"); assert.equal(ce.PREDICTIONS_PRIVATE_DIR, "/priv"); assert.equal(ce.BALLDONTLIE_API_KEY, "bdl-fixture-key");
  assert.equal(ce.STRIPE_SECRET_KEY, undefined); assert.equal(ce.ADMIN_TOKEN, undefined);
  assert.equal(r.result, "blocked"); assert.equal(p.status().stopped, true);
  assert.equal((await p.run()).result, "stopped");
  assert.ok(!logs.join("\n").includes("fixture-key"));
});

test("dry run end to end: game pages, /data and the member gate all render from the pipeline output", async () => {
  const base = tmp();
  const dirs = { publicDir: path.join(base, "public"), privateDir: path.join(base, "private"), dryRun: true, ephemeral: true };
  const logs = [];
  const env = { APP_ENV: "preview", PATH: process.env.PATH, HOME: process.env.HOME };
  const p = createPipeline({ env, dirs, log: (m) => logs.push(m) });
  const r = await p.run();
  assert.equal(r.result, "ok", logs.join("\n"));
  const app = await createApp({ env: { APP_ENV: "preview", PUBLIC_DATA_DIR: dirs.publicDir, PREDICTIONS_PRIVATE_DIR: dirs.privateDir }, geoLookup: null, log: () => {} });
  const s = await serve(app);
  try {
    const pub = await (await fetch(s.url + "/data/games.json")).json();
    assert.equal(pub.provider, "fixture"); assert.ok(pub.dryRun);
    const list = Object.values(pub.games);
    assert.ok(list.length >= 20);
    const priv = JSON.parse(fs.readFileSync(path.join(dirs.privateDir, "games-full.json"), "utf8")).games;
    const hidden = Object.keys(priv).filter((id) => priv[id].prediction && !pub.games[id].prediction);
    assert.ok(hidden.length > 0, "member-only predictions exist");
    const predsPub = await (await fetch(s.url + "/data/predictions.json")).json();
    for (const id of hidden) { assert.equal(predsPub.entries[id], undefined); assert.ok(predsPub.sealed[id]?.commitment); }
    // every game (upcoming, featured, final) has a working canonical page with its server-side SEO title
    for (const g of [list.find((x) => x.prediction), list.find((x) => x.final), pub.games[hidden[0]]]) {
      const day = new Date(g.date).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
      const slug = `${g.away.short}-vs-${g.home.short}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      for (const u of [`/games/${day}/${slug}`, `/game/${g.id}`]) {
        const res = await fetch(s.url + u); const html = await res.text();
        assert.equal(res.status, 200, u);
        const title = /<title>([^<]*)<\/title>/.exec(html)[1];
        assert.ok(title.includes(g.away.short) && title.includes(g.home.short), `${u}: ${title}`);
      }
    }
    assert.equal((await fetch(s.url + "/api/predictions")).status, 200);   // payments off -> nothing leaks
    assert.deepEqual((await (await fetch(s.url + "/api/predictions")).json()).predictions, {});
    assert.equal((await fetch(s.url + "/data/games-full.json")).status, 404);
  } finally { s.close(); fs.rmSync(base, { recursive: true }); }
});

test("the committed public/data skeletons hold no games, picks or lines", () => {
  const dir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../public/data");
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    for (const k of ["games", "entries", "sealed"]) if (j[k]) assert.equal(Object.keys(j[k]).length, 0, `${f}.${k}`);
    assert.ok(!/fixture|dryRun|homeLine/.test(JSON.stringify(j)), f);
  }
});
