// The VAT payable worksheet: one row per filing period (whatever period the organization's VAT obligations were
// generated at — monthly today), each period's Opening balance carried from the previous period's Closing, so a
// credit (VAT receivable) simply carries forward as an adjusting amount instead of being claimed. Fines &
// penalties for the period are the real, calculated late-filing/payment charge — not a placeholder — using the
// same engine and rule data as the standalone Fines & Penalties calculator, so the two can never disagree.
import { and, asc, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { complianceObligations, tenants } from "@/db/schema";
import { obligationAmounts } from "./tax-amounts";
import { getVatReturn } from "./reports";
import { getPenaltyRule } from "./penalty-rules";
import { calculatePenalty, type VatPenaltyParams } from "./penalty-engine";
import { todayIso, type IsoDate } from "@/lib/calendar";

const round2 = (n: number) => Math.round(n * 100) / 100;

export type VatWorksheetRow = {
  obligationId: string;
  periodLabel: string;
  periodStart: string | null;
  periodEnd: string | null;
  dueDate: string;
  grossSales: number;
  salesVat: number;
  netPurchase: number;
  purchaseVat: number;
  /** Output VAT - input VAT for the period. Negative = a receivable/credit, not claimable, carried forward instead. */
  netPay: number;
  opening: number;
  paid: number;
  closing: number;
  daysDelayed: number;
  finesAndPenalties: number;
  penaltyNote: string | null;
  /** (netPay, only when positive) + fines & penalties. A credit period contributes 0 here — it is only an adjustment. */
  totalPayable: number;
};

export async function getVatWorksheet(tenantId: string): Promise<{ rows: VatWorksheetRow[]; today: IsoDate }> {
  const today = todayIso();
  const [tenant] = await db.select({ countryCode: tenants.countryCode }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenant) throw new Error("Organization not found");

  const obligations = await db
    .select()
    .from(complianceObligations)
    .where(and(eq(complianceObligations.tenantId, tenantId), eq(complianceObligations.categoryKey, "tax"), eq(complianceObligations.taxTypeKey, "vat"), ne(complianceObligations.status, "not_applicable")))
    .orderBy(asc(complianceObligations.periodStart), asc(complianceObligations.dueDate));

  const withPeriods = obligations.filter((o) => o.periodStart && o.periodEnd); // hand-entered items with no period don't belong in the worksheet

  // Every period's own figures are independent of every other period's, so they're fetched in parallel; only the
  // running Opening/Closing balance below has to be sequential, and that part is pure in-memory arithmetic.
  const [amounts, perPeriod] = await Promise.all([
    obligationAmounts(tenantId, obligations),
    Promise.all(
      withPeriods.map(async (o) => {
        const ret = await getVatReturn(tenantId, o.periodStart!, o.periodEnd!);
        const netPay = ret.netVatPayable;
        const actualDate = o.paymentDate ?? o.filingDate ?? (today > o.dueDate ? today : null);
        let daysDelayed = 0;
        let finesAndPenalties = 0;
        let penaltyNote: string | null = null;
        if (actualDate) {
          const rule = await getPenaltyRule(tenant.countryCode, "vat", o.dueDate);
          if (rule) {
            const principal = Math.max(0, netPay);
            const breakdown = calculatePenalty("vat", principal, o.dueDate, actualDate, rule.params as VatPenaltyParams);
            daysDelayed = breakdown.daysDelayed;
            finesAndPenalties = round2(breakdown.filingPenalty + breakdown.paymentPenalty + breakdown.interest);
            const floorLine = breakdown.lines.find((l) => l.label === "Applied filing penalty");
            penaltyNote = floorLine?.note ?? null;
          }
        }
        return { o, ret, netPay, daysDelayed, finesAndPenalties, penaltyNote };
      })
    ),
  ]);

  const rows: VatWorksheetRow[] = [];
  let runningOpening = 0;
  for (const { o, ret, netPay, daysDelayed, finesAndPenalties, penaltyNote } of perPeriod) {
    const paid = amounts.get(o.id)?.paid ?? 0;
    const opening = runningOpening;
    const closing = round2(opening + netPay - paid);

    rows.push({
      obligationId: o.id,
      periodLabel: o.periodLabel,
      periodStart: o.periodStart,
      periodEnd: o.periodEnd,
      dueDate: o.dueDate,
      grossSales: ret.salesTaxable,
      salesVat: ret.outputVat,
      netPurchase: ret.purchasesTaxable,
      purchaseVat: ret.inputVat,
      netPay,
      opening,
      paid,
      closing,
      daysDelayed,
      finesAndPenalties,
      penaltyNote,
      totalPayable: round2(Math.max(0, netPay) + finesAndPenalties),
    });
    runningOpening = closing;
  }

  return { rows, today };
}
