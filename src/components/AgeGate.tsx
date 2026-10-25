import { useEffect, useRef, useState } from "react";
import { site } from "../config/site";

const KEY = "ps_age_ok"; // sessionStorage only: no cookie, cleared when the browser session ends

// Sal #11: focus moves into the dialog, Tab/Shift+Tab are trapped inside it, and focus returns afterwards
// (to whatever had it before, else the page's main content).
export default function AgeGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<"ask" | "ok" | "denied">(() =>
    typeof sessionStorage !== "undefined" && sessionStorage.getItem(KEY) === "1" ? "ok" : "ask");
  const box = useRef<HTMLDivElement>(null);
  const prev = useRef<Element | null>(null);
  useEffect(() => {
    if (state === "ok") return;
    if (!prev.current) prev.current = document.activeElement;
    const el = box.current;
    if (!el) return;
    const focusables = () => Array.from(el.querySelectorAll<HTMLElement>('button, a[href], [tabindex]:not([tabindex="-1"])'));
    (focusables()[0] || el).focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const f = focusables();
      if (!f.length) { e.preventDefault(); el.focus(); return; }
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || !el.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || !el.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [state]);
  useEffect(() => {
    if (state !== "ok" || !prev.current) return;
    const p = prev.current as HTMLElement; prev.current = null;
    requestAnimationFrame(() => {
      if (p && p !== document.body && document.contains(p) && typeof p.focus === "function") p.focus();
      else document.getElementById("main")?.focus();
    });
  }, [state]);
  if (state === "ok") return <>{children}</>;
  const g = site.ageGate;
  return (
    <div className="fixed inset-0 z-50 bg-ink flex items-center justify-center p-4">
      <div ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="agegate-title" className="max-w-md w-full rounded-2xl bg-panel border border-line p-6 space-y-4 focus:outline-none">
        <div className="font-extrabold text-lg">{site.name}</div>
        {state === "denied" ? (
          <h1 id="agegate-title" className="text-slate-200 text-base font-normal">{g.deniedMessage}</h1>
        ) : (
          <>
            <h1 id="agegate-title" className="text-xl font-bold">{g.title}</h1>
            <p className="text-sm text-slate-300">{g.body}</p>
            {/* Neutral design: two equal buttons, no default selection. */}
            <div className="grid grid-cols-2 gap-3">
              <button className="min-h-11 rounded-lg border border-line bg-ink px-3 py-2.5 text-sm font-semibold hover:border-accent focus:outline focus:outline-2 focus:outline-accent"
                onClick={() => { sessionStorage.setItem(KEY, "1"); setState("ok"); }}>{g.confirm}</button>
              <button className="min-h-11 rounded-lg border border-line bg-ink px-3 py-2.5 text-sm font-semibold hover:border-accent focus:outline focus:outline-2 focus:outline-accent"
                onClick={() => setState("denied")}>{g.deny}</button>
            </div>
          </>
        )}
        <p className="text-xs text-slate-400">{g.locationNote} {g.help}</p>
      </div>
    </div>
  );
}
