import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const appName = (process.env.APP_NAME || "").trim() || "Simculus";
const appEnv = (process.env.APP_ENV || "preview").toLowerCase();

export default defineConfig({
  plugins: [react(), { name: "app-name", transformIndexHtml: (h) => h.replace(/%APP_NAME%/g, appName) }],
  define: {
    __APP_ENV__: JSON.stringify(appEnv),
    __APP_NAME__: JSON.stringify(appName),
  },
  build: { sourcemap: false },
});
