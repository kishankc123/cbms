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

/** A fiscal year of a country: `startYear` identifies it, `from`/`to` are its real (AD) first and last days. */
export type FiscalYear = { startYear: number; label: string; from: string; to: string };

/** `version` counts the versions that start in the same fiscal year (v1 is the first, v2 a change made during the year). */
export type RateVersion = { fiscalYear: string; version: number; id: string; rate: number; effectiveFrom: string; effectiveTo: string | null; isVerified: boolean; source: string | null; inForce: boolean };
