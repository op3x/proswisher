import { site } from "../config/site";
import { usePortalLoginUrl } from "../lib/runtime";

// Larry 10:31 PM: "Paid on another device? Cancel here" -> the Stripe customer-portal login link, which emails a
// one-time code to the subscription's email and then shows its cancel button. Renders nothing when the link isn't set.
export default function OtherDeviceCancel({ className = "" }: { className?: string }) {
  const url = usePortalLoginUrl();
  if (!url) return null;
  return <a href={url} rel="noopener" data-testid="other-device-cancel" className={`inline-flex items-center min-h-11 underline underline-offset-4 hover:text-white ${className}`}>{site.otherDeviceCancel}</a>;
}
