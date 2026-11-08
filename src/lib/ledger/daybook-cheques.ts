// Daybook phase 2: the cheques of the day. Cheques are a register, not the ledger (nothing is posted until one clears), so this is read from the cheque
// registers and shown beside the day's figures. Pure, like the other Daybook rules.

export type ChequeKind = "issued" | "received";
/** One cheque from either register. `open` means still waiting: an issued cheque not yet presented, or a received cheque still held. */
export type DayChequeRow = {
  id: string;
  kind: ChequeKind;
  number: string;
  party: string;
  amount: number;
  chequeDate: string;
  status: string;
  open: boolean;
  /** the day the bank paid it */
  clearedDate: string | null;
  /** the day a received cheque went to the bank */
  depositedDate: string | null;
  /** the day it came back, was stopped or was returned (the Nepal date it was closed) */
  closedOn: string | null;
};

export type ChequeGroupKey = "due" | "overdue" | "deposited" | "cleared" | "closed";
export type ChequeGroup = { key: ChequeGroupKey; label: string; rows: DayChequeRow[]; issued: number; received: number };
export type DayCheques = { groups: ChequeGroup[]; any: boolean };

const GROUP_LABEL: Record<ChequeGroupKey, string> = {
  due: "Dated this day",
  overdue: "Past their date and still waiting",
  deposited: "Deposited at the bank",
  cleared: "Paid by the bank",
  closed: "Came back, stopped or returned",
};
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Sorts the cheques of a day into groups. A cheque can be in more than one: one dated this day that cleared the same day is both. Past-date cheques that are still waiting are only meaningful for today, so a past day leaves them out. */
export function buildDayCheques(rows: DayChequeRow[], day: string, today: string): DayCheques {
  const pick = (key: ChequeGroupKey, test: (r: DayChequeRow) => boolean): ChequeGroup => {
    const list = rows.filter(test).sort((a, b) => a.chequeDate.localeCompare(b.chequeDate) || a.number.localeCompare(b.number));
    const sum = (k: ChequeKind) => round2(list.filter((r) => r.kind === k).reduce((s, r) => s + r.amount, 0));
    return { key, label: GROUP_LABEL[key], rows: list, issued: sum("issued"), received: sum("received") };
  };
  const groups = [
    pick("due", (r) => r.chequeDate === day),
    ...(day === today ? [pick("overdue", (r) => r.open && r.chequeDate < day)] : []),
    pick("deposited", (r) => r.kind === "received" && r.depositedDate === day),
    pick("cleared", (r) => r.clearedDate === day),
    pick("closed", (r) => r.closedOn === day),
  ].filter((g) => g.rows.length > 0);
  return { groups, any: groups.length > 0 };
}

/** The status in plain words for one row. */
export function chequeStatusLabel(r: Pick<DayChequeRow, "kind" | "status" | "chequeDate">, today: string): string {
  switch (r.status) {
    case "cleared": return "Paid";
    case "bounced": return "Bounced";
    case "stopped": return "Stopped";
    case "returned": return "Returned to customer";
    case "deposited": return "Deposited";
    default:
      if (r.chequeDate > today) return "Post-dated";
      return r.kind === "issued" ? "Not yet presented" : "Held, ready to deposit";
  }
}

/** One line about the day's cheques for the shareable image, or null when there is nothing to say. */
export function chequeChip(c: DayCheques, formatMoney: (n: number) => string): string | null {
  const g = (k: ChequeGroupKey) => c.groups.find((x) => x.key === k);
  const parts: string[] = [];
  const due = g("due");
  if (due) {
    const money = [due.issued > 0 ? `we give ${formatMoney(due.issued)}` : "", due.received > 0 ? `we get ${formatMoney(due.received)}` : ""].filter(Boolean).join(", ");
    parts.push(`Dated today: ${money}`);
  }
  const n = (k: ChequeGroupKey, words: string) => { const x = g(k); if (x) parts.push(`${x.rows.length} ${words}`); };
  n("overdue", "late");
  n("cleared", "paid by the bank");
  n("closed", "came back");
  return parts.length > 0 ? parts.join(" · ") : null;
}
