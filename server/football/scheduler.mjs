// Daily football refresh: scripts/football/refresh.py at 04:00 America/Chicago (FOOTBALL_REFRESH_HOUR/MINUTE),
// plus once on start when the published data is missing or older than 20 hours. Never crashes the web server.
// The child gets a minimal env allowlist (no Stripe/admin secrets); keys are never logged.
import fs from "node:fs";
import path from "node:path";
import { spawn as nodeSpawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const FOOTBALL_CHILD_ENV = ["PATH", "HOME", "LANG", "TZ", "APP_ENV", "APP_NAME", "CFBD_API_KEY", "CFBD_MONTHLY_BUDGET",
  "NFL_DATA_PROVIDER", "NCAAF_DATA_PROVIDER", "NFL_LOCAL_DIR", "FOOTBALL_CLEAR_BLOCKS", "FOOTBALL_REFIT_PARAMS"];

/** Wall-clock parts of `date` in `timeZone`. */
function zoned(date, timeZone) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const p = Object.fromEntries(f.formatToParts(date).filter((x) => x.type !== "literal").map((x) => [x.type, Number(x.value)]));
  return p;
}
/** UTC ms for a wall-clock time in `timeZone` (handles DST by iterating the offset). */
export function zonedToUtc(y, mo, d, h, mi, timeZone) {
  let guess = Date.UTC(y, mo - 1, d, h, mi);
  for (let i = 0; i < 3; i++) {
    const p = zoned(new Date(guess), timeZone);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    guess += Date.UTC(y, mo - 1, d, h, mi) - asUtc;
  }
  return guess;
}
/** Next occurrence (strictly after `now`) of hh:mm wall-clock time in `timeZone`. */
export function nextRunAt(now = new Date(), hour = 4, minute = 0, timeZone = "America/Chicago") {
  const p = zoned(now, timeZone);
  for (let add = 0; add < 3; add++) {
    const day = new Date(Date.UTC(p.year, p.month - 1, p.day + add));
    const t = zonedToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hour, minute, timeZone);
    if (t > now.getTime()) return new Date(t);
  }
  return new Date(now.getTime() + 864e5);
}

export function createFootballPipeline({ env = process.env, dirs, log = console.log, onDone = () => {}, spawn = nodeSpawn,
  python = env.PIPELINE_PYTHON || "python3", script = path.join(ROOT, "scripts/football/refresh.py"), now = () => new Date() } = {}) {
  const hour = Number(env.FOOTBALL_REFRESH_HOUR ?? 4), minute = Number(env.FOOTBALL_REFRESH_MINUTE ?? 0);
  const tz = env.FOOTBALL_REFRESH_TZ || "America/Chicago";
  let running = null, timer = null;
  const status = { runs: 0, last: null, running: false, next: null, schedule: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} ${tz}` };
  const finish = (result, extra = {}) => { status.last = { result, at: now().toISOString(), ...extra }; status.running = false; running = null; return status.last; };

  function run() {
    if (running) return running;
    status.running = true; status.runs += 1;
    const childEnv = Object.fromEntries(FOOTBALL_CHILD_ENV.filter((k) => env[k] != null).map((k) => [k, env[k]]));
    Object.assign(childEnv, { PUBLIC_DATA_DIR: dirs.publicDir, PREDICTIONS_PRIVATE_DIR: dirs.privateDir });
    const t0 = Date.now();
    log(`[football] refresh #${status.runs} started`);
    running = new Promise((resolve) => {
      let child;
      try { child = spawn(python, [script], { env: childEnv, stdio: ["ignore", "inherit", "inherit"] }); }
      catch (e) { log(`[football] refresh not run: could not start ${python} (${e.code || e.name})`); return resolve(finish("no-python")); }
      child.on("error", (e) => { log(`[football] refresh not run: ${e.code || e.name}`); resolve(finish(e.code === "ENOENT" ? "no-python" : "error")); });
      child.on("exit", (code, sig) => {
        const ms = Date.now() - t0;
        if (code === 0 || code === 3) {
          if (code === 3) log("[football] a data source refused access and was STOPPED (see the STOPPED line above); other sources continue. Not retried until FOOTBALL_CLEAR_BLOCKS is set by a human.");
          else log(`[football] refresh #${status.runs} finished OK in ${Math.round(ms / 1000)}s`);
          try { onDone(); } catch (e) { log(`[football] reload after refresh failed: ${e.message}`); }
          return resolve(finish(code === 3 ? "source-blocked" : "ok", { ms }));
        }
        log(`[football] refresh #${status.runs} failed (exit ${code ?? sig}); previous data kept, next scheduled run will retry`);
        resolve(finish("error", { code: code ?? sig }));
      });
    });
    return running;
  }

  function arm() {
    const next = nextRunAt(now(), hour, minute, tz);
    status.next = next.toISOString();
    timer = setTimeout(() => { run().finally(arm); }, Math.max(1000, next.getTime() - now().getTime()));
    timer.unref?.();
  }

  function stale() {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(dirs.publicDir, "football", "status.json"), "utf8"));
      return !(s.generatedAt && now().getTime() - Date.parse(s.generatedAt) < 20 * 3600e3);
    } catch { return true; }
  }

  function start() {
    if (/^(0|false|no|off)$/i.test(String(env.FOOTBALL_REFRESH_ENABLED ?? "true"))) { log("[football] daily refresh disabled (FOOTBALL_REFRESH_ENABLED=false)"); return Promise.resolve(null); }
    arm();
    log(`[football] daily refresh scheduled at ${status.schedule}; next ${status.next}`);
    if (stale()) return run();
    try { onDone(); } catch {}
    return Promise.resolve(null);
  }
  return { run, start, status: () => ({ ...status }), stop: () => clearTimeout(timer) };
}
