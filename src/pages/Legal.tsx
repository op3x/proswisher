import { legal, site, LEGAL_DRAFT } from "../config/site";
import { usePaymentsEnabled, useLegalEffective } from "../lib/runtime";
import { Markdown } from "../components/Markdown";
import privacyA from "../content/privacy-a.md?raw";
import privacyB from "../content/privacy-b.md?raw";
import termsV1 from "../content/terms-v1.md?raw";

const SUPPORT = site.supportEmailActive ? site.supportEmail : "[support contact: not yet active]";
const fill = (t: string, effective = "Effective on launch") => t
  .replace(/Effective: \{EFFECTIVE\}/g, /^Effective/.test(effective) ? effective : `Effective: ${effective}`)
  .replace(/\{CONTACT\}/g, site.supportEmailActive ? `Questions about privacy? Email ${site.supportEmail}.` : `${site.company} · ${site.mailingAddress}`)
  .replace(/\{SUPPORT\}/g, SUPPORT)
  .replace(/support@proswisher\.com/g, SUPPORT); // Larry P11: never show the alias while it's inactive

function Shell({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="max-w-3xl space-y-4 prose-legal">
      {LEGAL_DRAFT && <span className="inline-block rounded bg-amber-500/15 text-amber-300 text-xs font-bold px-2 py-0.5">DRAFT</span>}
      {title && <h1 className="text-2xl sm:text-3xl font-extrabold">{title}</h1>}
      {children}
      <p className="text-xs text-slate-400">Operated by {site.company}.</p>
    </div>
  );
}
const Paras = ({ title, paras }: { title: string; paras: readonly string[] }) =>
  <Shell title={title}>{paras.map((p, i) => <p key={i}>{p}</p>)}</Shell>;

export const Responsible = () => <Paras title="Responsible gaming" paras={legal.responsible} />;
// Larry P2: full Terms v1 only once the support inbox works (its refund/contact terms depend on it); otherwise the short stub.
export function Terms() {
  const eff = useLegalEffective();
  return site.supportEmailActive
    ? <Shell><Markdown docTitle text={fill(termsV1, eff.terms)} /></Shell>
    : <Paras title="Terms of use" paras={legal.terms} />;
}
// Larry P4: §A always; §B (accounts + payments) only when payments are enabled.
export function Privacy() {
  const selling = usePaymentsEnabled();
  const eff = useLegalEffective();
  return (
    <Shell>
      <Markdown docTitle text={fill(privacyA, eff.privacyA)} />
      {selling && <><hr className="border-line my-6" /><Markdown text={fill(privacyB, eff.privacyB)} /></>}
      <p className="text-xs text-slate-400">{site.geoCredit}</p>
    </Shell>
  );
}
