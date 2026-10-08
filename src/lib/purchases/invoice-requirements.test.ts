import { describe, expect, it } from "vitest";
import { invoiceRequirements } from "./invoice-requirements";

describe("what a stockable purchase invoice must carry", () => {
  it("needs neither the supplier nor the invoice number for a non-VAT bill paid in full", () => {
    for (const billType of ["no_bill", "estimate", "pan", "challan"]) {
      expect(invoiceRequirements({ billType, total: 1000, paid: 1000 })).toMatchObject({ fullyPaid: true, supplierRequired: false, numberRequired: false });
    }
  });
  it("needs both for a VAT bill, even when paid in full", () => {
    expect(invoiceRequirements({ billType: "vat", total: 1130, paid: 1130 })).toMatchObject({ supplierRequired: true, numberRequired: true, reason: expect.stringMatching(/VAT bill/) });
  });
  it("needs both when the payment does not clear the invoice", () => {
    expect(invoiceRequirements({ billType: "no_bill", total: 1000, paid: 400 })).toMatchObject({ fullyPaid: false, supplierRequired: true, numberRequired: true, reason: expect.stringMatching(/balance is owed/) });
    expect(invoiceRequirements({ billType: "pan", total: 1000, paid: 0 })).toMatchObject({ supplierRequired: true, numberRequired: true });
  });
  it("treats rounding dust as paid in full, and an empty invoice as not paid", () => {
    expect(invoiceRequirements({ billType: "no_bill", total: 1000, paid: 999.996 }).fullyPaid).toBe(true);
    expect(invoiceRequirements({ billType: "no_bill", total: 0, paid: 0 }).fullyPaid).toBe(false);
  });
});
