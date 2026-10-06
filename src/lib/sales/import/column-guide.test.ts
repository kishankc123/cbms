import { describe, expect, it } from "vitest";
import { expenseColumnGuide, guideSheet, purchaseColumnGuide, salesColumnGuide } from "./column-guide";
import { suggestMapping } from "./fields";

describe("the column guide", () => {
  it("has a row for every column of every import, with the required ones marked", () => {
    expect(salesColumnGuide().map((g) => g.column)).toContain("Revenue account");
    for (const g of [salesColumnGuide(), purchaseColumnGuide(), expenseColumnGuide()]) {
      expect(g.filter((r) => r.needed === "Required").map((r) => r.column)).toEqual(["Date", "Amount"]);
      expect(g.every((r) => r.accepts && r.example)).toBe(true);
    }
    expect(guideSheet(salesColumnGuide())[0]).toEqual(["Column", "Required?", "What to enter", "Example", "Other names it is found by"]);
  });
  it("finds a revenue column without taking the received-into column", () => {
    expect(suggestMapping(["Date", "Amount", "Revenue Account", "Received Into"])).toMatchObject({ revenue: "Revenue Account", account: "Received Into" });
  });
});
