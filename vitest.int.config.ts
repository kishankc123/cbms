import { defineConfig } from "vitest/config";
import path from "path";

// Integration tests: run against the database in DATABASE_URL using throwaway organizations that are
// removed afterwards. Start with: npm run test:integration  (loads .env.local)
export default defineConfig({
  test: { environment: "node", include: ["src/**/*.int.test.ts"], testTimeout: 60_000, hookTimeout: 60_000, fileParallelism: false },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
});
