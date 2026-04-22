import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { cartographer } from "@replit/vite-plugin-cartographer";
import { devBanner } from "@replit/vite-plugin-dev-banner";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

const rawPort = process.env.PORT ?? "3000";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH ?? "/";
const apiProxyTarget = process.env.API_PROXY_TARGET ?? "http://127.0.0.1:8080";
const enableReplitDevPlugins =
  process.env.NODE_ENV !== "production" && process.env.REPL_ID !== undefined;

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(enableReplitDevPlugins
      ? [
          cartographer({
            root: path.resolve(import.meta.dirname, ".."),
          }),
          devBanner(),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    host: true,
    strictPort: true,
    allowedHosts: true,
    proxy: {
      "/api": {
        target: apiProxyTarget,
        changeOrigin: true,
      },
    },
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
  preview: {
    port,
    host: true,
    strictPort: true,
    allowedHosts: true,
  },
});
