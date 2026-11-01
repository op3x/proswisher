import { Link } from "react-router-dom";
import { site } from "../config/site";
import OtherDeviceCancel from "../components/OtherDeviceCancel";
import { usePortalLoginUrl } from "../lib/runtime";

// /cancel (Larry 10:31 PM): how to cancel, mirroring Terms §5(c). The footer's "Cancel subscription" lands here.
export default function Cancel() {
  const loginUrl = usePortalLoginUrl();
  return (
    <div className="max-w-xl space-y-4">
      <h1 className="text-2xl sm:text-3xl font-extrabold">Cancel your subscription</h1>
      <p className="text-slate-300">Go to <Link className="text-accent underline underline-offset-4" to="/account">Account settings</Link> and choose Cancel subscription, then confirm. No call is required.</p>
      {loginUrl && <p className="text-slate-300"><OtherDeviceCancel className="text-accent" /> <span className="text-sm text-slate-400">(we'll email you a code to sign in and cancel)</span></p>}
      {site.supportEmailActive && <p className="text-sm text-slate-300">You can also email <a className="text-accent underline underline-offset-4" href={`mailto:${site.supportEmail}?subject=cancel`}>{site.supportEmail}</a> from your account email with the word "cancel" and we'll cancel it within one business day.</p>}
      <p className="text-sm text-slate-400">{site.pricing.cancel}</p>
    </div>
  );
}
