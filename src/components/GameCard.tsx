import { Link } from "react-router-dom";
import { Game, pct, fmtLine, tipTime, gamePath } from "../lib/data";
import { site } from "../config/site";
import { gatingActive } from "../lib/access";
import LockedTeaser from "./LockedTeaser";

export default function GameCard({ g, featured = false, locked = false }: { g: Game; featured?: boolean; locked?: boolean }) {
  const p = locked ? undefined : g.prediction;
  const row = (side: "away" | "home") => {
    const t = g[side];
    const prob = p ? (side === "home" ? p.pHome : 1 - p.pHome) : null;
    const isPick = p && p.pick === t.abbr;
    return (
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`text-[11px] font-bold w-10 text-center rounded py-0.5 ${isPick ? "bg-accent/15 text-accent" : "bg-line text-slate-400"}`}>{t.abbr}</span>
          <span className={`truncate ${isPick ? "text-white font-semibold" : "text-slate-300"}`}>{t.name}</span>
          {side === "home" && !g.neutral && <span className="text-[10px] text-slate-500">HOME</span>}
        </div>
        {g.final || g.state === "in" ? (
          <span className="tabular-nums font-semibold">{t.score ?? "-"}</span>
        ) : prob !== null ? (
          <span className={`tabular-nums text-sm ${isPick ? "text-accent font-semibold" : "text-slate-400"}`}>{pct(prob)}</span>
        ) : null}
      </div>
    );
  };
  return (
    <Link to={gamePath(g)} className="block rounded-xl bg-panel border border-line hover:border-accent/50 transition p-4 space-y-3">
      <div className="flex justify-between text-xs text-slate-400">
        <span>{tipTime(g.date)}{featured && gatingActive() && <span className="ml-2 rounded bg-accent/15 text-accent px-1.5 py-0.5 font-semibold">{site.gamePage.featured.badge}</span>}</span>
        <span>{g.state === "pre" ? (g.neutral ? "Neutral site" : "") : g.status}</span>
      </div>
      {row("away")}
      {row("home")}
      {p && (
        <>
          <div className="h-1.5 rounded-full bg-line overflow-hidden flex">
            <div className="bg-slate-500" style={{ width: pct(1 - p.pHome) }} />
            <div className="bg-accent" style={{ width: pct(p.pHome) }} />
          </div>
          <div className="grid grid-cols-3 text-center text-xs">
            <div><div className="text-slate-500">Lean</div><div className="font-semibold text-white">{p.pick} {pct(p.pickProb)}</div></div>
            <div><div className="text-slate-500">{site.spreadLabel}</div><div className="font-semibold text-white">{p.spread.team} {fmtLine(p.spread.line)}</div></div>
            <div><div className="text-slate-500">{site.totalLabel}</div><div className="font-semibold text-white">{p.total}</div></div>
          </div>
          <p className="text-[10px] leading-snug text-slate-500">{site.pickDisclaimer}</p>
        </>
      )}
      {locked && <LockedTeaser g={g} compact />}
    </Link>
  );
}
