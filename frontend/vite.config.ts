import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true
      },
      "/action": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true
      },
      "/mcp": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true
      },
      "/oauth": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true
      },
      "/.well-known": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true
      }
    }
  }
});
