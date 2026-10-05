import type { StatusTone } from "@/components/ui/status-pill";

export const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  active: "Active",
  fully_depreciated: "Fully depreciated",
  disposed: "Disposed",
  sold: "Sold",
  written_off: "Written off",
};

export const STATUS_TONE: Record<string, StatusTone> = {
  draft: "pending",
  active: "success",
  fully_depreciated: "pending",
  disposed: "action",
  sold: "action",
  written_off: "critical",
};

export const METHOD_LABEL: Record<string, string> = { straight_line: "Straight line", declining_balance: "Declining balance", none: "No depreciation" };

export const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
