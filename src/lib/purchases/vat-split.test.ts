import { describe, expect, it } from "vitest";
import { addSplit, splitDocument, splitExpense } from "./vat-split";

const line = (rate: number, quantity: number, taxTreatment?: "taxable" | "zero_rated" | "exempt", discount = 0) => ({ rate, quantity, discount, taxTreatment });

describe("splitting a purchase for the VAT figures", () => {
  it("separates the lines of a mixed VAT bill, and the parts add up to the subtotal", () => {
    expect(splitDocument({ billType: "vat", subtotal: 12000, taxAmount: 1300, lines: [line(1000, 10), line(500, 4, "exempt")] })).toEqual({ taxable: 10000, zeroRated: 0, exempt: 2000, noVatBill: 0 });
    expect(splitDocument({ billType: "vat", subtotal: 1100, taxAmount: 117, lines: [line(1000, 1, "taxable", 100), line(200, 1, "zero_rated")] })).toEqual({ taxable: 900, zeroRated: 200, exempt: 0, noVatBill: 0 });
  });

  it("keeps PAN, estimate, challan and no-bill purchases out of the taxable figure", () => {
    for (const billType of ["pan", "estimate", "challan", "no_bill"]) expect(splitDocument({ billType, subtotal: 5000, taxAmount: 0 })).toEqual({ taxable: 0, zeroRated: 0, exempt: 0, noVatBill: 5000 });
  });

  it("reads an old VAT bill or one carrying VAT as taxable", () => {
    expect(splitDocument({ billType: "vat", subtotal: 400, taxAmount: 52, lines: [] }).taxable).toBe(400);
    expect(splitDocument({ billType: "no_bill", subtotal: 400, taxAmount: 52 }).taxable).toBe(400);
  });

  it("counts an all-exempt VAT bill and an all-exempt return as exempt", () => {
    expect(splitDocument({ billType: "vat", subtotal: 800, taxAmount: 0, lines: [line(400, 2, "exempt")] })).toEqual({ taxable: 0, zeroRated: 0, exempt: 800, noVatBill: 0 });
    expect(splitDocument({ subtotal: 800, taxAmount: 0, lines: [line(400, 2, "exempt")] }).exempt).toBe(800);
    expect(splitDocument({ subtotal: 800, taxAmount: 0, lines: [line(400, 2)] }).noVatBill).toBe(800);
  });

  it("splits a bill recorded by amount, which has no lines yet", () => {
    expect(splitDocument({ billType: "vat", subtotal: 12000, taxAmount: 1300, lines: [], pendingExempt: 2000 })).toEqual({ taxable: 10000, zeroRated: 0, exempt: 2000, noVatBill: 0 });
  });

  it("counts an expense only when it is a VAT document", () => {
    expect(splitExpense({ billType: "vat", taxTreatment: "taxable", taxableAmount: 1000, vatAmount: 130 }).taxable).toBe(1000);
    expect(splitExpense({ billType: "vat", taxTreatment: "exempt", taxableAmount: 1000, vatAmount: 0 }).exempt).toBe(1000);
    expect(splitExpense({ billType: "pan", taxTreatment: "taxable", taxableAmount: 1000, vatAmount: 0 })).toEqual({ taxable: 0, zeroRated: 0, exempt: 0, noVatBill: 0 });
  });

  it("takes returns off", () => {
    expect(addSplit({ taxable: 100, zeroRated: 0, exempt: 50, noVatBill: 10 }, { taxable: 30, zeroRated: 0, exempt: 50, noVatBill: 0 }, -1)).toEqual({ taxable: 70, zeroRated: 0, exempt: 0, noVatBill: 10 });
  });
});
