import { NavLink, Outlet, Link, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { site, legal, LEGAL_DRAFT } from "../config/site";
import { countView } from "../lib/runtime";

export default function Layout() {
  const { pathname, search, hash, key } = useLocation();
  useEffect(() => {
    countView(pathname, search);
    if (!hash) { window.scrollTo(0, 0); return; }
    // shared links land on #prediction / #log / #pricing after async data renders: retry briefly
    let n = 0; const id = hash.slice(1);
    const t = setInterval(() => { const el = document.getElementById(id); if (el || ++n > 30) { clearInterval(t); el?.scrollIntoView(); } }, 100);
    return () => clearInterval(t);
    // Sal #8: also re-run on hash/key so /#slate clicked while already on / scrolls on the same page.
  }, [pathname, hash, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="min-h-screen flex flex-col">
      {/* Sal #10: skip link, first focusable element */}
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-accent focus:text-ink focus:px-4 focus:py-3 focus:font-semibold">Skip to content</a>
      <header className="sticky top-0 z-20 bg-ink/90 backdrop-blur border-b border-line">
        {/* Sal #12: the preview banner lives inside the header landmark */}
        {__APP_ENV__ !== "production" && (
          <p className="bg-amber-500/10 text-amber-300 text-xs text-center py-1 border-b border-amber-500/20">
            Preview build: not public
          </p>
        )}
        {/* Sal #7: logo and nav stack on narrow screens instead of clipping */}
        <div className="max-w-5xl mx-auto px-4 py-1 sm:py-0 sm:h-14 flex flex-wrap sm:flex-nowrap items-center justify-between gap-x-2">
          <Link to="/" className="flex items-center gap-2 min-h-11 font-extrabold tracking-tight text-base sm:text-lg shrink-0">
            <span className="inline-block h-6 w-6 rounded-full bg-gradient-to-br from-accent to-sky-600" />
            {site.name}
          </Link>
          <nav aria-label="Main" className="flex w-full sm:w-auto gap-1 text-sm overflow-x-auto -mx-1 px-1">
            {site.nav.map((n) => (
              <NavLink key={n.to} to={n.to} end onFocus={(e) => e.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" })}
                className={({ isActive }) => `inline-flex items-center min-h-11 whitespace-nowrap px-3 rounded-md ${isActive ? "bg-panel text-white" : "text-slate-300 hover:text-white"}`}>
                {n.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="flex-1 max-w-5xl w-full mx-auto px-4 py-6 focus:outline-none"><Outlet /></main>
      <footer className="border-t border-line mt-10">
        <div className="max-w-5xl mx-auto px-4 py-8 text-sm text-slate-400 space-y-3">
          {LEGAL_DRAFT && <p className="text-[11px] uppercase tracking-wider text-amber-400">{legal.draftNotice}</p>}
          <p className="text-slate-300">{site.footerDisclaimer}</p>
          <p className="text-xs">{site.dataCredit}</p>
          {/* Sal #10: 44px tap targets */}
          <nav aria-label="Footer" className="flex flex-wrap gap-x-4">
            {site.footerLinks.map((l) => <Link key={l.to} to={l.to} className="inline-flex items-center min-h-11 text-slate-300 underline underline-offset-4 hover:text-white">{l.label}</Link>)}
          </nav>
          {/* Larry P11: support alias hidden until it works. P14: mailing address stays a marked placeholder. */}
          <p className="text-xs">{site.supportEmailActive ? <>Support: {site.supportEmail} · </> : null}{site.mailingAddress}</p>
          <p className="text-xs text-slate-400">{site.geoCredit}</p>
          <p className="text-xs">© {site.year} {site.company}</p>
        </div>
      </footer>
    </div>
  );
}
