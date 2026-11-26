import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { requireTenantSession, can } from "@/lib/session";
import { peekNextVoucher } from "@/lib/ledger/voucher";
import { isoFromYmd, todayIso, ymdOf } from "@/lib/calendar";
import { PageHeader } from "@/components/ui/page-header";
import { JournalTabs } from "./journal-tabs";

/** The first and last day of the month today falls in, in the organization's calendar. */
function thisMonth(calendar: "AD" | "BS") {
  const today = todayIso();
  const now = ymdOf(calendar, today);
  if (!now) return { from: today, to: today };
  const from = isoFromYmd(calendar, { year: now.year, month: now.month, day: 1 }) ?? today;
  const next = isoFromYmd(calendar, now.month === 12 ? { year: now.year + 1, month: 1, day: 1 } : { year: now.year, month: now.month + 1, day: 1 });
  const to = next ? new Date(new Date(`${next}T00:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10) : today;
  return { from, to };
}

export default async function JournalPage() {
  const session = await requireTenantSession();
  if (!can(session, "chart_of_accounts", "view")) throw new Error("Not permitted");

  const [accountList, nextVoucher] = await Promise.all([
    db
      .select({ id: accounts.id, code: accounts.code, name: accounts.name, isActive: accounts.isActive })
      .from(accounts)
      .where(eq(accounts.tenantId, session.tenantId))
      .orderBy(asc(accounts.code)),
    peekNextVoucher(session.tenantId),
  ]);
  const plain = accountList.map((a) => ({ id: a.id, code: a.code, name: a.name }));

  return (
    <div className="space-y-4">
      <PageHeader title="Journal Entries" className="!mb-0" />
      <JournalTabs
        // The list can be filtered by any account, a retired one too; a new entry only takes active ones.
        allAccounts={plain}
        activeAccounts={plain.filter((_, i) => accountList[i].isActive)}
        nextVoucher={nextVoucher}
        month={thisMonth(session.calendar === "BS" ? "BS" : "AD")}
        canCreate={can(session, "chart_of_accounts", "create")}
        canReverse={can(session, "chart_of_accounts", "void")}
      />
    </div>
  );
}
