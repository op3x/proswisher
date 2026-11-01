import { NavLink, Outlet, Link, useLocation, useNavigationType } from "react-router-dom";
import { useEffect, useRef } from "react";
import { site } from "../config/site";
import OtherDeviceCancel from "./OtherDeviceCancel";
import { countView } from "../lib/runtime";
import Ticker from "./Ticker";

const ROUTE_TITLES: Record<string, string> = {
  "/simulate": "Simulate a Game", "/how-it-works": "How It Works", "/faq": "FAQ", "/contact": "Contact",
  "/terms": "Terms and Conditions", "/credits": "Credits", "/privacy": "Privacy Policy", "/responsible-gaming": "Responsible Gaming",
};

export default function Layout() {
  const { pathname, search, hash, key } = useLocation();
  const navType = useNavigationType();
  const prevPath = useRef<string | null>(null);
  useEffect(() => {
    // Titles: "… | Simculus Sports". Game pages set their own (GameDetail).
    // Parent effects run after children, so only touch known routes and leave other pages' own titles alone.
    if (pathname === "/") document.title = site.meta.title;
    else if (ROUTE_TITLES[pathname]) document.title = `${ROUTE_TITLES[pathname]} | ${site.name}`;
  }, [pathname]);
  useEffect(() => {
    countView(pathname, search);
    // Ryan 10/31: a page rewriting its own query string in place (Simulate's Run simulation saves the matchup with
    // replace) is not a navigation, so don't jump to the top. Real navigations (push/pop or a new path) still do.
    const samePageReplace = navType === "REPLACE" && prevPath.current === pathname;
    prevPath.current = pathname;
    if (!hash) { if (!samePageReplace) window.scrollTo(0, 0); return; }
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
      <header className="sm:sticky top-0 z-20 bg-ink/90 backdrop-blur border-b border-line">
        {/* Sal #12: the preview banner lives inside the header landmark */}
        {__APP_ENV__ !== "production" && (
          <p className="bg-amber-500/10 text-amber-300 text-xs text-center py-1 border-b border-amber-500/20">
            Preview build: not public
          </p>
        )}
        <Ticker />
        {/* Sal #7: logo and nav stack on narrow screens instead of clipping */}
        <div className="max-w-5xl mx-auto px-4 py-1 sm:py-0 sm:h-14 flex flex-wrap sm:flex-nowrap items-center justify-between gap-x-2">
          {/* Final logo (Ryan 10/31): horizontal dark-theme lockup; the ™ is in the artwork */}
          <Link to="/" className="flex items-center min-h-11 shrink-0" aria-label={`${site.name} home`}>
            <img src="/brand/simculus-sports-logo-dark-nobg.svg" alt={site.brandTM} width={749} height={200} className="h-9 sm:h-10 w-auto" />
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
          {/* Brand lockup: stacked on mobile, horizontal on wider screens */}
          <Link to="/" aria-label={`${site.name} home`} className="inline-block">
            <img src="/brand/simculus-sports-stacked-dark-nobg.svg" alt={site.brandTM} width={542} height={392} loading="lazy" className="sm:hidden h-20 w-auto" />
            <img src="/brand/simculus-sports-logo-dark-nobg.svg" alt={site.brandTM} width={749} height={200} loading="lazy" className="hidden sm:block h-10 w-auto" />
          </Link>
          {/* Larry 10/31 10:04 PM (Ryan approved): one line, then Terms and Conditions · Privacy · Credits. Everything else
              (long disclaimer, not-affiliated, attribution, address) is in the Terms or on /credits. */}
          <p className="text-slate-300" data-testid="footer-line">
            {site.footerDisclaimer}{" "}
            <span className="inline-flex flex-wrap items-center">
              {site.footerLinks.map((l, i) => <span key={l.to} className="inline-flex items-center">{i > 0 && <span aria-hidden="true" className="px-1">·</span>}<Link to={l.to} className="inline-flex items-center min-h-11 text-slate-200 underline underline-offset-4 hover:text-white">{l.label}</Link></span>)}
            </span>
          </p>
          {/* Sal #10: 44px tap targets */}
          <nav aria-label="Footer" className="flex flex-wrap gap-x-4 text-xs">
            {site.footerNav.map((l) => <Link key={l.to} to={l.to} className="inline-flex items-center min-h-11 text-slate-400 underline underline-offset-4 hover:text-white">{l.label}</Link>)}
            <OtherDeviceCancel className="text-slate-400" />
          </nav>
          <p className="text-xs">{site.operatedBy} © {site.year} {site.company}</p>
        </div>
      </footer>
    </div>
  );
}
