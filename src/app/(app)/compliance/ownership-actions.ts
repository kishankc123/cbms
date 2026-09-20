"use server";

import { revalidatePath } from "next/cache";
import { requireTenantSession, can } from "@/lib/session";
import { getCashBankAccounts } from "@/lib/ledger/cash-bank-accounts";
import * as ownership from "@/lib/ownership/service";

async function guard(action: "create" | "edit", alsoPayments = false) {
  const session = await requireTenantSession();
  if (!can(session, "compliance", action)) throw new Error("Not permitted");
  if (alsoPayments && !can(session, "payments", "create")) throw new Error("Not permitted");
  return session;
}

function refresh() {
  for (const p of ["/compliance", "/payments", "/chart-of-accounts", "/journal", "/dashboard"]) revalidatePath(p, "layout");
}

export async function getOwnership() {
  const session = await requireTenantSession();
  const snapshot = await ownership.getOwnershipSnapshot(session.tenantId);
  const groups = await getCashBankAccounts(session.tenantId);
  return {
    ...snapshot,
    canEdit: can(session, "compliance", "edit"),
    canPay: can(session, "compliance", "edit") && can(session, "payments", "create"),
    // A group with sub-accounts (e.g. Bank) is a heading; its children are what money can be received into.
    cashBank: groups.flatMap((g) => (g.children.length > 0 ? g.children : [{ id: g.id, code: g.code, name: g.name }])),
  };
}

export type Meta = { effectiveDate: string; reason?: string; referenceNumber?: string; supportingDocument?: string; notes?: string };

export async function setupCapital(input: Meta & { authorisedCapital: number; issuedShares: number; faceValue: number; currency: string }) {
  const s = await guard("create");
  await ownership.setupCapital(s.tenantId, s.userId, input);
  refresh();
}

export async function increaseAuthorisedCapital(input: Meta & { newAmount: number }) {
  const s = await guard("edit");
  await ownership.increaseAuthorisedCapital(s.tenantId, s.userId, input);
  refresh();
}

export async function changeFaceValue(input: Meta & { newFaceValue: number }) {
  const s = await guard("edit");
  await ownership.changeFaceValue(s.tenantId, s.userId, input);
  refresh();
}

export async function addShareholder(input: Meta & { name: string; holderType: string; shareClass: string; shares: number; dateAcquired: string }) {
  const s = await guard("create");
  await ownership.addShareholder(s.tenantId, s.userId, input);
  refresh();
}

export async function updateShareholder(input: { id: string; name: string; holderType: string; shareClass: string; dateAcquired: string; notes: string }) {
  const s = await guard("edit");
  await ownership.updateShareholder(s.tenantId, s.userId, input);
  refresh();
}

export async function deactivateShareholder(id: string, meta: Meta) {
  const s = await guard("edit");
  await ownership.deactivateShareholder(s.tenantId, s.userId, id, meta);
  refresh();
}

export async function issueShares(input: Meta & { shareholderId: string; shares: number }) {
  const s = await guard("edit");
  await ownership.issueShares(s.tenantId, s.userId, input);
  refresh();
}

export async function cancelShares(input: Meta & { shareholderId: string; shares: number }) {
  const s = await guard("edit");
  await ownership.cancelShares(s.tenantId, s.userId, input);
  refresh();
}

export async function transferShares(input: Meta & { fromId: string; toId: string; shares: number; amount: number }) {
  const s = await guard("edit");
  await ownership.transferShares(s.tenantId, s.userId, input);
  refresh();
}

export async function getTransferSuggestion(fromId: string, shares: number) {
  const s = await guard("edit");
  return ownership.suggestTransferAmount(s.tenantId, fromId, shares);
}

export async function recordPaidUpIncrease(input: ownership.PaidUpInput) {
  const s = await guard("edit", true);
  const result = await ownership.recordPaidUpIncrease(s.tenantId, s.userId, input);
  refresh();
  return result;
}

export async function assignExistingCapital(input: Meta & { shareholderId: string; amount: number }) {
  const s = await guard("edit");
  await ownership.assignExistingCapital(s.tenantId, s.userId, input);
  refresh();
}

export async function recordShareLagatUpdate(input: { lastUpdatedDate: string; referenceNumber: string; supportingDocument: string; notes: string; reason: string }) {
  const s = await guard("edit");
  await ownership.recordShareLagatUpdate(s.tenantId, s.userId, input);
  refresh();
}
