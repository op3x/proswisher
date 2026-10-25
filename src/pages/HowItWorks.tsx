import { model } from "../config/site";
import { useData, StatsFile, signed } from "../lib/data";

export default function HowItWorks() {
  const { data } = useData<StatsFile>("stats");
  const teams = data ? Object.entries(data.teams).sort((a, b) => b[1].rating - a[1].rating) : [];
  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-2xl sm:text-3xl font-extrabold">How it works</h1>
      <p className="text-slate-300">ProSwisher uses a deliberately simple model so anyone can check the math. No black box, no hidden inputs. The code and data are public.</p>
      <Step n={1} t="Team rating = point differential, blended with last season">
        Each team's rating is its average scoring margin this season, blended with last season's margin
        (shrunk {Math.round(model.priorRegress * 100)}% toward average) weighted as if it were {model.priorGames} games.
        Early in the season last year matters more; by mid-season it barely matters.
        <code className="block mt-2 text-xs text-accent">rating = (season point diff + {model.priorGames} × {model.priorRegress} × last-season margin) ÷ (games + {model.priorGames})</code>
      </Step>
      <Step n={2} t="Projected margin">
        <code className="block text-xs text-accent">home margin = home rating − away rating + {model.homeCourt} (home court; 0 at neutral sites)</code>
        The projected spread is that margin rounded to the nearest half point.
      </Step>
      <Step n={3} t="Win probability">
        Actual results scatter around projections with a standard deviation of roughly {model.sigma} points, so
        <code className="block mt-2 text-xs text-accent">P(home wins) = Φ(margin ÷ {model.sigma})</code>
        where Φ is the normal distribution. A 6-point favorite is about 69%.
      </Step>
      <Step n={4} t="Projected total">
        Each side's expected points = its scoring rate + the opponent's points-allowed rate − league average (both blended with last season the same way), plus or minus half the home-court edge.
      </Step>
      <Step n={5} t="Logged before tip-off, graded after">
        A scheduled job runs several times a day. It projects every game in the next 7 days and appends any new prediction to a public, append-only log with a timestamp. Logged predictions are never changed. After the game it records the final score next to the prediction.
      </Step>
      <h2 className="text-lg font-bold pt-2">What it ignores</h2>
      <p className="text-slate-400 text-sm">Injuries, rest, travel, lineup changes, schedule strength and market prices. The model is a transparent baseline, not an edge. Treat it accordingly.</p>
      {teams.length > 0 && (
        <section className="rounded-2xl bg-panel border border-line p-4 overflow-x-auto">
          <h2 className="font-bold mb-2">Current ratings ({data!.season}, updated {data!.updated})</h2>
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-slate-500"><tr><th className="py-1">#</th><th>Team</th><th>Team record</th><th>Margin</th><th>{data!.priorSeason}</th><th>Rating</th></tr></thead>
            <tbody>
              {teams.map(([ab, t], i) => (
                <tr key={ab} className="border-t border-line">
                  <td className="py-1.5 text-slate-500">{i + 1}</td><td>{t.name}</td><td className="tabular-nums">{t.w}-{t.l}</td>
                  <td className="tabular-nums">{t.margin === null ? "–" : signed(t.margin)}</td>
                  <td className="tabular-nums text-slate-400">{t.priorMargin === null ? "–" : signed(t.priorMargin)}</td>
                  <td className="tabular-nums font-semibold text-accent">{signed(t.rating)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
function Step({ n, t, children }: { n: number; t: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-panel border border-line p-4">
      <h2 className="font-bold"><span className="text-accent mr-2">{n}.</span>{t}</h2>
      <div className="mt-2 text-sm text-slate-300 space-y-1">{children}</div>
    </section>
  );
}
