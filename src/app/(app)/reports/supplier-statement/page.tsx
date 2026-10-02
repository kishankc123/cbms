import { eq, asc } from "drizzle-orm";
import { db } from "@/db";
import { vendors } from "@/db/schema";
import { requireTenantSession, can } from "@/lib/session";
import { getSupplierLines } from "@/lib/ledger/supplier-balances";
import { buildStatement } from "@/lib/ledger/party-ledger";
import { validateADDate } from "@/lib/calendar";
import { getFiscalRange, getActiveFiscalYear, fiscalYearDefaultRange } from "@/lib/fiscal";
import { SupplierStatementView } from "./supplier-statement-view";
import { BackButton } from "@/components/ui/back-button";

const asIso = (v: string | string[] | undefined) => (typeof v === "string" && validateADDate(v) ? v : null);

export default async function SupplierStatementPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireTenantSession();
  if (!can(session, "purchases", "view")) throw new Error("Not permitted");
  const sp = await searchParams;
  const [fiscal, activeFiscalYear] = await Promise.all([getFiscalRange(session.tenantId), getActiveFiscalYear(session.tenantId)]);
  const dflt = fiscalYearDefaultRange(activeFiscalYear, session.calendar);
  let from = asIso(sp.from) ?? dflt.from;
  const to = asIso(sp.to) ?? dflt.to;
  if (from > to) from = to;

  const list = await db
    .select({ id: vendors.id, name: vendors.name })
    .from(vendors)
    .where(eq(vendors.tenantId, session.tenantId))
    .orderBy(asc(vendors.name));

  const vendorId = typeof sp.vendor === "string" && list.some((v) => v.id === sp.vendor) ? sp.vendor : null;

  let statement = null;
  if (vendorId) {
    const linesByVendor = await getSupplierLines(session.tenantId);
    const lines = linesByVendor.get(vendorId) ?? [];
    const built = buildStatement(lines, "credit", { from, to });
    const name = list.find((v) => v.id === vendorId)?.name ?? "";
    statement = { vendorName: name, openingBalance: built.openingBalance, closingBalance: built.closingBalance, rows: built.rows };
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <BackButton href="/reports" label="Back to Reports" />
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Supplier Statement</h1>
      </div>
      <SupplierStatementView vendors={list} vendorId={vendorId} from={from} to={to} fiscal={fiscal} statement={statement} />
    </div>
  );
}
