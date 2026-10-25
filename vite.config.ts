import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const appEnv = (process.env.APP_ENV || "preview").toLowerCase();

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_ENV__: JSON.stringify(appEnv),
  },
  build: { sourcemap: false },
});
