import type { CalendarSystem, IsoDate } from "@/lib/calendar";
import { depreciationSchedule, type DepreciationMethod } from "./depreciation";

// What one asset is depreciated by in a monthly run, with no database. The run covers every month of the asset's schedule
// that has ended by the run's month and hasn't been posted yet, so an asset bought (or fixed) after an earlier run simply
// catches up in the next one.

const round2 = (n: number) => Math.round(n * 100) / 100;

export type RunAsset = {
  cost: number;
  residual: number;
  openingAccumulated: number;
  accumulated: number;
  method: DepreciationMethod;
  /** Months still to depreciate, counted from startDate. */
  months: number | null;
  startDate: IsoDate | null;
  /** End of the last month already posted for this asset. */
  lastDepreciationDate: IsoDate | null;
};

export type RunAmount = { amount: number; months: number; accumulatedAfter: number };

export function assetRunAmount(a: RunAsset, runEnd: IsoDate, calendar: CalendarSystem): RunAmount | null {
  if (a.method === "none" || !a.startDate || !a.months) return null;
  const due = depreciationSchedule({ cost: a.cost, residual: a.residual, accumulatedBefore: a.openingAccumulated, method: a.method, months: a.months, startDate: a.startDate, calendar }).filter(
    (p) => p.periodEnd <= runEnd && (!a.lastDepreciationDate || p.periodEnd > a.lastDepreciationDate)
  );
  const amount = round2(due.reduce((s, p) => s + p.depreciation, 0));
  if (amount <= 0) return null;
  return { amount, months: due.length, accumulatedAfter: round2(a.accumulated + amount) };
}

/** True once nothing is left to depreciate but the residual value. */
export const isFullyDepreciated = (cost: number, residual: number, accumulated: number) => round2(cost - residual - accumulated) <= 0;
