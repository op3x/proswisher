import { Link } from "react-router-dom";
import { site } from "../config/site";

// Larry footer spec: "Contact". Placeholder until support@ works (P11): the address is NOT shown here yet.
export default function Contact() {
  return (
    <div className="max-w-xl space-y-4">
      <h1 className="text-2xl sm:text-3xl font-extrabold">Contact</h1>
      {site.supportEmailActive ? (
        <p className="text-slate-300">Email {site.supportEmail} and we'll get back to you.</p>
      ) : (
        <p className="text-slate-300">Our support inbox opens before memberships go on sale. We'll list how to reach us here as soon as it's live.</p>
      )}
      <p className="text-slate-300">To cancel a membership, go to <Link className="text-accent underline underline-offset-4" to="/account">Account settings</Link>.</p>
      <p className="text-slate-300">If you or someone you know has a gambling problem, call 1-800-GAMBLER. See <Link className="text-accent underline underline-offset-4" to="/responsible-gaming">Responsible gaming</Link>.</p>
      <p className="text-sm text-slate-400">{site.operatedBy}</p>
      <p className="text-sm text-slate-400">{site.company} · {site.mailingAddress}</p>
    </div>
  );
}
