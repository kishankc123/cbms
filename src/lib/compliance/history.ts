import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, capitalChanges, complianceObligations, complianceTaxTypes, shareLagatEntries, shareholders, tenants, users } from "@/db/schema";
import { HISTORY_ENTITY_TYPES, mapAuditEntry, mapCapitalChange, mapLagat, type HistoryContext, type HistoryItem } from "./history-map";

export * from "./history-map";

export async function loadComplianceHistory(tenantId: string, opts: { from?: Date; to?: Date; limit?: number } = {}): Promise<HistoryItem[]> {
  const limit = opts.limit ?? 300;
  const inRange = (col: typeof auditLog.timestamp | typeof capitalChanges.createdAt | typeof shareLagatEntries.createdAt) => [
    ...(opts.from ? [gte(col, opts.from)] : []),
    ...(opts.to ? [lte(col, opts.to)] : []),
  ];

  const audit = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.tenantId, tenantId), inArray(auditLog.entityType, HISTORY_ENTITY_TYPES), ...inRange(auditLog.timestamp)))
    .orderBy(desc(auditLog.timestamp))
    .limit(limit);
  const capital = await db
    .select()
    .from(capitalChanges)
    .where(and(eq(capitalChanges.tenantId, tenantId), ...inRange(capitalChanges.createdAt)))
    .orderBy(desc(capitalChanges.createdAt))
    .limit(limit);
  const lagat = await db
    .select()
    .from(shareLagatEntries)
    .where(and(eq(shareLagatEntries.tenantId, tenantId), ...inRange(shareLagatEntries.createdAt)))
    .orderBy(desc(shareLagatEntries.createdAt))
    .limit(limit);

  const userIds = [...new Set([...audit.map((a) => a.userId), ...capital.map((c) => c.createdBy), ...lagat.map((l) => l.createdBy)].filter((x): x is string => Boolean(x)))];
  const userRows = userIds.length ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, userIds)) : [];
  const userName = (id: string | null) => (id ? userRows.find((u) => u.id === id)?.name ?? "Unknown user" : "System");

  const obligationIds = [...new Set(audit.filter((a) => a.entityType === "compliance_obligation" && a.entityId).map((a) => a.entityId!))];
  const obRows = obligationIds.length
    ? await db.select({ id: complianceObligations.id, name: complianceObligations.name, period: complianceObligations.periodLabel, categoryKey: complianceObligations.categoryKey }).from(complianceObligations).where(and(eq(complianceObligations.tenantId, tenantId), inArray(complianceObligations.id, obligationIds)))
    : [];

  const [tenant] = await db.select({ countryCode: tenants.countryCode }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  const types = await db.select().from(complianceTaxTypes).where(eq(complianceTaxTypes.countryCode, tenant?.countryCode ?? ""));
  const holders = await db.select({ id: shareholders.id, name: shareholders.name }).from(shareholders).where(eq(shareholders.tenantId, tenantId));
  const holderName = (id: string | null) => (id ? holders.find((h) => h.id === id)?.name ?? null : null);

  const ctx: HistoryContext = {
    userName,
    taxTypeName: (key) => types.find((t) => t.key === key)?.name ?? key.toUpperCase(),
    obligation: (id) => obRows.find((o) => o.id === id) ?? null,
  };

  const items: HistoryItem[] = [
    ...audit.map((a) => mapAuditEntry({ id: a.id, userId: a.userId, action: a.action, entityType: a.entityType, entityId: a.entityId, beforeValue: a.beforeValue, afterValue: a.afterValue, timestamp: a.timestamp }, ctx)),
    ...capital.map((c) => mapCapitalChange({ id: c.id, createdBy: c.createdBy, createdAt: c.createdAt, changeType: c.changeType, effectiveDate: c.effectiveDate, shareholder: holderName(c.shareholderId), toShareholder: holderName(c.toShareholderId), shares: c.shares, amount: c.amount, previousValue: c.previousValue, newValue: c.newValue, reason: c.reason }, userName)),
    ...lagat.map((l) => mapLagat(l, userName)),
  ].filter((x): x is HistoryItem => x !== null);

  return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}
