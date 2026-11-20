import type { useConfirm } from "@/components/ui/confirm-dialog";
import { getVatFilingNotice } from "./actions";

/**
 * What to ask before a VAT return's status changes. Marking it filed locks its period (sales, purchases and expenses with VAT can no longer be added, changed
 * or voided there), so the person confirms first and is told about bills still waiting for their items. Taking a filing back needs a reason.
 * Anything that is not a VAT return goes straight through.
 */
export async function vatStatusFlow(ask: ReturnType<typeof useConfirm>, itemId: string, status: string): Promise<{ proceed: boolean; reason?: string }> {
  const notice = await getVatFilingNotice(itemId);
  if (!notice) return { proceed: true };

  if ((status === "filed" || status === "paid") && !notice.filed) {
    const waiting = notice.pendingBills > 0 ? ` ${notice.pendingBills} purchase ${notice.pendingBills === 1 ? "bill" : "bills"} in it (${notice.pendingAmount.toFixed(2)}) still ${notice.pendingBills === 1 ? "waits" : "wait"} for item details: their VAT becomes final too, and the items will have to match the amounts already recorded.` : "";
    const yes = await ask(`Once the VAT return for ${notice.label} is marked filed, its sales, purchases and VAT are locked: nothing in that period can be added, changed or voided.${waiting}`, { confirmLabel: "Mark as filed" });
    return { proceed: yes };
  }

  if (notice.filed && (status === "pending" || status === "in_progress")) {
    const reason = window.prompt(`The VAT return for ${notice.label} is filed and its figures are locked. Why is the filing being reopened?`)?.trim();
    return reason ? { proceed: true, reason } : { proceed: false };
  }
  return { proceed: true };
}
