// Football field drive chart (SVG). Home defends the left end zone and drives left-to-right; away drives right-to-left.
// payload.yardline = yards from the offense to the opponent's goal line. For "play" events it's the snap spot and
// `yards` is the gain; for other events (kickoff, punt, turnover...) it's the spot AFTER the event.
import type { RendererProps } from "./types";
import type { FootballPayload, PlayEvent } from "../sports/types";

const W = 120, H = 53.3;
const absX = (yl: number | null | undefined, poss: FootballPayload["possession"]) =>
  yl == null || poss == null ? null : poss === "home" ? 100 - yl : yl; // 0 = left goal line, 100 = right goal line
const X = (a: number) => a + 10; // field units -> svg (end zones are -10..0 and 100..110)

interface Seg { from: number; to: number; poss: FootballPayload["possession"]; kind: string }
function segments(events: PlayEvent[]): Seg[] {
  const out: Seg[] = []; let last = 50;
  for (const e of events) {
    const p = e.payload as FootballPayload;
    if (e.type === "play") {
      const s = absX(p.yardline, p.possession) ?? last, g = p.yards ?? 0;
      const to = absX((p.yardline ?? 0) - g, p.possession) ?? s;
      out.push({ from: s, to, poss: p.possession, kind: p.playType || "play" }); last = to;
    } else {
      const to = absX(p.yardline, p.possession) ?? last;
      out.push({ from: last, to, poss: p.possession, kind: e.type }); last = to;
    }
  }
  return out;
}
const ord = ["", "1st", "2nd", "3rd", "4th"];

export default function FootballField({ teams, events, index, progress }: RendererProps) {
  const segs = segments(events);
  const cur = events[index], seg = segs[index];
  if (!cur || !seg) return null;
  const p = cur.payload as FootballPayload;
  // drive = consecutive events with the same possession up to now
  let start = index; while (start > 0 && segs[start - 1].poss === seg.poss && !["kickoff", "punt", "touchdown", "int", "fumble", "downs", "field_goal"].includes(events[start - 1].type)) start--;
  const drive = segs.slice(start, index);
  // yard-by-yard: the marker steps whole yards along the segment
  const travelled = Math.round((seg.to - seg.from) * Math.min(1, progress));
  const ballX = seg.from + travelled;
  const dir = seg.poss === "home" ? 1 : -1;
  const los = cur.type === "play" ? seg.from : null;
  const fd = cur.type === "play" && p.distance != null && p.yardline != null && p.distance < p.yardline ? seg.from + dir * p.distance : null;
  const color = (s: FootballPayload["possession"]) => (s === "home" ? "#22d3ee" : "#fbbf24");
  const offName = seg.poss === "home" ? teams.home.name : seg.poss === "away" ? teams.away.name : "";
  const spot = (a: number) => (a === 50 ? "50" : a < 50 ? `${teams.home.name.split(" ").slice(-1)} ${Math.round(a)}` : `${teams.away.name.split(" ").slice(-1)} ${Math.round(100 - a)}`);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto rounded-lg select-none" role="img"
      aria-label={`Simulated drive chart. ${cur.text}`}>
      <defs>
        <marker id="arrow-home" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="3" markerHeight="3" orient="auto"><path d="M0,0L6,3L0,6z" fill="#22d3ee" /></marker>
        <marker id="arrow-away" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="3" markerHeight="3" orient="auto"><path d="M0,0L6,3L0,6z" fill="#fbbf24" /></marker>
      </defs>
      <rect x="0" y="0" width={W} height={H} fill="#14532d" />
      {Array.from({ length: 10 }, (_, i) => <rect key={i} x={X(i * 10)} y="0" width="10" height={H} fill={i % 2 ? "#166534" : "#15803d"} opacity="0.55" />)}
      <rect x="0" y="0" width="10" height={H} fill="#0f3d24" /><rect x="110" y="0" width="10" height={H} fill="#0f3d24" />
      <text x="5" y={H / 2} fill="#22d3ee" fontSize="3" fontWeight="700" textAnchor="middle" transform={`rotate(-90 5 ${H / 2})`}>{teams.home.name.toUpperCase()}</text>
      <text x="115" y={H / 2} fill="#fbbf24" fontSize="3" fontWeight="700" textAnchor="middle" transform={`rotate(90 115 ${H / 2})`}>{teams.away.name.toUpperCase()}</text>
      {Array.from({ length: 21 }, (_, i) => <line key={i} x1={X(i * 5)} x2={X(i * 5)} y1="0" y2={H} stroke="#fff" strokeOpacity={i % 2 ? 0.25 : 0.5} strokeWidth="0.25" />)}
      {[10, 20, 30, 40, 50, 60, 70, 80, 90].map((a) => <text key={a} x={X(a)} y={H - 4} fill="#fff" fillOpacity="0.6" fontSize="3.2" textAnchor="middle">{a <= 50 ? a : 100 - a}</text>)}
      {los != null && <line x1={X(los)} x2={X(los)} y1="0" y2={H} stroke="#60a5fa" strokeWidth="0.6" />}
      {fd != null && <line x1={X(fd)} x2={X(fd)} y1="0" y2={H} stroke="#facc15" strokeWidth="0.6" />}
      {drive.map((d, i) => d.from !== d.to && (
        <line key={i} x1={X(d.from)} x2={X(d.to)} y1={8 + (i % 9) * 3.6} y2={8 + (i % 9) * 3.6} stroke={color(d.poss)} strokeWidth="0.9"
          strokeDasharray={d.kind === "pass" ? "1.5 0.8" : undefined} markerEnd={`url(#arrow-${d.poss})`} opacity="0.85" />
      ))}
      {seg.from !== seg.to && progress > 0 && <line x1={X(seg.from)} x2={X(ballX)} y1={8 + (drive.length % 9) * 3.6} y2={8 + (drive.length % 9) * 3.6} stroke={color(seg.poss)} strokeWidth="1.1" />}
      <g transform={`translate(${X(ballX)} ${H / 2})`}>
        <ellipse rx="1.8" ry="1.1" fill="#92400e" stroke="#fff" strokeWidth="0.25" />
        <line x1="-0.7" x2="0.7" y1="0" y2="0" stroke="#fff" strokeWidth="0.2" />
      </g>
      <g transform="translate(12 1.5)">
        <rect width="58" height="5" rx="1" fill="#000" opacity="0.65" />
        <text x="1.5" y="3.6" fontSize="2.8" fill="#fff" fontWeight="700">
          {cur.type === "play" && p.down ? `${ord[p.down]} & ${p.yardline != null && p.distance != null && p.distance >= p.yardline ? "Goal" : p.distance} at ${spot(seg.from)}` : cur.type.replace(/_/g, " ").toUpperCase()}
          {offName ? ` · ${offName} ball` : ""}
        </text>
      </g>
    </svg>
  );
}
