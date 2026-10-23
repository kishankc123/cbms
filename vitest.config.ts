import { defineConfig } from "vitest/config";
import path from "path";

// Dates in these tests are UTC midnights (the calendar engine works on plain YYYY-MM-DD). Some of the libraries the BS
// cross-check compares against read the machine's local timezone, so pin it: the suite then gives the same answer on a
// laptop in any timezone and on CI.
process.env.TZ = "UTC";

// Fast unit tests only (no database). Integration tests (*.int.test.ts) run with `npm run test:integration`.
export default defineConfig({
  test: { environment: "node", include: ["src/**/*.test.ts"], exclude: ["**/node_modules/**", "**/*.int.test.ts"] },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
});
