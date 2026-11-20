"use server";

import { revalidatePath } from "next/cache";
import { can, requireTenantSession } from "@/lib/session";
import { getCashBankAccounts } from "@/lib/ledger/cash-bank-accounts";
import { assertTrackingOn } from "@/lib/inventory/stock";
import { buildItemTemplate, importItemBills, reviewItemFile, type ItemChunkResult, type ItemImportReview, type ItemImportSettings } from "@/lib/purchases/import/item-service";

// Importing stockable purchases with their items: every step needs permission to create purchases. The work is in lib/purchases/import/item-service.ts.

async function guard() {
  const session = await requireTenantSession();
  if (!can(session, "purchases", "create")) throw new Error("Not permitted");
  await assertTrackingOn(session.tenantId, "Purchases with items");
  return session;
}

export async function getItemImportSetup() {
  const session = await guard();
  const groups = await getCashBankAccounts(session.tenantId);
  return { accounts: groups.flatMap((g) => (g.children.length > 0 ? g.children : [{ id: g.id, code: g.code, name: g.name }])).map((a) => ({ id: a.id, name: a.name })) };
}

export async function downloadItemTemplateAction(): Promise<{ fileName: string; base64: string }> {
  const session = await guard();
  return { fileName: "purchase-with-items-template.xlsx", base64: await buildItemTemplate(session.tenantId) };
}

export async function previewItemImportAction(input: { fileName: string; base64: string; settings: ItemImportSettings }): Promise<ItemImportReview> {
  const session = await guard();
  return reviewItemFile(session.tenantId, input.base64, input.fileName, input.settings);
}

/** Posts one group of the ready bills; the screen calls this again for the next group so a long file never has to fit in one request. */
export async function importItemBillsAction(input: { fileName: string; base64: string; settings: ItemImportSettings; keys: string[] }): Promise<ItemChunkResult> {
  const session = await guard();
  const r = await importItemBills({ tenantId: session.tenantId, userId: session.userId }, input.base64, input.fileName, input.settings, input.keys);
  revalidatePath("/purchases/stockable");
  revalidatePath("/suppliers");
  revalidatePath("/dashboard");
  revalidatePath("/journal");
  revalidatePath("/inventory/items");
  return r;
}
