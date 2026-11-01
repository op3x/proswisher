// The product name lives here and in the APP_NAME env var ONLY. Working name pending trademark clearance:
// Final name "Simculus Sports" (Ryan, 10/31). Logo assets live in public/brand (from simculus/brand/final).
export const DEFAULT_APP_NAME = "Simculus Sports";
export const appName = (env = process.env) => (env.APP_NAME || "").trim() || DEFAULT_APP_NAME;
