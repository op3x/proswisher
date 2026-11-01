// Credits (Larry 10/31 10:04 PM): CC BY 4.0 (nflverse) and CFBD require attribution that's reasonably findable, so it
// lives here behind the footer "Credits" link instead of inside the Terms. Texts: Larry memo 24 (sports/api.ts).
import { site } from "../config/site";
import { REQUIRED_ATTRIBUTION } from "../sports/api";

export default function Credits() {
  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-2xl sm:text-3xl font-extrabold">{site.credits.title}</h1>
      <p className="text-slate-300">{site.credits.intro}</p>
      <ul className="space-y-3 text-sm text-slate-300" data-testid="credits">
        <li>{REQUIRED_ATTRIBUTION.nfl}</li>
        <li>{REQUIRED_ATTRIBUTION.ncaaf}</li>
        <li>{site.notAffiliated}</li>
        <li>{site.dataCredit}</li>
        <li>{site.geoCredit}</li>
      </ul>
    </div>
  );
}
