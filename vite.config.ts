import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const appEnv = (process.env.APP_ENV || "preview").toLowerCase();

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_ENV__: JSON.stringify(appEnv),
    // Payments are never wired in this build; flag exists so the UI can't accidentally enable them.
    __PAYMENTS_WIRED__: JSON.stringify(false),
  },
  build: { sourcemap: false },
});
