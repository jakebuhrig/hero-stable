import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { localApi } from "./dev-api";

export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === "localdev" ? [localApi()] : [])],
  server: {
    port: 5173,
    // Owlbear loads the extension from another origin.
    cors: true,
    headers: { "Access-Control-Allow-Origin": "*" },
  },
  build: {
    rollupOptions: {
      input: {
        hub: resolve(__dirname, "index.html"),
        host: resolve(__dirname, "host.html"),
      },
    },
  },
}));
