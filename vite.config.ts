import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const appName = (process.env.APP_NAME || "").trim() || "Simculus Sports";
// Contact is email only (Ryan 10/31): no physical address anywhere on the site.
const contactEmail = (process.env.CONTACT_EMAIL || "").trim() || "support@simculus.com";
const appEnv = (process.env.APP_ENV || "preview").toLowerCase();

export default defineConfig({
  plugins: [react(), { name: "app-name", transformIndexHtml: (h) => h.replace(/%APP_NAME%/g, appName) }],
  define: {
    __APP_ENV__: JSON.stringify(appEnv),
    __APP_NAME__: JSON.stringify(appName),
    __CONTACT_EMAIL__: JSON.stringify(contactEmail),
  },
  build: { sourcemap: false },
});
