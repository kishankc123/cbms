import { describe, expect, it } from "vitest";
import { expenseColumnGuide, guideSheet, purchaseColumnGuide, salesColumnGuide } from "./column-guide";
import { templateMapping } from "@/lib/import-columns";
import { IMPORT_FIELDS } from "./fields";

describe("the column guide", () => {
  it("has a row for every column of every import, with the required ones marked", () => {
    expect(salesColumnGuide().map((g) => g.column)).toContain("Revenue account");
    for (const g of [salesColumnGuide(), purchaseColumnGuide(), expenseColumnGuide()]) {
      expect(g.filter((r) => r.needed === "Required").map((r) => r.column)).toEqual(["Date", "Amount"]);
      expect(g.every((r) => r.accepts && r.example)).toBe(true);
    }
    expect(guideSheet(salesColumnGuide())[0]).toEqual(["Column", "Required?", "What to enter", "Example"]);
  });
  it("covers the payment parts: a second and a third amount and account", () => {
    for (const g of [salesColumnGuide(), purchaseColumnGuide(), expenseColumnGuide()]) expect(g.map((r) => r.column)).toEqual(expect.arrayContaining(["Paid amount 2", "Paid amount 3"]));
    expect(salesColumnGuide().map((r) => r.column)).toEqual(expect.arrayContaining(["Received into 2", "Received into 3"]));
  });
  it("tells the revenue column from the received-into column", () => {
    expect(templateMapping(IMPORT_FIELDS, ["Date", "Amount", "Revenue Account", "Received Into"])).toMatchObject({ revenue: "Revenue Account", account: "Received Into" });
  });
});
