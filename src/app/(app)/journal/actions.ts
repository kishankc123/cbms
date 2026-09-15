"use server";

import { revalidatePath } from "next/cache";
import { requireTenantSession } from "@/lib/session";
import { postJournalEntry, reverseJournalEntry } from "@/lib/ledger/post";

export async function createManualJournalEntry(formData: FormData) {
  const session = await requireTenantSession();

  // The <input type="date"> value is already "YYYY-MM-DD" — pass it straight through
  // rather than routing it through a Date object, which would shift it by a day
  // depending on server/browser timezone.
  const entryDate = String(formData.get("entryDate"));
  const memo = String(formData.get("memo") ?? "");
  const referenceNumber = String(formData.get("referenceNumber") ?? "");

  const accountIds = formData.getAll("accountId") as string[];
  const debits = formData.getAll("debitAmount") as string[];
  const credits = formData.getAll("creditAmount") as string[];
  const descriptions = formData.getAll("lineDescription") as string[];

  const lines = accountIds
    .map((accountId, i) => ({
      accountId,
      debitAmount: parseFloat(debits[i] || "0") || 0,
      creditAmount: parseFloat(credits[i] || "0") || 0,
      description: descriptions[i] || undefined,
    }))
    .filter((l) => l.accountId && (l.debitAmount > 0 || l.creditAmount > 0));

  await postJournalEntry({
    tenantId: session.tenantId,
    entryDate,
    sourceType: "manual",
    memo,
    referenceNumber,
    createdBy: session.userId,
    lines,
  });

  revalidatePath("/journal");
  revalidatePath("/dashboard");
}

export async function reverseEntry(formData: FormData) {
  const session = await requireTenantSession();
  const journalEntryId = String(formData.get("journalEntryId"));
  await reverseJournalEntry(session.tenantId, journalEntryId, session.userId);
  revalidatePath("/journal");
  revalidatePath("/dashboard");
}
