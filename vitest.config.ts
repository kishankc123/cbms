import { defineConfig } from "vitest/config";
import path from "path";

// Fast unit tests only (no database). Integration tests (*.int.test.ts) run with `npm run test:integration`.
export default defineConfig({
  test: { environment: "node", include: ["src/**/*.test.ts"], exclude: ["**/node_modules/**", "**/*.int.test.ts"] },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
});
