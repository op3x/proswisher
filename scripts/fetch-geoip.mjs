// Downloads MaxMind GeoLite2 City into geoip/ (gitignored). Needs MAXMIND_LICENSE_KEY (Ryan sets it in Railway);
// MAXMIND_ACCOUNT_ID optional (uses the newer basic-auth endpoint when set). Never prints the key or the URL.
// Missing key or any failure -> warning and exit 0 (build never breaks; the app keeps public pages open and DISABLES checkout without a fresh DB, per Larry).
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { GEOIP_DIR, GEOIP_PATH } from "../server/geo.mjs";

export async function fetchGeoip() {
  const key = (process.env.MAXMIND_LICENSE_KEY || "").trim();
  if (!key) { console.warn("[geoip] MAXMIND_LICENSE_KEY unset; skipping download (checkout will be disabled; public pages stay open)"); return false; }
  const acct = (process.env.MAXMIND_ACCOUNT_ID || "").trim();
  const url = acct
    ? "https://download.maxmind.com/geoip/databases/GeoLite2-City/download?suffix=tar.gz"
    : `https://download.maxmind.com/app/geoip_download?edition_id=GeoLite2-City&suffix=tar.gz&license_key=${encodeURIComponent(key)}`;
  const headers = acct ? { Authorization: "Basic " + Buffer.from(`${acct}:${key}`).toString("base64") } : {};
  try {
    const r = await fetch(url, { headers, redirect: "follow" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    fs.mkdirSync(GEOIP_DIR, { recursive: true });
    const tgz = path.join(GEOIP_DIR, "download.tar.gz");
    fs.writeFileSync(tgz, Buffer.from(await r.arrayBuffer()));
    const tmp = path.join(GEOIP_DIR, "extract");
    fs.mkdirSync(tmp, { recursive: true });
    execFileSync("tar", ["-xzf", tgz, "-C", tmp]);
    const dir = fs.readdirSync(tmp).find((d) => fs.existsSync(path.join(tmp, d, "GeoLite2-City.mmdb")));
    if (!dir) throw new Error("mmdb not in archive");
    fs.renameSync(path.join(tmp, dir, "GeoLite2-City.mmdb"), GEOIP_PATH + ".new");
    fs.renameSync(GEOIP_PATH + ".new", GEOIP_PATH);
    fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(tgz, { force: true });
    console.log("[geoip] GeoLite2 City updated");
    return true;
  } catch (e) {
    console.warn(`[geoip] download failed (${e.message}); checkout stays disabled until a fresh DB is present`);
    return false;
  }
}
if (import.meta.url === `file://${process.argv[1]}`) await fetchGeoip();
