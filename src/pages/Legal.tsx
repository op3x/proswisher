import { legal, site, LEGAL_DRAFT } from "../config/site";

function Page({ title, paras }: { title: string; paras: readonly string[] }) {
  return (
    <div className="max-w-3xl space-y-4 prose-legal">
      {LEGAL_DRAFT && <span className="inline-block rounded bg-amber-500/15 text-amber-300 text-xs font-bold px-2 py-0.5">DRAFT</span>}
      <h1 className="text-2xl sm:text-3xl font-extrabold">{title}</h1>
      {paras.map((p, i) => <p key={i}>{p}</p>)}
      <p className="text-xs text-slate-500">Operated by {site.company}.</p>
    </div>
  );
}
export const Responsible = () => <Page title="Responsible gaming" paras={legal.responsible} />;
export const Terms = () => <Page title="Terms of use" paras={legal.terms} />;
export const Privacy = () => <Page title="Privacy" paras={legal.privacy} />;
