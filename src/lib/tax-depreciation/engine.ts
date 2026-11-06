import { timingThirds } from "./dates";
import type { ConcessionRule, PoolRule, TaxDepreciationRules } from "./rules";

// The tax depreciation of one class for one tax year. Pure: it reads nothing and writes nothing, so the screen's preview, the saved
// schedule and the tests all use the same numbers.
//
// Pooled class (A-D), in order:
//   additions       each addition counts for thirds/3 of its cost this year; the rest is a DEFERRED addition for next year (the rate is never changed)
//   base            opening balance + this year's part of additions + deferred additions due from earlier years + statutory additions
//   disposals       proceeds come off the base; proceeds above the base are a BALANCING CHARGE (taxable income), never discarded
//   depreciation    base x rate; if what is left is under the write-off limit it is written off as well
// A class is DISSOLVED when every asset in it was disposed of in the year. Then there is no depreciation: the whole remaining value
// (including deferred additions, this year's and next) is set against the proceeds, giving a balancing charge or a terminal deduction.

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export type AdditionIn = { id: string; label: string; cost: number; /** the later of entering the class and the cost being incurred */ date: string; /** a same-year concession this addition qualifies for */ concessionKey?: string };
export type DeferredIn = { id: string; amount: number };
export type StatutoryIn = { type: string; label: string; amount: number; legalReference: string; evidence: string };
export type DisposalIn = { assetId: string; proceeds: number; date: string };
export type ConcessionUse = { key: string; confirmed: boolean; documentation: string };

export type PoolInput = {
  pool: PoolRule;
  rules: TaxDepreciationRules;
  openingWdv: number;
  additions: AdditionIn[];
  /** deferred additions from earlier years that fall due this year */
  priorDeferred: DeferredIn[];
  statutory: StatutoryIn[];
  disposals: DisposalIn[];
  /** every depreciable asset in the class was disposed of before the year ended */
  dissolved: boolean;
  /** an individual class (E): the years the asset is expected to be used, rounded to the nearest half year to give its rate */
  periodOfUseYears?: number | null;
  concessions?: ConcessionUse[];
  /** the class has something a person should look at (an unclear classification) */
  needsReview?: boolean;
};

export type AdditionLine = { id: string; label: string; cost: number; date: string; thirds: 1 | 2 | 3; currentYear: number; deferred: number; sameYearDeduction: number; concessionKey: string | null };

export type PoolResult = {
  poolKey: string;
  openingWdv: number;
  additionLines: AdditionLine[];
  currentYearAdditions: number;
  /** the part of this year's additions that waits for next year */
  deferredAdditions: number;
  priorDeferredReceived: number;
  statutoryAdditions: number;
  baseBeforeProceeds: number;
  disposalProceeds: number;
  depreciationBase: number;
  ratePercent: number;
  normalDepreciation: number;
  remainingAfterNormal: number;
  additionalDepreciation: number;
  sameYearDeductions: number;
  /** taxable income: proceeds above the value they are set against */
  balancingCharge: number;
  /** deduction: value above the proceeds when the class is dissolved */
  terminalDeduction: number;
  totalDeduction: number;
  closingWdv: number;
  dissolved: boolean;
  /** deferred amount that goes into next year's register (zero when the class is dissolved: it was settled) */
  deferredCarriedForward: number;
  /** the register rows that were settled by dissolution */
  settledByDissolution: boolean;
  reviewFlags: string[];
};

/** The yearly rate of an individual class from the years it is expected to be used, rounded to the nearest half year. */
export function individualRatePercent(years: number): number {
  if (!(years > 0)) throw new Error("Enter the period of use, in years, for this intangible asset.");
  const half = Math.max(0.5, Math.round(years * 2) / 2);
  return round2(100 / half);
}

function concessionOf(rules: TaxDepreciationRules, key: string): ConcessionRule | undefined {
  return rules.concessions.find((c) => c.key === key);
}

export function computePool(input: PoolInput): PoolResult {
  const { pool, rules } = input;
  const flags: string[] = [];
  if (input.needsReview) flags.push("The classification of an asset in this class needs a review.");

  // A concession counts only once its conditions are confirmed and the paperwork is named.
  const usable = (key: string): ConcessionRule | undefined => {
    const c = concessionOf(rules, key);
    const use = input.concessions?.find((u) => u.key === key);
    if (!c) return undefined;
    if (!use || !use.confirmed || !use.documentation.trim()) {
      if (use) flags.push(`${c.label}: not applied, because the conditions are not confirmed with supporting documents.`);
      return undefined;
    }
    flags.push(`${c.label}: applied. Check the eligibility and keep the documents (${use.documentation.trim()}).`);
    return c;
  };

  // Rate
  let rate: number;
  if (pool.kind === "individual") rate = individualRatePercent(input.periodOfUseYears ?? 0);
  else rate = pool.ratePercent ?? 0;
  const extra = rules.concessions.find((c) => c.kind === "extra_rate" && usable(c.key));
  if (extra) rate = round2(rate * (1 + (extra.extraRateFraction ?? 0)));

  // Additions
  const additionLines: AdditionLine[] = input.additions.map((a) => {
    const thirds = timingThirds(a.date, rules);
    if (thirds === null) throw new Error(`The date of "${a.label}" is outside the supported calendar. Check it.`);
    const conc = a.concessionKey ? usable(a.concessionKey) : undefined;
    const sameYear = conc && conc.kind === "same_year" ? round2((a.cost * (conc.sameYearPercent ?? 0)) / 100) : 0;
    const rest = round2(a.cost - sameYear);
    const currentYear = round2((rest * thirds) / 3);
    return { id: a.id, label: a.label, cost: a.cost, date: a.date, thirds, currentYear, deferred: round2(rest - currentYear), sameYearDeduction: sameYear, concessionKey: a.concessionKey ?? null };
  });
  const currentYearAdditions = round2(additionLines.reduce((s, l) => s + l.currentYear, 0));
  const deferredAdditions = round2(additionLines.reduce((s, l) => s + l.deferred, 0));
  const sameYearDeductions = round2(additionLines.reduce((s, l) => s + l.sameYearDeduction, 0));
  const priorDeferredReceived = round2(input.priorDeferred.reduce((s, d) => s + d.amount, 0));
  const statutoryAdditions = round2(input.statutory.reduce((s, x) => s + x.amount, 0));
  for (const s of input.statutory) {
    if (!s.legalReference.trim() || !s.evidence.trim()) throw new Error(`"${s.label}" needs a legal reference and supporting evidence before it can be added.`);
  }
  const disposalProceeds = round2(input.disposals.reduce((s, d) => s + d.proceeds, 0));
  const baseBeforeProceeds = round2(input.openingWdv + currentYearAdditions + priorDeferredReceived + statutoryAdditions);

  const base = {
    poolKey: pool.key,
    openingWdv: round2(input.openingWdv),
    additionLines,
    currentYearAdditions,
    deferredAdditions,
    priorDeferredReceived,
    statutoryAdditions,
    baseBeforeProceeds,
    disposalProceeds,
    ratePercent: rate,
    sameYearDeductions,
  };

  // Dissolved: settle the whole class against the proceeds.
  if (input.dissolved) {
    const remainingValue = round2(baseBeforeProceeds + deferredAdditions);
    const balancingCharge = round2(Math.max(0, disposalProceeds - remainingValue));
    const terminalDeduction = round2(Math.max(0, remainingValue - disposalProceeds));
    flags.push("The class was dissolved: every asset in it was disposed of. Review the balancing figure.");
    if (balancingCharge > 0) flags.push("Proceeds are above the remaining value: the balancing charge is taxable income.");
    const reviewFlags = [...new Set(flags)];
    return {
      ...base,
      depreciationBase: 0,
      normalDepreciation: 0,
      remainingAfterNormal: 0,
      additionalDepreciation: 0,
      balancingCharge,
      terminalDeduction,
      totalDeduction: round2(terminalDeduction + sameYearDeductions),
      closingWdv: 0,
      dissolved: true,
      deferredCarriedForward: 0,
      settledByDissolution: true,
      reviewFlags,
    };
  }

  const balancingCharge = round2(Math.max(0, disposalProceeds - baseBeforeProceeds));
  if (balancingCharge > 0) flags.push("Disposal proceeds are above the class value: the excess is a balancing charge (taxable income). Review it.");
  const depreciationBase = round2(Math.max(0, baseBeforeProceeds - disposalProceeds));
  const normalDepreciation = round2((depreciationBase * rate) / 100);
  const remainingAfterNormal = round2(depreciationBase - normalDepreciation);
  const writeOff = pool.writeOffBelow !== null && remainingAfterNormal > 0 && remainingAfterNormal < pool.writeOffBelow;
  const additionalDepreciation = writeOff ? remainingAfterNormal : 0;
  const closingWdv = round2(remainingAfterNormal - additionalDepreciation);
  if (input.disposals.length > 0 && deferredAdditions + priorDeferredReceived > 0) flags.push("An asset was disposed of while deferred additions are pending: they stay in the class as the law allows. Review.");
  return {
    ...base,
    depreciationBase,
    normalDepreciation,
    remainingAfterNormal,
    additionalDepreciation,
    balancingCharge,
    terminalDeduction: 0,
    totalDeduction: round2(normalDepreciation + additionalDepreciation + sameYearDeductions),
    closingWdv,
    dissolved: false,
    deferredCarriedForward: deferredAdditions,
    settledByDissolution: false,
    reviewFlags: [...new Set(flags)],
  };
}
