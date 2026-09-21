import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { normalizeStatementRows } from "./normalize-rows";

const headers = ["Date", "Description", "Amount"];
const map = { date: "Date", description: "Description", amount: "Amount" };
const run = (rows: string[][]) => normalizeStatementRows(headers, rows, map, { choice: "AD" }).valid;

describe("statement import identity", () => {
  it("keeps two identical transactions on the same day as two transactions", () => {
    const rows = run([
      ["2026-09-01", "ATM withdrawal", "-5000"],
      ["2026-09-01", "ATM withdrawal", "-5000"],
      ["2026-09-02", "Deposit", "300"],
    ]);
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.dedupeHash)).size).toBe(3);
  });

  it("gives the first of any identical rows the plain identity, so earlier imports still match", () => {
    const [first] = run([["2026-09-01", "ATM withdrawal", "-5000"]]);
    expect(first.dedupeHash).toBe(createHash("sha256").update("2026-09-01|-5000.00|ATM withdrawal|").digest("hex"));
  });

  it("recognises every row again when the same file is imported twice, or an overlapping one", () => {
    const file = [
      ["2026-09-01", "ATM withdrawal", "-5000"],
      ["2026-09-01", "ATM withdrawal", "-5000"],
    ];
    const a = run(file).map((r) => r.dedupeHash);
    const b = run(file).map((r) => r.dedupeHash);
    expect(b).toEqual(a);
    // a later statement that starts with just the first of them: that row is already known, nothing else is
    const overlap = run([["2026-09-01", "ATM withdrawal", "-5000"]]).map((r) => r.dedupeHash);
    expect(overlap[0]).toBe(a[0]);
    expect(a[1]).not.toBe(a[0]);
  });
});
