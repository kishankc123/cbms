
// Pure mapping (no database) from stored records to history items, so it is unit-tested.
//
// Compliance History: one timeline of what changed, from what, to what, by whom
// and when. It is assembled from records that already exist and are never
// rewritten: the audit log (company details, registrations, compliance items,
// charges) and the append-only capital and Share Lagat histories.

export type HistoryCategory = "Company" | "Tax registration" | "Tax compliance" | "Statutory" | "Ownership" | "Capital" | "Share Lagat";

export type HistoryChange = { field: string; previous: string | null; next: string | null };

export type HistoryItem = {
  id: string;
  at: string; // ISO timestamp — a system timestamp, not a business date
  category: HistoryCategory;
  title: string;
  changes: HistoryChange[];
  by: string;
  reason: string | null;
};

export type AuditRow = {
  id: string;
  userId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  beforeValue: unknown;
  afterValue: unknown;
  timestamp: Date;
};

export type HistoryContext = {
  userName: (id: string | null) => string;
  taxTypeName: (key: string) => string;
  /** Looks up a compliance item by id (it may have been deleted since). */
  obligation: (id: string | null) => { name: string; period: string; categoryKey: string } | null;
};

/** Audit entity types this timeline reads. Capital and Share Lagat come from their own tables. */
export const HISTORY_ENTITY_TYPES = ["company_details", "tax_registration", "compliance_obligation", "tax_assessment", "shareholder"];

const FIELD_LABEL: Record<string, string> = {
  companyName: "Legal name",
  tradingName: "Trading name",
  companyRegistrationNumber: "Company registration number",
  registrationDate: "Registration date",
  panVatNumber: "PAN / VAT number",
  registeredOffice: "Registered office",
  address: "Business address",
  industry: "Nature of business",
  baseCurrency: "Base currency",
  countryCode: "Country",
  entityType: "Company type",
  companyStatus: "Company status",
  companyStatusNote: "Status note",
  status: "Status",
  registrationNumber: "Registration number",
  effectiveDate: "Effective date",
  deregistrationDate: "Deregistration date",
  authorityKey: "Tax authority",
  supportingDocument: "Supporting document",
  notes: "Notes",
  dueDate: "Due date",
  filingDate: "Filing date",
  paymentDueDate: "Payment due date",
  filingReference: "Filing reference",
  paymentReference: "Payment reference",
  amountDue: "Amount due (entered)",
  name: "Name",
  holderType: "Type",
  shareClass: "Share class",
  dateAcquired: "Date acquired",
  taxType: "Tax",
  kind: "Type",
  amount: "Amount",
  date: "Date",
  paymentNumber: "Payment",
};

const PRETTY_FIELDS = new Set(["status", "entityType", "companyStatus", "kind", "holderType", "countryCode"]);

function pretty(field: string, value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const s = typeof value === "object" ? JSON.stringify(value) : String(value);
  if (!PRETTY_FIELDS.has(field)) return s;
  const words = s.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const asObject = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Changed fields only: keys whose value differs between before and after. */
export function diffChanges(before: unknown, after: unknown, skip: string[] = []): HistoryChange[] {
  const b = asObject(before);
  const a = asObject(after);
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((k) => !skip.includes(k));
  const out: HistoryChange[] = [];
  for (const k of keys) {
    const prev = pretty(k, b[k]);
    const next = pretty(k, a[k]);
    if (prev === next) continue;
    out.push({ field: FIELD_LABEL[k] ?? k, previous: prev, next });
  }
  return out;
}

export function mapAuditEntry(row: AuditRow, ctx: HistoryContext): HistoryItem | null {
  const before = asObject(row.beforeValue);
  const after = asObject(row.afterValue);
  const base = { id: row.id, at: row.timestamp.toISOString(), by: ctx.userName(row.userId), reason: typeof after.reason === "string" ? after.reason : null };

  switch (row.action) {
    case "company_details_changed":
      return { ...base, category: "Company", title: "Company details updated", changes: diffChanges(before, after) };

    case "tax_registration_added":
      return { ...base, category: "Tax registration", title: `${ctx.taxTypeName(String(after.taxType))} registration added`, changes: [{ field: "Status", previous: null, next: pretty("status", after.status) }, ...diffChanges({}, after, ["taxType", "status", "authorityKey"]).filter((c) => c.next)] };

    case "tax_registration_changed":
      return { ...base, category: "Tax registration", title: `${ctx.taxTypeName(String(after.taxType ?? before.taxType))} registration changed`, changes: diffChanges(before, after, ["taxType"]) };

    case "shareholder_updated":
      return { ...base, category: "Ownership", title: `Shareholder details updated: ${String(before.name ?? after.name ?? "")}`, changes: diffChanges(before, after) };

    case "tax_assessment_recorded":
      return { ...base, category: "Tax compliance", title: `${ctx.taxTypeName(String(after.taxTypeKey))} ${String(after.kind ?? "charge")} recorded`, changes: [{ field: "Amount", previous: null, next: pretty("amount", after.amount) }, { field: "Date", previous: null, next: pretty("date", after.date) }] };

    case "tax_assessment_voided":
      return { ...base, category: "Tax compliance", title: "Tax charge voided", changes: [{ field: "Status", previous: "Posted", next: "Voided" }] };

    case "compliance_item_created": {
      const ob = ctx.obligation(row.entityId);
      return { ...base, category: ob?.categoryKey === "tax" ? "Tax compliance" : "Statutory", title: `Compliance item added: ${String(after.name ?? ob?.name ?? "")}`, changes: [{ field: "Due date", previous: null, next: pretty("date", after.dueDate) }] };
    }

    case "compliance_item_deleted":
      return { ...base, category: "Statutory", title: `Compliance item deleted: ${String(before.name ?? "")}`, changes: [{ field: "Due date", previous: pretty("date", before.dueDate), next: null }] };

    case "compliance_status_changed":
    case "compliance_item_updated":
    case "tax_payment_recorded": {
      const ob = ctx.obligation(row.entityId);
      const label = ob ? `${ob.name} — ${ob.period}` : "Compliance item";
      const category: HistoryCategory = ob?.categoryKey === "tax" ? "Tax compliance" : "Statutory";
      if (row.action === "tax_payment_recorded") return { ...base, category, title: `Payment recorded: ${label}`, changes: [{ field: "Amount paid", previous: null, next: pretty("amount", after.amount) }, { field: "Payment", previous: null, next: pretty("paymentNumber", after.paymentNumber) }] };
      const changes = diffChanges(before, after, ["reason"]);
      return { ...base, category, title: `${row.action === "compliance_status_changed" ? "Status changed" : "Details updated"}: ${label}`, changes };
    }

    default:
      return null;
  }
}

export type CapitalChangeRow = {
  id: string;
  createdBy: string;
  createdAt: Date;
  changeType: string;
  effectiveDate: string;
  shareholder: string | null;
  toShareholder: string | null;
  shares: number | null;
  amount: string | null;
  previousValue: string | null;
  newValue: string | null;
  reason: string | null;
};

const CAPITAL_TITLE: Record<string, string> = {
  initial_setup: "Capital structure set up",
  authorised_capital_increase: "Authorised capital increased",
  shares_issued: "New shares issued",
  paid_up_capital_increase: "Paid-up capital increased",
  share_transfer: "Share transfer",
  share_cancellation: "Shares cancelled",
  face_value_change: "Face value changed",
  capital_assignment: "Capital assigned to a shareholder",
  shareholder_added: "Shareholder added",
  shareholder_deactivated: "Shareholder marked inactive",
  other: "Other capital change",
};

const CAPITAL_FIELD: Record<string, string> = {
  authorised_capital_increase: "Authorised capital",
  shares_issued: "Issued shares",
  share_cancellation: "Issued shares",
  paid_up_capital_increase: "Paid-up capital",
  face_value_change: "Face value per share",
};

export function mapCapitalChange(c: CapitalChangeRow, userName: (id: string | null) => string): HistoryItem {
  const who = c.shareholder ? ` — ${c.shareholder}` : "";
  const changes: HistoryChange[] = [];
  if (c.changeType === "share_transfer") {
    changes.push({ field: "Shares", previous: `${c.shareholder ?? "—"} (holder)`, next: `${c.toShareholder ?? "—"}: ${c.shares?.toLocaleString() ?? ""}` });
    if (c.amount) changes.push({ field: "Capital moved", previous: null, next: c.amount });
  } else if (CAPITAL_FIELD[c.changeType]) {
    changes.push({ field: CAPITAL_FIELD[c.changeType], previous: c.previousValue, next: c.newValue });
  } else if (c.shares !== null) {
    changes.push({ field: "Shares", previous: null, next: c.shares.toLocaleString() });
  }
  if (c.changeType === "capital_assignment" && c.amount) changes.push({ field: "Amount assigned", previous: null, next: c.amount });
  return { id: `cc-${c.id}`, at: c.createdAt.toISOString(), category: "Capital", title: `${CAPITAL_TITLE[c.changeType] ?? c.changeType}${who}`, changes, by: userName(c.createdBy), reason: c.reason };
}

export function mapLagat(e: { id: string; status: string; createdAt: Date; createdBy: string | null; reason: string | null; referenceNumber: string | null }, userName: (id: string | null) => string): HistoryItem {
  const updated = e.status === "updated";
  return {
    id: `sl-${e.id}`,
    at: e.createdAt.toISOString(),
    category: "Share Lagat",
    title: updated ? "Share Lagat updated" : "Share Lagat update needed",
    changes: [{ field: "Share Lagat", previous: updated ? "Update needed" : null, next: updated ? `Updated${e.referenceNumber ? ` (ref ${e.referenceNumber})` : ""}` : "Update needed" }],
    by: e.createdBy ? userName(e.createdBy) : "System",
    reason: e.reason,
  };
}
