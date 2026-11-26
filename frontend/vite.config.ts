import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const api = process.env.CRISPAI_API ?? "http://127.0.0.1:3000";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom", "@tanstack/react-query"],
          heroui: ["@heroui/react", "framer-motion"],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: { "/api": { target: api, changeOrigin: false } },
  },
});
