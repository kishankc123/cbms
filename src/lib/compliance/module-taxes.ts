// Client-safe pieces of "Applicable taxes" (no database): which modules a country's taxes can apply in, and the choices that say how a tax
// applies in a module. The calculations themselves stay in code; this only chooses between them. Rates and slabs are never here.

export const TAX_MODULES = [
  { key: "sales", label: "Sales" },
  { key: "purchases", label: "Purchases" },
  { key: "expenses", label: "Expenses" },
  { key: "payroll", label: "Payroll" },
  { key: "assets", label: "Fixed assets" },
  { key: "returns", label: "Returns" },
] as const;
export type TaxModuleKey = (typeof TAX_MODULES)[number]["key"];
export const moduleLabel = (key: string) => TAX_MODULES.find((m) => m.key === key)?.label ?? key;

export const TAX_METHODS = [
  { key: "flat", label: "Flat rate" },
  { key: "heading", label: "By heading" },
  { key: "slab", label: "By income slab" },
] as const;

export const TAX_BEARERS = [
  { key: "collected", label: "Collected from the customer" },
  { key: "claimable", label: "Paid to the supplier, claimable" },
  { key: "borne", label: "Paid to the supplier, not claimable" },
  { key: "withheld", label: "Withheld from the payee" },
  { key: "reverses", label: "Reverses the tax of the sale or purchase returned" },
] as const;

export const TAX_PRICE_BASES = [
  { key: "inclusive", label: "Includes the tax" },
  { key: "exclusive", label: "Tax is added on top" },
  { key: "on_amount", label: "Tax is on the taxable amount" },
] as const;

export const TAX_POSTS_TO = [
  { key: "output_vat", label: "Output VAT" },
  { key: "input_vat", label: "Input VAT" },
  { key: "tds_payable", label: "TDS Payable (the heading's)" },
  { key: "tax_payable", label: "The tax's payable account" },
] as const;

const labelOf = (list: readonly { key: string; label: string }[], key: string) => list.find((x) => x.key === key)?.label ?? key;
export const methodLabel = (key: string) => labelOf(TAX_METHODS, key);
export const bearerLabel = (key: string) => labelOf(TAX_BEARERS, key);
export const priceBasisLabel = (key: string) => labelOf(TAX_PRICE_BASES, key);
export const postsToLabel = (key: string) => labelOf(TAX_POSTS_TO, key);

/** One module-and-tax row, as the editor works with it. */
export type ModuleTaxChoice = { method: string; bearer: string; priceBasis: string; postsTo: string };

/** What saving a row changes in the app, in plain words, for the editor to show. */
export function effectOfRow(moduleKey: string, taxName: string, c: ModuleTaxChoice): string[] {
  const place = moduleLabel(moduleKey);
  const lines = [`${place}: ${taxName} is ${c.method === "flat" ? "worked out at the published flat rate" : c.method === "heading" ? "worked out by heading, at each heading's rate" : "worked out from income slabs"}.`];
  lines.push(
    c.bearer === "collected"
      ? `${place} charges ${taxName} to the customer and owes it to the tax office.`
      : c.bearer === "claimable"
        ? `${taxName} paid to suppliers in ${place} is claimed back.`
        : c.bearer === "borne"
          ? `${taxName} paid to suppliers in ${place} is part of the cost; it is not claimed back.`
          : c.bearer === "withheld"
            ? `${taxName} is held back from the payee in ${place} and owed to the tax office.`
            : `${place} reverses the ${taxName} of the sale or purchase it returns.`
  );
  lines.push(`${priceBasisLabel(c.priceBasis)}. Posted to ${postsToLabel(c.postsTo)}.`);
  return lines;
}
