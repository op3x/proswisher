import { NavLink, Outlet, Link, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { site, legal, LEGAL_DRAFT } from "../config/site";

export default function Layout() {
  const { pathname } = useLocation();
  useEffect(() => window.scrollTo(0, 0), [pathname]);
  return (
    <div className="min-h-screen flex flex-col">
      {__APP_ENV__ !== "production" && (
        <div className="bg-amber-500/10 text-amber-300 text-xs text-center py-1 border-b border-amber-500/20">
          Preview build: not public
        </div>
      )}
      <header className="sticky top-0 z-20 bg-ink/90 backdrop-blur border-b border-line">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between gap-2">
          <Link to="/" className="flex items-center gap-2 font-extrabold tracking-tight text-base sm:text-lg shrink-0">
            <span className="inline-block h-6 w-6 rounded-full bg-gradient-to-br from-accent to-sky-600" />
            {site.name}
          </Link>
          <nav className="flex gap-0.5 sm:gap-1 text-xs sm:text-sm overflow-x-auto">
            {site.nav.map((n) => (
              <NavLink key={n.to} to={n.to} end
                className={({ isActive }) => `whitespace-nowrap px-2 sm:px-2.5 py-1.5 rounded-md ${isActive ? "bg-panel text-white" : "text-slate-400 hover:text-white"}`}>
                {n.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-6"><Outlet /></main>
      <footer className="border-t border-line mt-10">
        <div className="max-w-5xl mx-auto px-4 py-8 text-sm text-slate-400 space-y-3">
          {LEGAL_DRAFT && <p className="text-[11px] uppercase tracking-wider text-amber-400">{legal.draftNotice}</p>}
          <p className="text-slate-300">{site.footerDisclaimer}</p>
          <p className="text-xs">{site.dataCredit}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {site.footerLinks.map((l) => <Link key={l.to} to={l.to} className="hover:text-white underline-offset-4 hover:underline">{l.label}</Link>)}
          </div>
          <p className="text-xs">Support: {site.supportEmail}{site.supportEmailActive ? "" : " (not yet active)"} · {site.mailingAddress}</p>
          <p className="text-xs">© {site.year} {site.company}</p>
        </div>
      </footer>
    </div>
  );
}
