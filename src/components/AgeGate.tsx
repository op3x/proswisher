import { useState } from "react";
import { site } from "../config/site";

const KEY = "ps_age_ok"; // sessionStorage only: no cookie, cleared when the browser session ends

export default function AgeGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<"ask" | "ok" | "denied">(() =>
    typeof sessionStorage !== "undefined" && sessionStorage.getItem(KEY) === "1" ? "ok" : "ask");
  if (state === "ok") return <>{children}</>;
  const g = site.ageGate;
  return (
    <div className="fixed inset-0 z-50 bg-ink flex items-center justify-center p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="agegate-title" className="max-w-md w-full rounded-2xl bg-panel border border-line p-6 space-y-4">
        <div className="font-extrabold text-lg">{site.name}</div>
        {state === "denied" ? (
          <p className="text-slate-200">{g.deniedMessage}</p>
        ) : (
          <>
            <h1 id="agegate-title" className="text-xl font-bold">{g.title}</h1>
            <p className="text-sm text-slate-300">{g.body}</p>
            {/* Neutral design: two equal buttons, no default selection. */}
            <div className="grid grid-cols-2 gap-3">
              <button className="rounded-lg border border-line bg-ink px-3 py-2.5 text-sm font-semibold hover:border-accent"
                onClick={() => { sessionStorage.setItem(KEY, "1"); setState("ok"); }}>{g.confirm}</button>
              <button className="rounded-lg border border-line bg-ink px-3 py-2.5 text-sm font-semibold hover:border-accent"
                onClick={() => setState("denied")}>{g.deny}</button>
            </div>
          </>
        )}
        <p className="text-xs text-slate-400">{g.help}</p>
      </div>
    </div>
  );
}
