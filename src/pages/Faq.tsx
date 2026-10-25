import { site, legal } from "../config/site";
import { paymentsEnabled } from "../lib/geoblock";

export default function Faq() {
  const selling = paymentsEnabled() || import.meta.env.VITE_SUBSCRIBE_ENABLED === "true";
  // [q, a, onlyWhenSelling, onlyWhenNotSelling]
  const items = site.faq.filter(([, , whenSelling, whenNot]) => (whenSelling ? selling : true) && (whenNot ? !selling : true));
  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-2xl sm:text-3xl font-extrabold">FAQ</h1>
      {items.map(([q, a]) => (
        <details key={q} className="rounded-xl bg-panel border border-line p-4">
          <summary className="font-semibold cursor-pointer">{q}</summary>
          <p className="mt-2 text-sm text-slate-300">{a === "{refunds}" ? legal.refunds : a}</p>
        </details>
      ))}
      <p className="text-sm text-slate-400">Contact: {site.supportEmail}{site.supportEmailActive ? "" : " (not yet active)"}</p>
    </div>
  );
}
