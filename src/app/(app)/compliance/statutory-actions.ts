"use server";

import { revalidatePath } from "next/cache";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { complianceAuthorities, complianceObligations, complianceRequirementTemplates, tenants } from "@/db/schema";
import { requireTenantSession, can } from "@/lib/session";
import { todayIso, validateADDate } from "@/lib/calendar";
import { logAuditEvent } from "@/lib/audit";
import { listOrgUsers } from "@/lib/org-users";
import { generateObligations } from "@/lib/compliance/engine/generate";
import { isApplicable } from "@/lib/compliance/engine/applicability";
import { loadFacts } from "@/lib/compliance/engine/facts";
import { effectiveStatus, type ObligationStatus } from "@/lib/compliance/engine/status";

// "Statutory" here is everything that is not tax: company registry filings,
// ownership/share register requirements and other company obligations.
const STATUTORY_CATEGORIES = ["statutory", "ownership", "company"];
const FREQUENCIES = ["monthly", "quarterly", "annual", "one_time", "event_based"] as const;
type Frequency = (typeof FREQUENCIES)[number];

export async function listStatutory() {
  const session = await requireTenantSession();
  const today = todayIso();
  try {
    await generateObligations(session.tenantId);
  } catch (e) {
    console.error("compliance generation failed", e);
  }

  const rows = await db
    .select()
    .from(complianceObligations)
    .where(and(eq(complianceObligations.tenantId, session.tenantId), inArray(complianceObligations.categoryKey, STATUTORY_CATEGORIES)))
    .orderBy(asc(complianceObligations.dueDate));
  const users = await listOrgUsers(session.tenantId);
  const userName = new Map(users.map((u) => [u.id, u.name]));

  // What the requirement engine says applies to this company, whether or not it is scheduled yet.
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1);
  const [templates, authorities] = await Promise.all([
    db.select().from(complianceRequirementTemplates).where(eq(complianceRequirementTemplates.countryCode, tenant.countryCode)),
    db.select().from(complianceAuthorities).where(eq(complianceAuthorities.countryCode, tenant.countryCode)),
  ]);
  const facts = await loadFacts(tenant);
  const authorityName = new Map(authorities.map((a) => [a.key, a.name]));
  const requirements = templates
    .filter((t) => STATUTORY_CATEGORIES.includes(t.categoryKey))
    .filter((t) => !t.entityTypeKey || t.entityTypeKey === tenant.entityType)
    .filter((t) => isApplicable(t.applicability, facts))
    .map((t) => ({
      key: t.key,
      name: t.name,
      description: t.description ?? "",
      frequency: t.frequency as Frequency,
      authority: t.authorityKey ? authorityName.get(t.authorityKey) ?? "" : "",
      // Scheduled = active with a confirmed due-date rule. Otherwise it is known but not yet given a deadline.
      scheduled: t.isActive && Boolean(t.dueRule),
    }));

  return {
    today,
    canEdit: can(session, "compliance", "edit"),
    canCreate: can(session, "compliance", "create"),
    users,
    entityTypeSet: Boolean(tenant.entityType),
    requirements,
    items: rows.map((r) => ({
      id: r.id,
      name: r.name,
      categoryKey: r.categoryKey,
      frequency: (r.frequency ?? "one_time") as Frequency,
      period: r.periodLabel,
      dueDate: r.dueDate,
      status: r.status as ObligationStatus,
      effective: effectiveStatus(r, today),
      completedDate: r.filingDate ?? "",
      referenceNumber: r.filingReference ?? "",
      supportingDocument: r.supportingDocument ?? "",
      notes: r.notes ?? "",
      notApplicableReason: r.notApplicableReason ?? "",
      responsibleUserId: r.responsibleUserId ?? "",
      responsible: r.responsibleUserId ? userName.get(r.responsibleUserId) ?? "—" : "—",
      source: r.source,
    })),
  };
}

export type StatutoryInput = {
  name: string;
  categoryKey: string;
  frequency: Frequency;
  period: string;
  dueDate: string;
  responsibleUserId: string;
  notes: string;
};

/** Adds a requirement by hand (one the configured templates don't cover). */
export async function createStatutoryItem(input: StatutoryInput) {
  const session = await requireTenantSession();
  if (!can(session, "compliance", "create")) throw new Error("Not permitted");
  if (!input.name.trim()) throw new Error("Requirement name is required");
  if (!validateADDate(input.dueDate)) throw new Error("Enter the due date");
  if (!STATUTORY_CATEGORIES.includes(input.categoryKey)) throw new Error("Choose a category");
  if (!FREQUENCIES.includes(input.frequency)) throw new Error("Choose a frequency");

  const [created] = await db
    .insert(complianceObligations)
    .values({
      tenantId: session.tenantId,
      source: "manual",
      name: input.name.trim(),
      categoryKey: input.categoryKey,
      frequency: input.frequency,
      periodLabel: input.period.trim() || "—",
      dueDate: input.dueDate,
      responsibleUserId: input.responsibleUserId || null,
      notes: input.notes.trim() || null,
    })
    .returning({ id: complianceObligations.id });
  await logAuditEvent({ tenantId: session.tenantId, userId: session.userId, action: "compliance_item_created", entityType: "compliance_obligation", entityId: created.id, after: { name: input.name.trim(), dueDate: input.dueDate } });
  revalidatePath("/compliance", "layout");
}

export type StatutoryPatch = { completedDate: string; referenceNumber: string; supportingDocument: string; notes: string; responsibleUserId: string; dueDate?: string };

export async function updateStatutoryItem(id: string, patch: StatutoryPatch) {
  const session = await requireTenantSession();
  if (!can(session, "compliance", "edit")) throw new Error("Not permitted");
  if (patch.completedDate && !validateADDate(patch.completedDate)) throw new Error("Enter a valid completed date");

  const [before] = await db
    .select()
    .from(complianceObligations)
    .where(and(eq(complianceObligations.id, id), eq(complianceObligations.tenantId, session.tenantId), inArray(complianceObligations.categoryKey, STATUTORY_CATEGORIES)))
    .limit(1);
  if (!before) throw new Error("Compliance item not found");

  // A generated item's deadline comes from its requirement, so only hand-entered items can be re-dated.
  let dueDate = before.dueDate;
  if (patch.dueDate && patch.dueDate !== before.dueDate) {
    if (before.source === "generated") throw new Error("This deadline comes from the requirement and can't be changed here");
    if (!validateADDate(patch.dueDate)) throw new Error("Enter a valid due date");
    dueDate = patch.dueDate;
  }

  const next = {
    filingDate: patch.completedDate || null,
    filingReference: patch.referenceNumber.trim() || null,
    supportingDocument: patch.supportingDocument.trim() || null,
    notes: patch.notes.trim() || null,
    responsibleUserId: patch.responsibleUserId || null,
    dueDate,
    updatedAt: new Date(),
  };
  await db.update(complianceObligations).set(next).where(eq(complianceObligations.id, before.id));
  await logAuditEvent({
    tenantId: session.tenantId,
    userId: session.userId,
    action: "compliance_item_updated",
    entityType: "compliance_obligation",
    entityId: before.id,
    before: { filingDate: before.filingDate, filingReference: before.filingReference, dueDate: before.dueDate },
    after: { filingDate: next.filingDate, filingReference: next.filingReference, dueDate: next.dueDate },
  });
  revalidatePath("/compliance", "layout");
}
