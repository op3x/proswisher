import { useEffect, useState } from "react";

export type MarketSpread = { homeLine: number; source: string; books: string[]; recordedAt: string };
export type Side = { abbr: string; name: string; short: string; score: number | null };
export type Prediction = {
  homeMargin: number;
  spread: { team: string; line: number };
  total: number;
  projScore: { home: number; away: number };
  pHome: number;
  market?: MarketSpread | null;
  pick: string;
  pickProb: number;
  inputs: {
    homeRating: number; awayRating: number; homeCourt: number;
    homeOff: number; homeDef: number; awayOff: number; awayDef: number; leaguePpg: number;
  };
};
export type Game = {
  id: string; date: string; day: string; state: "pre" | "in" | "post"; final: boolean; status: string;
  neutral: boolean; seasonType: number; home: Side; away: Side; prediction?: Prediction;
};
export type GamesFile = { seasonYear: number; seasonLabel: string; updatedAt: string; games: Record<string, Game> };
export type Team = {
  name: string; gp: number; w: number; l: number; ppg: number | null; oppg: number | null;
  margin: number | null; priorMargin: number | null; rating: number; offRating: number; defRating: number;
};
export type StatsFile = {
  updated: string; season: string; priorSeason: string; leaguePpg: number; modelVersion: string;
  model: { homeCourt: number; priorGames: number; priorRegress: number; sigma: number };
  teams: Record<string, Team>;
};
export type LogEntry = {
  gameId: string; date: string; home: string; away: string; loggedAt: string; modelVersion: string;
  pick: string; pickProb: number; spread: { team: string; line: number }; total: number; homeMargin: number;
  projScore?: { home: number; away: number };
  marketSpread: MarketSpread | null; // recorded before tip-off, with source + time; null = no licensed source yet
  atsLean: "home" | "away" | null;     // our lean vs the market spread
  result: null | {
    status: "final" | "postponed"; gradedAt: string;
    homeScore?: number; awayScore?: number; winner?: string;
    winnerGrade: "W" | "L" | null;      // did our favored team win
    atsGrade: "W" | "L" | "P" | null;   // did our lean cover the MARKET spread (null = no market line, not counted)
    marginError?: number;
  };
};
export type LogFile = { modelVersion: string; startedAt: string; updatedAt: string; marketSource?: string | null; entries: Record<string, LogEntry> };

const cache = new Map<string, Promise<unknown>>();
function load<T>(name: string): Promise<T> {
  if (!cache.has(name)) cache.set(name, fetch(`/data/${name}.json`, { cache: "no-cache" }).then((r) => {
    if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
    return r.json();
  }));
  return cache.get(name) as Promise<T>;
}

export function useData<T>(name: "games" | "stats" | "predictions") {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { load<T>(name).then(setData).catch((e) => setError(String(e))); }, [name]);
  return { data, error };
}

// Canonical shareable game URL (used in posts): /games/{yyyy-mm-dd CT}/{away-slug}-vs-{home-slug}. Same rule in server/index.mjs.
const kebab = (x: string) => x.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
export const gamePath = (g: Game) =>
  `/games/${new Date(g.date).toLocaleDateString("en-CA", { timeZone: "America/Chicago" })}/${kebab(g.away.short)}-vs-${kebab(g.home.short)}`;

// Members: non-featured pre-tip predictions come ONLY from the gated server API (Larry P6), never /data/*.json.
let memberP: Promise<Record<string, Prediction>> | null = null;
export function loadMemberPredictions(sid: string | null) {
  if (!sid) return Promise.resolve({});
  return (memberP ||= fetch(`/api/predictions?session_id=${encodeURIComponent(sid)}`, { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : { predictions: {} })).then((j) => j.predictions || {}).catch(() => ({})));
}

export const pct = (p: number) => `${Math.round(p * 100)}%`;
export const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);
export const fmtLine = (n: number) => (n === 0 ? "PK" : n > 0 ? `+${n}` : `${n}`);
export const tipTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
export const dayLabel = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
