import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { complianceCatchup, complianceCountries, complianceObligations, complianceRequirementTemplates, exciseRenewals, tenants } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit";
import { bsFiscalYearOf, bsFiscalYearRange, todayIso, type IsoDate } from "@/lib/calendar";
import { isApplicable } from "./engine/applicability";
import { loadFacts } from "./engine/facts";
import { templateInScope } from "./engine/scope";
import { answerValid, filedBefore, latestFinishedYearEnd, periodOptions, prefillFrom, STREAM_LABEL, STREAM_ORDER, TEMPLATE_STREAM, type PeriodOption, type StreamKey, type StreamKind } from "./catchup-rules";
import { loadComplianceProfile } from "./profile";

// What was already filed when the organization started using the system. Plain server helpers, not server actions: the actions
// in compliance/catchup-actions check the permission first.

export const CATCHUP_NOTE = "Recorded from the compliance checklist: the payment date and fee were not entered.";

export type StreamView = {
  key: StreamKey;
  label: string;
  kind: StreamKind;
  /** Where the stream starts (company registration, VAT effective-from, permit date). */
  from: IsoDate;
  options: PeriodOption[];
  answered: boolean;
  /** The saved answer: the end of the last period filed, null = none filed yet. */
  filedThrough: IsoDate | null;
  /** What to start from when nothing is saved: pre-selected from the income tax answer, to be confirmed. */
  suggested: IsoDate | null;
};

export type CatchupView = {
  /** False while the company profile is incomplete: the checklist waits for it. */
  ready: boolean;
  streams: StreamView[];
  unanswered: number;
  latestFinishedYearEnd: IsoDate | null;
  firstFiscalYear: string | null;
};

type Result = { ok: true } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

export async function savedAnswers(tenantId: string): Promise<Map<StreamKey, IsoDate | null>> {
  const rows = await db.select().from(complianceCatchup).where(eq(complianceCatchup.tenantId, tenantId));
  return new Map(rows.map((r) => [r.stream as StreamKey, r.filedThrough]));
}

/** Which streams this organization has, where each starts, and what has been answered so far. */
export async function loadCatchup(tenantId: string, today: IsoDate = todayIso()): Promise<CatchupView> {
  const profile = await loadComplianceProfile(tenantId);
  const empty: CatchupView = { ready: false, streams: [], unanswered: 0, latestFinishedYearEnd: latestFinishedYearEnd(today), firstFiscalYear: profile.firstFiscalYear };
  if (!profile.complete) return empty;

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenant) return empty;
  const [country] = await db.select().from(complianceCountries).where(and(eq(complianceCountries.code, tenant.countryCode), eq(complianceCountries.isActive, true))).limit(1);
  if (!country) return empty;
  const facts = await loadFacts(tenant);
  const templates = (await db.select().from(complianceRequirementTemplates).where(eq(complianceRequirementTemplates.countryCode, country.code))).filter((t) => templateInScope(t, tenant.entityType, today) && isApplicable(t.applicability, facts));
  const active = new Set(templates.map((t) => TEMPLATE_STREAM[t.key]).filter(Boolean));
  const saved = await savedAnswers(tenantId);
  const s = profile.starts;
  const latest = latestFinishedYearEnd(today);

  const defs: { key: StreamKey; kind: StreamKind; from: IsoDate | null }[] = [
    { key: "income_tax", kind: "year", from: s.company },
    { key: "vat", kind: facts.vat_filing_frequency === "quarterly" ? "term" : "month", from: s.vat },
    { key: "tds", kind: "month", from: s.tds ?? s.company },
    { key: "excise_return", kind: "month", from: s.excise },
    { key: "excise_permit", kind: "permit", from: s.excise },
  ];
  const streams: StreamView[] = [];
  for (const d of defs) {
    if (!d.from) continue;
    if (d.key !== "excise_permit" && !active.has(d.key)) continue;
    if (d.key === "excise_permit" && !s.excise) continue;
    const options = periodOptions(d.kind, d.from, today);
    const incomeTax = saved.has("income_tax") ? saved.get("income_tax") ?? null : null;
    streams.push({ key: d.key, label: STREAM_LABEL[d.key], kind: d.kind, from: d.from, options, answered: saved.has(d.key), filedThrough: saved.get(d.key) ?? null, suggested: d.key === "income_tax" ? null : prefillFrom(incomeTax, latest, options) });
  }
  streams.sort((a, b) => STREAM_ORDER.indexOf(a.key) - STREAM_ORDER.indexOf(b.key));
  return { ready: true, streams, unanswered: streams.filter((x) => !x.answered).length, latestFinishedYearEnd: latest, firstFiscalYear: profile.firstFiscalYear };
}

/** Marks every period up to each stream's answer as filed before the system, and every later one as owed again. Idempotent. */
export async function applyCatchup(tenantId: string): Promise<void> {
  const saved = await savedAnswers(tenantId);
  if (saved.size === 0) return;
  const templates = await db.select({ id: complianceRequirementTemplates.id, key: complianceRequirementTemplates.key }).from(complianceRequirementTemplates);
  const streamOfTemplate = new Map(templates.map((t) => [t.id, TEMPLATE_STREAM[t.key]]));
  const rows = await db
    .select({ id: complianceObligations.id, templateId: complianceObligations.templateId, periodEnd: complianceObligations.periodEnd, status: complianceObligations.status, flagged: complianceObligations.filedBeforeSystem })
    .from(complianceObligations)
    .where(eq(complianceObligations.tenantId, tenantId));

  const toFile: string[] = [];
  const toReopen: string[] = [];
  for (const r of rows) {
    const stream = r.templateId ? streamOfTemplate.get(r.templateId) : undefined;
    if (!stream || !saved.has(stream)) continue;
    const filed = filedBefore(r.periodEnd, saved.get(stream) ?? null);
    if (filed && !r.flagged && (r.status === "pending" || r.status === "in_progress")) toFile.push(r.id);
    else if (!filed && r.flagged) toReopen.push(r.id);
  }
  if (toFile.length) await db.update(complianceObligations).set({ status: "filed", filedBeforeSystem: true, updatedAt: new Date() }).where(inArray(complianceObligations.id, toFile));
  if (toReopen.length) await db.update(complianceObligations).set({ status: "pending", filedBeforeSystem: false, filingDate: null, updatedAt: new Date() }).where(inArray(complianceObligations.id, toReopen));
}

/** Records the excise permit as renewed through a fiscal year: renewals the checklist added are kept in step with the answer. */
async function syncPermitRenewals(tenantId: string, permitFrom: IsoDate, throughYear: number): Promise<void> {
  const permitYear = bsFiscalYearOf(permitFrom)?.startYear;
  if (permitYear === undefined) return;
  const existing = await db.select().from(exciseRenewals).where(eq(exciseRenewals.tenantId, tenantId));
  const have = new Map(existing.map((r) => [bsFiscalYearOf(r.fiscalYearStart)?.startYear, r]));

  for (let y = permitYear + 1; y <= throughYear; y++) {
    if (have.has(y)) continue;
    const range = bsFiscalYearRange(y);
    if (range) await db.insert(exciseRenewals).values({ tenantId, fiscalYearStart: range.from, paidDate: range.from, feeAmount: "0", penaltyAmount: "0", notes: CATCHUP_NOTE });
  }
  // Renewals this checklist created, beyond the new answer, are taken back; ones a person recorded are never touched.
  for (const [y, r] of have) {
    if (y !== undefined && y > throughYear && r.notes === CATCHUP_NOTE) await db.delete(exciseRenewals).where(eq(exciseRenewals.id, r.id));
  }
  // The renewal items follow: renewed through the answer = paid before the system.
  const obligations = await db
    .select()
    .from(complianceObligations)
    .where(and(eq(complianceObligations.tenantId, tenantId), eq(complianceObligations.taxTypeKey, "excise"), eq(complianceObligations.name, "Excise Permit Renewal"), isNull(complianceObligations.templateId)));
  for (const o of obligations) {
    const y = o.periodStart ? bsFiscalYearOf(o.periodStart)?.startYear : undefined;
    if (y === undefined) continue;
    if (y <= throughYear && !o.filedBeforeSystem && o.status === "pending") await db.update(complianceObligations).set({ status: "paid", filedBeforeSystem: true, updatedAt: new Date() }).where(eq(complianceObligations.id, o.id));
    else if (y > throughYear && o.filedBeforeSystem) await db.update(complianceObligations).set({ status: "pending", filedBeforeSystem: false, updatedAt: new Date() }).where(eq(complianceObligations.id, o.id));
  }
}

/**
 * Saves the answers (end of the last period filed, or null for none), then builds each stream's full history and marks what was
 * filed. Only streams the organization has can be answered, and only with one of the periods offered.
 */
export async function saveCatchup(tenantId: string, userId: string, answers: Partial<Record<StreamKey, IsoDate | null>>, today: IsoDate = todayIso()): Promise<Result> {
  const view = await loadCatchup(tenantId, today);
  if (!view.ready) return fail("Fill in the company details first: the checklist starts once they are complete.");
  const before = await savedAnswers(tenantId);

  for (const [key, value] of Object.entries(answers) as [StreamKey, IsoDate | null][]) {
    const stream = view.streams.find((s) => s.key === key);
    if (!stream) return fail(`${STREAM_LABEL[key] ?? key} does not apply to this organization.`);
    if (key === "excise_permit" && value === null) return fail("Choose the last fiscal year the permit was paid for (the year it was issued in counts as paid).");
    if (!answerValid(stream.options, value)) return fail(`${stream.label}: choose one of the periods offered.`);
  }

  for (const [key, value] of Object.entries(answers) as [StreamKey, IsoDate | null][]) {
    await db
      .insert(complianceCatchup)
      .values({ tenantId, stream: key, filedThrough: value, answeredBy: userId })
      .onConflictDoUpdate({ target: [complianceCatchup.tenantId, complianceCatchup.stream], set: { filedThrough: value, answeredBy: userId, answeredAt: new Date() } });
    if (key === "excise_permit" && value) {
      const through = bsFiscalYearOf(value)?.startYear;
      const from = view.streams.find((s) => s.key === key)!.from;
      if (through !== undefined) await syncPermitRenewals(tenantId, from, through);
    }
  }
  await logAuditEvent({ tenantId, userId, action: "compliance_catchup_saved", entityType: "compliance_catchup", before: Object.fromEntries(before), after: answers });

  // Imported lazily: generate.ts reads the saved answers too, and this keeps the two files from importing each other at load.
  const { generateObligations } = await import("./engine/generate");
  await generateObligations(tenantId, { today });
  await applyCatchup(tenantId);
  return { ok: true };
}
