import { defineConfig } from "vitest/config";
import path from "path";

// Integration tests: run against the database in DATABASE_URL using throwaway organizations that are
// removed afterwards. Start with: npm run test:integration  (loads .env)
export default defineConfig({
  // next-auth imports "next/server" without the .js ending, which plain Node cannot resolve: it is run through Vite here so the sign-in code can load.
  test: { environment: "node", include: ["src/**/*.int.test.ts"], testTimeout: 60_000, hookTimeout: 60_000, fileParallelism: false, server: { deps: { inline: [/next-auth/, /@auth/] } } },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
});
