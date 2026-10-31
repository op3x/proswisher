// Pluggable visuals, chosen per sport. Add basketball later: registry.basketball = lazy(() => import("./BasketballCourt")).
import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import type { Sport } from "../sports/types";
import type { RendererProps } from "./types";

const loaders: Partial<Record<Sport, () => Promise<{ default: ComponentType<RendererProps> }>>> = {
  football: () => import("./FootballField"),
};
export const registry: Partial<Record<Sport, LazyExoticComponent<ComponentType<RendererProps>>>> = Object.fromEntries(
  Object.entries(loaders).map(([k, f]) => [k, lazy(f!)]),
);
/** Warm the renderer chunk early (e.g. when the Simulate page opens) so the field is ready when results arrive. */
export const preloadRenderer = (sport: Sport) => { loaders[sport]?.().catch(() => {}); };
export const rendererFor = (sport: Sport) => registry[sport] || null;
