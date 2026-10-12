import { describe, expect, it } from "vitest";
import { buildStatementTemplate } from "./statement-template";
import { parseStatementFile } from "./parse-statement";
import { normalizeStatementRows } from "./normalize-rows";

describe("sample statement file", () => {
  it("is read back by the upload, with every example row usable", () => {
    const { headers, rows } = parseStatementFile(buildStatementTemplate(), "bank-statement-sample.xlsx");
    expect(headers).toEqual(["Date", "Description", "Reference", "Debit", "Credit", "Balance"]);
    const { valid, skipped } = normalizeStatementRows(headers, rows, { date: "Date", description: "Description", reference: "Reference", debit: "Debit", credit: "Credit", balance: "Balance" });
    expect(skipped).toBe(0);
    expect(valid.map((r) => r.amount)).toEqual([50000, -12500, 8200, -150]);
  });
});
