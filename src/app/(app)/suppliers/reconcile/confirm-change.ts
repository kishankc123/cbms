import type { useConfirm } from "@/components/ui/confirm-dialog";
import { getReconciledWarningAction } from "./status-actions";

/**
 * Before a bill, expense or payment is changed: when it sits inside a period already reconciled with the supplier, says so and asks. True means go ahead.
 * Only a warning, so a failure to look is never a reason to stop the person.
 */
export async function okToChange(ask: ReturnType<typeof useConfirm>, kind: "bill" | "expense" | "payment", id: string): Promise<boolean> {
  try {
    const warning = await getReconciledWarningAction({ kind, id });
    if (!warning) return true;
    return await ask(`${warning}\n\nChange it anyway?`, { title: "Already reconciled with the supplier", confirmLabel: "Change it" });
  } catch {
    return true;
  }
}
