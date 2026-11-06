import { redirect } from "next/navigation";
import { requireTenantSession } from "@/lib/session";
import { getTrackInventory } from "@/lib/inventory/stock";

// An organization that does not keep stock has one Purchases page (bills by amount); the others start at Consumable purchase.
export default async function PurchasesPage() {
  const session = await requireTenantSession();
  redirect((await getTrackInventory(session.tenantId)) ? "/purchases/consumable" : "/purchases/stockable");
}
