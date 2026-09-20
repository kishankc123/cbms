import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import type { EffectiveStatus } from "@/lib/compliance/engine/status";

const LABEL: Record<EffectiveStatus, string> = {
  pending: "Pending",
  in_progress: "In progress",
  filed: "Filed",
  paid: "Paid",
  partially_paid: "Partially paid",
  overdue: "Overdue",
  not_applicable: "Not applicable",
};

const TONE: Record<Exclude<EffectiveStatus, "not_applicable">, StatusTone> = {
  pending: "pending",
  in_progress: "pending",
  filed: "success",
  paid: "success",
  partially_paid: "action",
  overdue: "critical",
};

export const statusLabel = (s: EffectiveStatus) => LABEL[s];

/** One subtle, consistent status indicator for every compliance record. */
export function ObligationStatusPill({ status, completedLabel }: { status: EffectiveStatus; completedLabel?: string }) {
  if (status === "not_applicable") {
    return <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-xs font-medium text-gray-500 whitespace-nowrap">{LABEL[status]}</span>;
  }
  return <StatusPill tone={TONE[status]}>{status === "filed" && completedLabel ? completedLabel : LABEL[status]}</StatusPill>;
}
