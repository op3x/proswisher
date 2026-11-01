// All registered sports. Basketball (NBA, NCAAB) will be added here as one more SportModule.
import { registerSport } from "./sport-module.mjs";
import { football } from "./football/index.mjs";

registerSport(football);
export * from "./sport-module.mjs";
