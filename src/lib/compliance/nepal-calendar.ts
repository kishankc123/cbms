import { addMonths, filingDueDate, monthLabel, monthRange, todayIso, type CalendarSystem } from "@/lib/calendar";

// Commonly-cited Nepal filing patterns — VAT returns and TDS deposits are
// both typically monthly, due by the 25th of the following month. These are
// starting defaults only: verify them against current Inland Revenue
// Department rules for your filing category before relying on them: rates,
// deadlines, and filing frequency can change and can vary by taxpayer type.
//
// Months are the organization's calendar months: a BS organization gets
// Ashwin 2083 (real BS month boundaries, due 25 Kartik), an AD one gets
// September 2026. Due dates are stored as real AD dates either way.
export function generateNepaliDefaultItems(monthsAhead: number, calendar: CalendarSystem = "AD", today: string = todayIso()) {
  const items: { name: string; period: string; dueDate: string }[] = [];

  for (let i = 0; i < monthsAhead; i++) {
    const anchor = monthRange(calendar, addMonths(calendar, today, i)).from;
    const period = monthLabel(calendar, anchor);
    const dueDate = filingDueDate(calendar, anchor);

    items.push({ name: "VAT Return", period, dueDate });
    items.push({ name: "TDS Deposit", period, dueDate });
  }

  return items;
}
