// Pluggable visuals, chosen per sport. Add basketball later: registry.basketball = lazy(() => import("./BasketballCourt")).
import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import type { Sport } from "../sports/types";
import type { RendererProps } from "./types";

export const registry: Partial<Record<Sport, LazyExoticComponent<ComponentType<RendererProps>>>> = {
  football: lazy(() => import("./FootballField")),
};
export const rendererFor = (sport: Sport) => registry[sport] || null;
