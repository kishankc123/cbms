import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { guessMapping, mappingProblem } from "./statement-columns";
import { buildStatementTemplate, STATEMENT_HEADERS } from "./statement-template";

describe("the supplier statement template", () => {
  it("has headings the column guesser recognises, so nothing needs choosing", () => {
    const wb = XLSX.read(buildStatementTemplate(), { type: "base64" });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Statement"]);
    const headers = Object.keys(rows[0]);
    expect(headers).toEqual([...STATEMENT_HEADERS]);
    const m = guessMapping(headers);
    expect(m).toMatchObject({ date: "Date", reference: "Document no.", description: "Particulars", debit: "Debit", credit: "Credit", balance: "Balance" });
    expect(mappingProblem(m)).toBeNull();
    expect(wb.SheetNames).toContain("How to fill");
  });
});
