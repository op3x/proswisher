import type { League, PlayEvent, Team } from "../sports/types";
/** Contract every sport renderer implements. GamePlayer owns playback; renderers only draw a frame. */
export interface RendererProps {
  league?: League;
  teams: { home: Team; away: Team };
  events: PlayEvent[];
  index: number;     // current event
  progress: number;  // 0..1 through the current event's animation
}
