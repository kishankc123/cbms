import { guardView } from "@/components/page-guard";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { itemUnits } from "@/db/schema";
import { requireTenantSession } from "@/lib/session";
import { getInventoryValuation } from "@/lib/inventory/valuation";
import { ProductTabs } from "../product-tabs";
import { StockTabs } from "./stock-tabs";
import { StockReport } from "./stock-report";
import { StockMaintenance } from "./maintenance";
import { getInventoryHistory, getOpeningRows } from "@/lib/inventory/opening";
import { getOpeningDate } from "@/lib/inventory/stock";
import { verifyStockBalances } from "@/lib/inventory/recalc";
import { PageHeader } from "@/components/ui/page-header";

export default async function StockPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const denied = await guardView("inventory");
  if (denied) return denied;
  const { tab } = await searchParams;
  const session = await requireTenantSession();
  const [valuation, units, openingDate, openingRows, history, mismatched] = await Promise.all([
    getInventoryValuation(session.tenantId),
    db.select().from(itemUnits).where(eq(itemUnits.tenantId, session.tenantId)),
    getOpeningDate(session.tenantId),
    getOpeningRows(session.tenantId),
    getInventoryHistory(session.tenantId),
    verifyStockBalances(session.tenantId),
  ]);
  const unitName = new Map(units.map((u) => [u.id, u.name]));
  const shown = valuation.items.filter((i) => i.isActive || i.quantity !== 0 || i.value !== 0);

  return (
    <div className="space-y-6">
      <PageHeader title="Product" description="What is on hand, what it cost, and how it ties to the Inventory account." />
      <ProductTabs />

      <StockTabs
        items={valuation.items.map((i) => ({ id: i.id, name: i.name, unitId: i.unitId, quantity: i.quantity, averageCost: i.averageCost }))}
        units={units.map((u) => ({ id: u.id, name: u.name }))}
        openingDate={openingDate}
        openingRows={openingRows}
        history={history}
        initialTab={tab}
        report={
          <div className="space-y-6">
            <StockReport
              rows={shown.map((i) => ({ id: i.id, name: i.name, unit: unitName.get(i.unitId ?? "") ?? "—", isActive: i.isActive, quantity: i.quantity, averageCost: i.averageCost, value: i.value }))}
              stockValue={valuation.stockValue}
              ledger={valuation.ledger}
              difference={valuation.difference}
            />
            <StockMaintenance mismatched={mismatched} />
          </div>
        }
      />
    </div>
  );
}
