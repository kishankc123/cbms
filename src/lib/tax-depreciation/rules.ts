// Tax depreciation rules for a country, published by a platform administrator in dated versions (like payroll rules). Nothing here touches the
// ledger: tax depreciation is a separate layer used only for the profit-to-taxable-profit reconciliation.

export type PoolKind = "pooled" | "individual";

export type PoolRule = {
  key: string; // "A" | "B" | "C" | "D" | "E"
  label: string;
  kind: PoolKind; // pooled: all assets of the class share one balance. individual: every asset is its own class (Category E)
  /** Percent a year for a pooled class; null for an individual class, whose rate comes from the period of use. */
  ratePercent: number | null;
  /** After normal depreciation, a remaining balance below this is written off too (A-D). null = rule does not apply. */
  writeOffBelow: number | null;
};

/** Which months (calendar numbers of the country's tax calendar) an addition falls in, and how many thirds of it enter the pool this year. */
export type TimingBand = { fromMonth: number; toMonth: number; thirds: 1 | 2 | 3 };

export type StatutoryAdditionType = { key: string; label: string; legalReference: string; requiresEvidence: boolean };

export type ConcessionRule = {
  key: string;
  label: string;
  legalReference: string;
  /** extra_rate: raises the rate by this fraction of itself. same_year: deducts this percent of a qualifying addition's cost in the year. */
  kind: "extra_rate" | "same_year";
  extraRateFraction?: number;
  sameYearPercent?: number;
};

export type TaxDepreciationRules = {
  legalReference: string;
  /** The tax year starts in this month of the tax calendar (Nepal: Shrawan = 4). */
  taxYearStartMonth: number;
  pools: PoolRule[];
  timing: TimingBand[];
  statutoryAdditions: StatutoryAdditionType[];
  concessions: ConcessionRule[];
};

export const NEPAL_TAX_DEPRECIATION_RULES: TaxDepreciationRules = {
  legalReference: "Income Tax Act 2058, Schedule 2",
  taxYearStartMonth: 4,
  pools: [
    { key: "A", label: "Class A: buildings and permanent structures", kind: "pooled", ratePercent: 5, writeOffBelow: 2000 },
    { key: "B", label: "Class B: computers, furniture and office equipment", kind: "pooled", ratePercent: 25, writeOffBelow: 2000 },
    { key: "C", label: "Class C: automobiles, buses and minibuses", kind: "pooled", ratePercent: 20, writeOffBelow: 2000 },
    { key: "D", label: "Class D: construction, excavation and other tangible assets", kind: "pooled", ratePercent: 15, writeOffBelow: 2000 },
    { key: "E", label: "Class E: intangible assets (each its own class)", kind: "individual", ratePercent: null, writeOffBelow: null },
  ],
  timing: [
    { fromMonth: 4, toMonth: 9, thirds: 3 }, // Shrawan - Poush
    { fromMonth: 10, toMonth: 12, thirds: 2 }, // Magh - Chaitra
    { fromMonth: 1, toMonth: 3, thirds: 1 }, // Baisakh - Ashadh
  ],
  statutoryAdditions: [
    { key: "repair_excess", label: "Excess repair and maintenance expenditure", legalReference: "Income Tax Act 2058, Section 16(3)", requiresEvidence: true },
    { key: "pollution_control", label: "Capitalised pollution-control expenditure", legalReference: "Income Tax Act 2058, Section 17(3)", requiresEvidence: true },
    { key: "research_development", label: "Capitalised research and development expenditure", legalReference: "Income Tax Act 2058, Section 18(3)", requiresEvidence: true },
    { key: "other_authorised", label: "Other specifically authorised statutory addition", legalReference: "", requiresEvidence: true },
  ],
  concessions: [
    { key: "extra_third_rate", label: "Additional one-third depreciation rate", legalReference: "Income Tax Act 2058, Schedule 2, Section 3(2)", kind: "extra_rate", extraRateFraction: 1 / 3 },
    { key: "energy_generation_half", label: "50% same-year deduction: energy-generation property used in the business", legalReference: "Income Tax Act 2058, Schedule 2", kind: "same_year", sameYearPercent: 50 },
    { key: "fiscal_printer_full", label: "Same-year deduction: fiscal printers and cash machines issuing bills", legalReference: "Income Tax Act 2058, Schedule 2", kind: "same_year", sameYearPercent: 100 },
  ],
};

export type RulesCheck = { ok: true; rules: TaxDepreciationRules } | { ok: false; error: string };

/** Checks rules a platform administrator typed in, with plain messages. */
export function checkTaxDepreciationRules(input: unknown): RulesCheck {
  const r = input as TaxDepreciationRules;
  if (!r || typeof r !== "object") return { ok: false, error: "The rules are missing." };
  if (!r.legalReference?.trim()) return { ok: false, error: "Name the law these rules come from." };
  if (!Number.isInteger(r.taxYearStartMonth) || r.taxYearStartMonth < 1 || r.taxYearStartMonth > 12) return { ok: false, error: "The tax year has to start in a month from 1 to 12." };
  if (!Array.isArray(r.pools) || r.pools.length === 0) return { ok: false, error: "Add at least one depreciation class." };
  const keys = new Set<string>();
  for (const p of r.pools) {
    if (!p.key?.trim() || !p.label?.trim()) return { ok: false, error: "Every class needs a letter and a name." };
    if (keys.has(p.key)) return { ok: false, error: `Class ${p.key} is listed twice.` };
    keys.add(p.key);
    if (p.kind === "pooled" && !(p.ratePercent !== null && p.ratePercent > 0 && p.ratePercent <= 100)) return { ok: false, error: `Class ${p.key} needs a rate above 0 and up to 100 percent.` };
    if (p.writeOffBelow !== null && p.writeOffBelow < 0) return { ok: false, error: `Class ${p.key} has a negative write-off limit.` };
  }
  // Every month of the year has to be in exactly one timing band.
  const seen = new Map<number, number>();
  for (const b of r.timing ?? []) {
    if (![1, 2, 3].includes(b.thirds)) return { ok: false, error: "A timing band can let in one, two or three thirds." };
    for (let m = b.fromMonth; ; m = (m % 12) + 1) {
      seen.set(m, (seen.get(m) ?? 0) + 1);
      if (m === b.toMonth) break;
    }
  }
  for (let m = 1; m <= 12; m++) if (seen.get(m) !== 1) return { ok: false, error: seen.get(m) ? `Month ${m} is in more than one timing band.` : `Month ${m} is not in any timing band.` };
  return { ok: true, rules: r };
}

export function sameTaxDepreciationRules(a: TaxDepreciationRules, b: TaxDepreciationRules): boolean {
  const sort = (v: unknown): unknown => (Array.isArray(v) ? v.map(sort) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([x], [y]) => x.localeCompare(y)).map(([k, x]) => [k, sort(x)])) : v);
  return JSON.stringify(sort(a)) === JSON.stringify(sort(b));
}
