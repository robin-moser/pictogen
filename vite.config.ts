import preact from "@preact/preset-vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [preact()],
  build: {
    outDir: "dist/client",
  },
  server: {
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});
