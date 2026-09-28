import Link from "next/link";
import { eq, asc } from "drizzle-orm";
import { db } from "@/db";
import { vendors } from "@/db/schema";
import { requireTenantSession } from "@/lib/session";
import { getSupplierLines } from "@/lib/ledger/supplier-balances";
import { buildStatement } from "@/lib/ledger/party-ledger";
import { presetRange, todayIso, validateADDate } from "@/lib/calendar";
import { getFiscalRange } from "@/lib/fiscal";
import { SupplierStatementView } from "./supplier-statement-view";

const asIso = (v: string | string[] | undefined) => (typeof v === "string" && validateADDate(v) ? v : null);

export default async function SupplierStatementPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireTenantSession();
  const sp = await searchParams;
  const fiscal = await getFiscalRange(session.tenantId);
  const dflt = presetRange("this_fiscal_year", session.calendar, todayIso(), fiscal);
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
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Supplier Statement</h1>
        <Link href="/reports" className="text-sm text-[var(--color-primary)] hover:underline">
          ← Reports
        </Link>
      </div>
      <SupplierStatementView vendors={list} vendorId={vendorId} from={from} to={to} fiscal={fiscal} statement={statement} />
    </div>
  );
}
