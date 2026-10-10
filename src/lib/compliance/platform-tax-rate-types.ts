// Client-safe pieces of the platform tax rates (no database): what can be published, and the shape of a published version.

export const PUBLISHABLE_TAX_TYPES = [
  { key: "vat", label: "VAT" },
  { key: "tds", label: "TDS" },
] as const;
export type PublishableTaxType = (typeof PUBLISHABLE_TAX_TYPES)[number]["key"];

export type RateVersion = { id: string; rate: number; effectiveFrom: string; effectiveTo: string | null; isVerified: boolean; source: string | null; inForce: boolean };
