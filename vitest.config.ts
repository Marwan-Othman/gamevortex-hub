import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    // Vercel builds run with NODE_ENV=production; the production-only secret
    // strength checks would reject the fixed test secrets.
    env: { NODE_ENV: "test" },
  },
  resolve: {
    alias: {
      "@": rootDir,
    },
  },
});
