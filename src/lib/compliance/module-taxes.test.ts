import { describe, expect, it } from "vitest";
import { effectOfRow, moduleLabel, TAX_BEARERS, TAX_METHODS, TAX_MODULES, TAX_POSTS_TO, TAX_PRICE_BASES } from "./module-taxes";

describe("applicable taxes", () => {
  it("has no repeated keys in any list, so a saved key always means one thing", () => {
    for (const list of [TAX_MODULES, TAX_METHODS, TAX_BEARERS, TAX_PRICE_BASES, TAX_POSTS_TO]) expect(new Set(list.map((x) => x.key)).size).toBe(list.length);
  });

  it("says in plain words what a row does", () => {
    const lines = effectOfRow("expenses", "TDS", { method: "heading", bearer: "withheld", priceBasis: "on_amount", postsTo: "tds_payable" });
    expect(lines[0]).toBe("Expenses: TDS is worked out by heading, at each heading's rate.");
    expect(lines[1]).toBe("TDS is held back from the payee in Expenses and owed to the tax office.");
    expect(lines[2]).toBe("Tax is on the taxable amount. Posted to TDS Payable (the heading's).");
    expect(effectOfRow("sales", "VAT", { method: "flat", bearer: "collected", priceBasis: "inclusive", postsTo: "output_vat" })[1]).toMatch(/charges VAT to the customer/);
    expect(effectOfRow("purchases", "VAT", { method: "flat", bearer: "claimable", priceBasis: "inclusive", postsTo: "input_vat" })[1]).toMatch(/claimed back/);
    expect(moduleLabel("assets")).toBe("Fixed assets");
    expect(moduleLabel("unknown")).toBe("unknown");
  });
});
