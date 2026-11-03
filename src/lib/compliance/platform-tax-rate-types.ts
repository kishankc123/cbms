// Client-safe pieces of the platform tax rates (no database): what can be published, and the shape of a published version.

export type RateType = { key: string; label: string };

/**
 * The taxes that have one country-wide rate. TDS is not among them: it is split into headings (Rent, Services...) and each heading
 * has a rate of its own, published under the key "tds.<heading>" (see rateTypesFor).
 */
export const BASE_RATE_TYPES: RateType[] = [
  { key: "vat", label: "VAT" },
  { key: "income_tax", label: "Income tax" },
];

/** The key a heading's rate is published and stored under. */
export const headRateKey = (taxTypeKey: string, headKey: string) => `${taxTypeKey}.${headKey}`;

/** Who is paid, where a heading's rate depends on it (a company and a proprietorship are deducted at different rates). A supplier with none chosen takes the heading's own rate. */
export const PAYEE_TYPES: RateType[] = [
  { key: "company", label: "Company" },
  { key: "individual", label: "Proprietorship / individual" },
];
export const payeeTypeLabel = (key: string | null | undefined) => PAYEE_TYPES.find((p) => p.key === key)?.label ?? null;

/** The key a heading's rate for one kind of payee is published and stored under, such as "tds.services.company". */
export const payeeRateKey = (taxTypeKey: string, headKey: string, payeeType: string) => `${headRateKey(taxTypeKey, headKey)}.${payeeType}`;

/** Every rate a heading is published under: one, or one more for each kind of payee when the heading's rate depends on who is paid. */
export function headRateTypes(h: { taxTypeKey: string; key: string; name: string; byPayeeType: boolean }): RateType[] {
  const label = `${h.name} ${h.taxTypeKey.toUpperCase()}`;
  if (!h.byPayeeType) return [{ key: headRateKey(h.taxTypeKey, h.key), label }];
  return [{ key: headRateKey(h.taxTypeKey, h.key), label: `${label} — other or not stated` }, ...PAYEE_TYPES.map((p) => ({ key: payeeRateKey(h.taxTypeKey, h.key, p.key), label: `${label} — ${p.label.toLowerCase()}` }))];
}

/** A fiscal year of a country: `startYear` identifies it, `from`/`to` are its real (AD) first and last days. */
export type FiscalYear = { startYear: number; label: string; from: string; to: string };

/** `version` counts the versions that start in the same fiscal year (v1 is the first, v2 a change made during the year). */
export type RateVersion = { fiscalYear: string; version: number; id: string; rate: number; effectiveFrom: string; effectiveTo: string | null; isVerified: boolean; source: string | null; inForce: boolean };
