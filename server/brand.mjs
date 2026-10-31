// The product name lives here and in the APP_NAME env var ONLY. Working name pending trademark clearance:
// renaming is a one-line change (this default) or a Railway variable change. No logo assets ship with this phase.
export const DEFAULT_APP_NAME = "Simculus";
export const appName = (env = process.env) => (env.APP_NAME || "").trim() || DEFAULT_APP_NAME;
