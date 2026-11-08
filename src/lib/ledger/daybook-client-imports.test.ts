import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// The Daybook screens that run in the browser must never import a value from the files that read the database (daybook.ts, cash-count.ts): the
// database driver cannot load in a browser and the whole page fails with a 500. Types are fine (they are erased); the pure files are the place for values.
const ROOT = "src/app/(app)/reports/daybook";
const SERVER_ONLY = /from\s+["']@\/lib\/ledger\/(daybook|cash-count)["']/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.(tsx?|ts)$/.test(n) ? [p] : [];
  });
}

describe("Daybook client screens", () => {
  it("import only types from the files that use the database", () => {
    const bad: string[] = [];
    for (const f of files(ROOT)) {
      const src = readFileSync(f, "utf8");
      if (!/^["']use client["']/.test(src.trimStart())) continue;
      for (const line of src.split("\n")) if (SERVER_ONLY.test(line) && !/^\s*import\s+type\b/.test(line)) bad.push(`${f}: ${line.trim()}`);
    }
    expect(bad).toEqual([]);
  });
});
