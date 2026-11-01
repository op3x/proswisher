import { site, legal } from "../config/site";
import { usePaymentsEnabled } from "../lib/runtime";
import { useInjuriesModeled } from "../components/ModelDisclaimer";

export default function Faq() {
  const selling = usePaymentsEnabled();
  const injuries = useInjuriesModeled();
  // [q, a, onlyWhenSelling, onlyWhenNotSelling]
  const items = site.faq.filter(([, a, whenSelling, whenNot]) => (whenSelling ? selling : true) && (whenNot ? !selling : true)
    // Larry 9:38 HOLD: refund copy ships only once the support inbox works
    && (a !== "{refunds}" || site.supportEmailActive));
  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-2xl sm:text-3xl font-extrabold">FAQ</h1>
      {items.map(([q, a]) => (
        <details key={q} className="rounded-xl bg-panel border border-line p-4">
          <summary className="font-semibold cursor-pointer">{q}</summary>
          <p className="mt-2 text-sm text-slate-300">{a === "{refunds}" ? legal.refunds : a === "{modeled}" ? (injuries ? site.modelDisclaimer.injuries : site.modelDisclaimer.base) : a}</p>
        </details>
      ))}
      {site.supportEmailActive && <p className="text-sm text-slate-400">Contact: {site.supportEmail}</p>}
    </div>
  );
}
