import { formatDate, type CalendarSystem } from "@/lib/calendar";

// Said at the top of a report whose range was cut to start on the books start date (or that ends before the books began).
export function BooksStartNote({ date, calendar, clamped, beforeBooks }: { date: string | null; calendar: CalendarSystem; clamped: boolean; beforeBooks: boolean }) {
  if (!date || (!clamped && !beforeBooks)) return null;
  const when = formatDate(date, calendar, "long");
  return (
    <p className="rounded-md border border-line bg-app px-3 py-2 text-sm text-ink-2 print:hidden">
      {beforeBooks ? `Your books start on ${when}, so there is nothing to show before it.` : `Your books start on ${when}, so this report starts there and the opening balances are its opening line.`}
    </p>
  );
}
