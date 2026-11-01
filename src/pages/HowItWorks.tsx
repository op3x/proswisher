// Sport-agnostic explainer. Football first; basketball steps slot in when NBA/NCAAB launch.
import { Link } from "react-router-dom";
import { site } from "../config/site";

export default function HowItWorks() {
  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-2xl sm:text-3xl font-extrabold">How it works</h1>
      <p className="text-slate-300">{site.name} plays each matchup snap by snap, thousands of times, using real play-by-play data. Then it tells you how often each team won, what the scores looked like, and shows you one representative game.</p>
      <Step n={1} t="Team ratings from real play-by-play">
        Every night at 4 AM CT we refresh public play-by-play data: nflverse for the NFL and CollegeFootballData.com for college. From it we rate each offense and defense by down, distance and field position: how often teams run or pass, how many yards a play gains, and how often drives end in turnovers, punts or field goals.
      </Step>
      <Step n={2} t="Simulate the game one play at a time">
        For each snap the engine looks at the situation (down, distance, yard line, clock, score) and draws a play type and a result from the two teams' ratings. Kicks, punts, field goals, turnovers, penalties and the clock are all simulated. One game takes a few milliseconds.
      </Step>
      <Step n={3} t="Repeat thousands of times">
        We play the same matchup thousands of times. Win probability is the share of games each team won. Margin and total show the median plus the middle 50% and 90% ranges, so you can see how uncertain a game really is. Quarter scores are medians.
      </Step>
      <Step n={4} t="Watch a representative game">
        We pick the simulated game whose margin and total sit closest to the median and replay it on the field: drive arrows, down and distance, the scoreboard and the clock. Players appear only by position. Simulations never use real names or likenesses.
      </Step>
      <Step n={5} t="Pick Your Matchup">
        Pick any two teams. If they're on the schedule, you get our normal prediction for that game. If they're in the same league and season but not scheduled to play, the result is tagged "{site.matchupTags.unscheduled}". Teams from different seasons, or a college team against a pro team, are tagged "{site.matchupTags.cross}"
      </Step>
      <p className="text-xs text-slate-400">{site.pickDisclaimer}</p>
      <Link to="/simulate" className="inline-flex items-center min-h-11 rounded-lg bg-accent text-ink font-semibold px-4">{site.heroCta}</Link>
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
