// What kinds of late fines the platform can configure, the fields each one has, and how they read to a person. Pure: no
// database, so the platform-admin screen, the organization's read-only view and the tests all share it.
//
// Rates are stored as fractions (0.15 = 15%), the way the penalty engine already expects them; the screens show percentages.

export type PenaltyTypeKey = "vat" | "tds" | "excise_permit";

export type FieldSpec = {
  key: string;
  label: string;
  unit: "percent" | "money";
  /** What the figure is charged on or how often, shown beside the input. */
  per: string;
  optional?: boolean;
};

export type PermitAction = "restricted" | "severe" | "cancelled";
export const PERMIT_ACTIONS: { value: PermitAction; label: string }[] = [
  { value: "restricted", label: "Operations restricted" },
  { value: "severe", label: "Severe non-compliance" },
  { value: "cancelled", label: "Permit cancelled" },
];

export type PermitTier = {
  /** The tier covers delays up to and including this many months after the renewal deadline; null = no upper limit. */
  upToMonths: number | null;
  /** Fine as a share of the standard renewal fee (0.5 = 50%). */
  rate: number;
  action: PermitAction;
};
export type PermitRenewalParams = { tiers: PermitTier[] };

export const PENALTY_TYPES: { key: PenaltyTypeKey; label: string; description: string; fields: FieldSpec[] }[] = [
  {
    key: "vat",
    label: "VAT",
    description: "Late filing and late payment of VAT.",
    fields: [
      { key: "filingDailyRate", label: "Filing fine", unit: "percent", per: "of the tax payable, for each day late" },
      { key: "filingFloor", label: "Minimum filing fine", unit: "money", per: "whatever the daily amount comes to" },
      { key: "latePaymentFlatRate", label: "Late payment fine", unit: "percent", per: "of the tax payable, once, when payment is late" },
      { key: "interestAnnualRate", label: "Interest", unit: "percent", per: "a year on the unpaid tax" },
      { key: "quarterlyFilingFine", label: "Quarterly filer fine", unit: "money", per: "flat, instead of the daily fine, for a late quarterly return", optional: true },
    ],
  },
  {
    key: "tds",
    label: "TDS",
    description: "Late E-TDS filing and late deposit of tax withheld.",
    fields: [
      { key: "filingFlatPerDay", label: "Filing fine", unit: "money", per: "for each day the E-TDS return is late" },
      { key: "filingAnnualRate", label: "Filing fee", unit: "percent", per: "a year of the amount withheld, accruing daily, as well as the fine above" },
      { key: "interestAnnualRate", label: "Interest", unit: "percent", per: "a year on the unpaid tax" },
    ],
  },
  {
    key: "excise_permit",
    label: "Excise permit renewal",
    description: "Late renewal of the excise permit after the Shrawan deadline. The fine is a share of the company's standard renewal fee.",
    fields: [],
  },
];

export const penaltyType = (key: string) => PENALTY_TYPES.find((t) => t.key === key);

const clean = (n: number) => Number(n.toPrecision(10));
/** A stored fraction as the percentage a person types. */
export const toPercent = (fraction: number) => clean(fraction * 100);
/** A typed percentage as the stored fraction. */
export const fromPercent = (percent: number) => clean(percent / 100);

/** The text boxes of the form for a rule's figures. Rates show as percentages. */
export type FormValues = { fields: Record<string, string>; tiers: { upToMonths: string; ratePercent: string; action: PermitAction }[] };

export function toForm(type: PenaltyTypeKey, params: unknown): FormValues {
  const p = (params ?? {}) as Record<string, unknown>;
  const spec = penaltyType(type)!;
  const fields: Record<string, string> = {};
  for (const f of spec.fields) {
    const v = p[f.key];
    fields[f.key] = typeof v === "number" ? String(f.unit === "percent" ? toPercent(v) : v) : "";
  }
  const tiers = type === "excise_permit" && Array.isArray(p.tiers) ? (p.tiers as PermitTier[]).map((t) => ({ upToMonths: t.upToMonths === null ? "" : String(t.upToMonths), ratePercent: String(toPercent(t.rate)), action: t.action })) : [];
  return { fields, tiers };
}

export type ParamsResult = { ok: true; params: Record<string, unknown> } | { ok: false; error: string };

/** The figures from the form, checked. A rate or amount that is not a number, or is out of range, is refused with a message. */
export function fromForm(type: PenaltyTypeKey, form: FormValues): ParamsResult {
  const spec = penaltyType(type);
  if (!spec) return { ok: false, error: "Unknown penalty type." };

  if (type === "excise_permit") {
    if (form.tiers.length === 0) return { ok: false, error: "Add at least one band of late fines." };
    const tiers: PermitTier[] = [];
    let previous = 0;
    for (let i = 0; i < form.tiers.length; i++) {
      const t = form.tiers[i];
      const last = i === form.tiers.length - 1;
      const rate = Number(t.ratePercent);
      if (t.ratePercent.trim() === "" || !Number.isFinite(rate) || rate < 0 || rate > 1000) return { ok: false, error: `Band ${i + 1}: the fine must be a percentage from 0 to 1000.` };
      if (!PERMIT_ACTIONS.some((a) => a.value === t.action)) return { ok: false, error: `Band ${i + 1}: choose what happens in this band.` };
      let upTo: number | null = null;
      if (last) {
        if (t.upToMonths.trim() !== "") return { ok: false, error: "The last band has no upper limit: leave its months blank." };
      } else {
        upTo = Number(t.upToMonths);
        if (t.upToMonths.trim() === "" || !Number.isInteger(upTo) || upTo <= previous) return { ok: false, error: `Band ${i + 1}: the months must be a whole number more than the band before it.` };
        previous = upTo;
      }
      tiers.push({ upToMonths: upTo, rate: fromPercent(rate), action: t.action });
    }
    return { ok: true, params: { tiers } };
  }

  const params: Record<string, unknown> = {};
  for (const f of spec.fields) {
    const text = (form.fields[f.key] ?? "").trim();
    if (text === "") {
      if (f.optional) continue;
      return { ok: false, error: `Enter the ${f.label.toLowerCase()}.` };
    }
    const n = Number(text);
    if (!Number.isFinite(n) || n < 0) return { ok: false, error: `${f.label}: enter a number that is not negative.` };
    if (f.unit === "percent" && n > 1000) return { ok: false, error: `${f.label}: a percentage can't be more than 1000.` };
    params[f.key] = f.unit === "percent" ? fromPercent(n) : n;
  }
  return { ok: true, params };
}

const pct = (fraction: number) => `${toPercent(fraction)}%`;
const money = (n: number) => `Rs ${n.toLocaleString("en-US")}`;

/** The figures as short plain sentences, for the lists. */
export function summarize(type: string, params: unknown): string[] {
  const spec = penaltyType(type);
  if (!spec) return [];
  const p = (params ?? {}) as Record<string, unknown>;
  if (type === "excise_permit") {
    const tiers = Array.isArray(p.tiers) ? (p.tiers as PermitTier[]) : [];
    let from = 0;
    return tiers.map((t) => {
      const span = t.upToMonths === null ? `More than ${from} months late` : from === 0 ? `Up to ${t.upToMonths} months late` : `${from} to ${t.upToMonths} months late`;
      if (t.upToMonths !== null) from = t.upToMonths;
      const action = PERMIT_ACTIONS.find((a) => a.value === t.action)?.label ?? t.action;
      return `${span}: ${pct(t.rate)} of the renewal fee. ${action}.`;
    });
  }
  return spec.fields.flatMap((f) => {
    const v = p[f.key];
    if (typeof v !== "number") return [];
    return [`${f.label}: ${f.unit === "percent" ? pct(v) : money(v)} ${f.per}`];
  });
}

/** Which band a late permit renewal falls in, and what the fine comes to on the company's standard fee. Whole months, rounded up. */
export function permitPenalty(params: PermitRenewalParams, monthsLate: number, standardFee: number): { tier: PermitTier; fine: number } | null {
  if (monthsLate <= 0 || params.tiers.length === 0) return null;
  const tier = params.tiers.find((t) => t.upToMonths === null || monthsLate <= t.upToMonths) ?? params.tiers[params.tiers.length - 1];
  return { tier, fine: Math.round(standardFee * tier.rate * 100) / 100 };
}
