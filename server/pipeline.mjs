// Server-side data pipeline runner (Larry P6, memo 20). Runs scripts/update_data.py on start and every
// PIPELINE_INTERVAL_MIN minutes. Never crashes the web server: missing keys, a missing python3 and source refusals
// all end in one clear log line. Keys are never logged; the child gets a minimal env (no Stripe or admin secrets).
import fs from "node:fs";
import path from "node:path";
import { spawn as nodeSpawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const TMP_BASE = "/tmp/proswisher";
const DRY_BASE = "/tmp/proswisher-dryrun";
const truthy = (v) => /^(1|true|yes)$/i.test(String(v || ""));

const writable = (d) => { try { fs.mkdirSync(d, { recursive: true }); fs.accessSync(d, fs.constants.W_OK); return true; } catch { return false; } };
const under = (d, base) => !!base && (path.resolve(d) + "/").startsWith(path.resolve(base) + "/");

// Decide where data lives. On Railway, a dir only counts as persistent if it sits under the attached volume
// (RAILWAY_VOLUME_MOUNT_PATH); otherwise, or if unset/unwritable, fall back to ephemeral /tmp and say so.
export function resolveDataDirs(env = process.env, log = console.log, tmpBase = TMP_BASE) {
  if (truthy(env.PIPELINE_DRY_RUN) && env.APP_ENV !== "production") {
    const d = { publicDir: path.join(DRY_BASE, "public"), privateDir: path.join(DRY_BASE, "private"), ephemeral: true, dryRun: true };
    log(`[pipeline] DRY RUN: synthetic fixture data in ephemeral ${DRY_BASE} (never the volume)`);
    return d;
  }
  const onRailway = !!(env.RAILWAY_ENVIRONMENT || env.RAILWAY_ENVIRONMENT_NAME || env.RAILWAY_SERVICE_ID);
  const vol = env.RAILWAY_VOLUME_MOUNT_PATH || "";
  const pick = (name, fallback) => {
    const want = env[name] || "";
    if (want && (!onRailway || under(want, vol)) && writable(want)) return { dir: want, persistent: true };
    const why = !want ? "not set" : onRailway && !under(want, vol) ? `${want} is not on a mounted volume` : `${want} is not writable`;
    writable(fallback);
    log(`[pipeline] ${name} ${why}: using ephemeral ${fallback} (data is lost on every redeploy/restart; attach a volume)`);
    return { dir: fallback, persistent: false };
  };
  const pub = pick("PUBLIC_DATA_DIR", path.join(tmpBase, "public-data"));
  const priv = pick("PREDICTIONS_PRIVATE_DIR", path.join(tmpBase, "private-data"));
  if (pub.persistent && priv.persistent) log(`[pipeline] data dirs on volume: public=${pub.dir} private=${priv.dir}`);
  return { publicDir: pub.dir, privateDir: priv.dir, ephemeral: !(pub.persistent && priv.persistent), dryRun: false };
}

const CHILD_ENV = ["PATH", "HOME", "LANG", "TZ", "APP_ENV", "BALLDONTLIE_API_KEY", "ODDS_API_KEY", "SCHEDULE_PROVIDER", "ODDS_PROVIDER"];

export function createPipeline({ env = process.env, dirs, log = console.log, onDone = () => {}, spawn = nodeSpawn,
  python = env.PIPELINE_PYTHON || "python3", script = path.join(ROOT, "scripts/update_data.py") } = {}) {
  let running = null, stopped = false, timer = null, warnedOdds = false;
  const status = { runs: 0, last: null, running: false, stopped: false, dryRun: !!dirs.dryRun, ephemeral: !!dirs.ephemeral };
  const finish = (result, extra = {}) => { status.last = { result, at: new Date().toISOString(), ...extra }; status.running = false; running = null; return status.last; };

  function run() {
    if (running) return running;
    if (stopped) return Promise.resolve(finish("stopped"));
    if (!dirs.dryRun && !env.BALLDONTLIE_API_KEY) {
      log("[pipeline] skipped: BALLDONTLIE_API_KEY is not set, so no games were fetched (set it in Railway to enable)");
      return Promise.resolve(finish("skipped-no-key"));
    }
    if (!dirs.dryRun && !env.ODDS_API_KEY && !warnedOdds) { warnedOdds = true; log("[pipeline] ODDS_API_KEY is not set: picks are logged without a market spread (Winner grading only, no ATS)"); }
    status.running = true; status.runs += 1;
    const childEnv = Object.fromEntries(CHILD_ENV.filter((k) => env[k] != null).map((k) => [k, env[k]]));
    Object.assign(childEnv, { PUBLIC_DATA_DIR: dirs.publicDir, PREDICTIONS_PRIVATE_DIR: dirs.privateDir, PIPELINE_RUNNER: "server",
      ...(dirs.dryRun ? { PIPELINE_DRY_RUN: "true" } : {}) });
    const t0 = Date.now();
    log(`[pipeline] run #${status.runs} started${dirs.dryRun ? " (dry run)" : ""}`);
    running = new Promise((resolve) => {
      let child;
      try { child = spawn(python, [script], { env: childEnv, stdio: ["ignore", "inherit", "inherit"] }); }
      catch (e) { log(`[pipeline] not run: could not start ${python} (${e.code || e.name})`); return resolve(finish("no-python")); }
      child.on("error", (e) => {
        log(e.code === "ENOENT" ? `[pipeline] not run: ${python} is not installed in this image` : `[pipeline] not run: ${e.code || e.name}`);
        resolve(finish(e.code === "ENOENT" ? "no-python" : "error"));
      });
      child.on("exit", (code, sig) => {
        const ms = Date.now() - t0;
        if (code === 0) { log(`[pipeline] run #${status.runs} finished OK in ${Math.round(ms / 1000)}s`); try { onDone(); } catch {} return resolve(finish("ok", { ms })); }
        if (code === 3) { // memo 20: a source refused us -> stop and report, never retry another way
          stopped = true; status.stopped = true; if (timer) clearInterval(timer);
          log("[pipeline] STOPPED: a data source refused access (see BLOCKED line above). Not retrying until the next deploy.");
          return resolve(finish("blocked", { code }));
        }
        log(`[pipeline] run #${status.runs} failed (exit ${code ?? sig}); previous data kept, will retry next interval`);
        resolve(finish("error", { code: code ?? sig }));
      });
    });
    return running;
  }

  // Startup self-check so the deploy log proves the image can run the pipeline even before keys are set.
  function checkPython() {
    const r = spawnSync(python, ["--version"], { encoding: "utf8", timeout: 5000 });
    const v = (r.stdout || r.stderr || "").trim();
    status.python = r.error ? null : v;
    log(r.error ? `[pipeline] ${python} is NOT available in this image (${r.error.code})` : `[pipeline] ${python} available: ${v}`);
    return !r.error;
  }

  function start() {
    checkPython();
    const every = env.PIPELINE_INTERVAL_MIN === undefined || env.PIPELINE_INTERVAL_MIN === "" ? 60 : Number(env.PIPELINE_INTERVAL_MIN);
    const first = run();
    if (!dirs.dryRun && !env.BALLDONTLIE_API_KEY) return first; // nothing to repeat until keys are set (setting them redeploys)
    if (every > 0) { timer = setInterval(run, every * 60000); timer.unref?.(); log(`[pipeline] scheduled every ${every} min`); }
    else log("[pipeline] PIPELINE_INTERVAL_MIN=0: runs on start only");
    return first;
  }
  return { run, start, status: () => ({ ...status }), stop: () => { stopped = true; if (timer) clearInterval(timer); } };
}
