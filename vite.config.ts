/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      // AWS Health moved to health.aws.amazon.com; old endpoint 301s to this URL,
      // which the browser follows directly (bypassing the proxy) and gets CORS blocked.
      "/api/aws-health": {
        target: "https://health.aws.amazon.com",
        changeOrigin: true,
        // false: Node.js uses its own OpenSSL (not the system keychain), so corporate
        // TLS-inspection certs (e.g. Zscaler) are rejected at the proxy layer.
        secure: false,
        rewrite: () => "/public/currentevents",
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules", "dist"],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "html"],
      reportsDirectory: "./coverage",
      exclude: [
        "**/*.test.{ts,tsx}",
        "**/*.spec.{ts,tsx}",
        "src/test/**",
        "src/main.tsx",
        "src/components/ui/**",
      ],
    },
  },
});
