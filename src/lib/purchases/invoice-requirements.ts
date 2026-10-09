// What a stockable purchase invoice has to say about itself. A VAT bill must carry the supplier's invoice number and the supplier
// (the VAT is claimed against them); so must any bill that is not settled in full, because the unpaid balance is owed to someone.
// A No bill, Estimate, PAN or Challan purchase paid in full needs neither: the number is generated and there may be no supplier.
// A No bill or Estimate has no invoice number of its own to copy, so the number is never required for it (a generated one is used);
// an unpaid balance on one still needs the supplier, because it is owed to someone.

export type PurchaseBillTypeKey = "vat" | "pan" | "estimate" | "challan" | "no_bill";

export type InvoiceRequirements = {
  fullyPaid: boolean;
  supplierRequired: boolean;
  numberRequired: boolean;
  /** Why they are required, in words for the message. Empty when they are not. */
  reason: string;
};

export function invoiceRequirements(i: { billType: PurchaseBillTypeKey | string; total: number; paid: number }): InvoiceRequirements {
  const fullyPaid = i.total > 0 && i.total - i.paid <= 0.005;
  const vat = i.billType === "vat";
  const supplierRequired = vat || !fullyPaid;
  const noInvoiceOfItsOwn = i.billType === "no_bill" || i.billType === "estimate";
  const numberRequired = vat || (!fullyPaid && !noInvoiceOfItsOwn);
  return { fullyPaid, supplierRequired, numberRequired, reason: vat ? "a VAT bill needs the supplier and their invoice number" : !fullyPaid ? "the payment does not cover the whole invoice, so the balance is owed to a supplier" : "" };
}
