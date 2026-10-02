import { requireTenantSession, can } from "@/lib/session";
import { salesByItem } from "@/lib/ledger/sales-by-item";
import { validateADDate } from "@/lib/calendar";
import { getFiscalRange, getActiveFiscalYear, fiscalYearDefaultRange } from "@/lib/fiscal";
import { D } from "@/components/calendar/date-text";
import { ReportFilter } from "@/components/calendar/report-filter";
import { SalesByItemView } from "./sales-by-item-view";
import { BackButton } from "@/components/ui/back-button";

const asIso = (v: string | string[] | undefined) => (typeof v === "string" && validateADDate(v) ? v : null);

export default async function SalesByItemPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireTenantSession();
  if (!can(session, "sales", "view")) throw new Error("Not permitted");
  const sp = await searchParams;
  const [fiscal, activeFiscalYear] = await Promise.all([getFiscalRange(session.tenantId), getActiveFiscalYear(session.tenantId)]);
  const dflt = fiscalYearDefaultRange(activeFiscalYear, session.calendar);
  let from = asIso(sp.from) ?? dflt.from;
  const to = asIso(sp.to) ?? dflt.to;
  if (from > to) from = to;

  const rows = await salesByItem(session.tenantId, new Date(from + "T00:00:00Z"), new Date(to + "T00:00:00Z"));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <BackButton href="/reports" label="Back to Reports" />
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Sales by Item/Service</h1>
      </div>
      <ReportFilter from={from} to={to} fiscal={fiscal} />
      <p className="text-sm text-gray-500">
        <D value={from} /> – <D value={to} />
      </p>
      <SalesByItemView rows={rows} from={from} to={to} />
    </div>
  );
}
