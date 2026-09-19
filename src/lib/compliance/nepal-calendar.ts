// Commonly-cited Nepal filing patterns — VAT returns and TDS deposits are
// both typically monthly, due within 25 days of month-end. These are
// starting defaults only: verify them against current Inland Revenue
// Department rules for your filing category before relying on them: rates,
// deadlines, and filing frequency can change and can vary by taxpayer type.
export function generateNepaliDefaultItems(monthsAhead: number) {
  const items: { name: string; period: string; dueDate: string }[] = [];
  const now = new Date();

  for (let i = 0; i < monthsAhead; i++) {
    const monthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
    const year = monthDate.getUTCFullYear();
    const month = monthDate.getUTCMonth();
    const monthLabel = monthDate.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

    // Last day of this month, then +25 days for the filing/deposit deadline.
    const monthEnd = new Date(Date.UTC(year, month + 1, 0));
    const dueDate = new Date(monthEnd);
    dueDate.setUTCDate(dueDate.getUTCDate() + 25);
    const dueDateStr = dueDate.toISOString().slice(0, 10);

    items.push({ name: "VAT Return", period: monthLabel, dueDate: dueDateStr });
    items.push({ name: "TDS Deposit", period: monthLabel, dueDate: dueDateStr });
  }

  return items;
}
