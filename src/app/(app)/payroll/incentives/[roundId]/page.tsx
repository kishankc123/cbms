import { guardView, guardSalary } from "@/components/page-guard";
import { asc, eq, and } from "drizzle-orm";
import { db } from "@/db";
import { employees } from "@/db/schema";
import { can, requireTenantSession } from "@/lib/session";
import { PageHeader } from "@/components/ui/page-header";
import { monthNames } from "@/lib/calendar";
import { getRound, IncentiveError } from "@/lib/payroll/incentives";
import { FREQUENCY_LABEL } from "@/lib/payroll/incentive-rules";
import { RoundEditor } from "./round-editor";

export default async function IncentiveRoundPage({ params }: { params: Promise<{ roundId: string }> }) {
  const denied = (await guardView("payroll")) ?? (await guardSalary());
  if (denied) return denied;
  const { roundId } = await params;
  const session = await requireTenantSession();

  let data: Awaited<ReturnType<typeof getRound>>;
  try {
    data = await getRound(session.tenantId, roundId);
  } catch (e) {
    if (e instanceof IncentiveError) return <p className="text-sm text-red-600">{e.message}</p>;
    throw e;
  }
  const { round, heading, entries, locked } = data;
  const everyone = await db
    .select({ id: employees.id, fullName: employees.fullName, employeeCode: employees.employeeCode, status: employees.employmentStatus })
    .from(employees)
    .where(and(eq(employees.tenantId, session.tenantId)))
    .orderBy(asc(employees.fullName));
  const inRound = new Set(entries.map((e) => e.employeeId));
  const choices = everyone.filter((e) => e.status === "active" || inRound.has(e.id)).map((e) => ({ id: e.id, name: e.fullName, code: e.employeeCode }));
  const months = monthNames(round.calendarSystem === "BS" ? "BS" : "AD");

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${heading?.name ?? "Incentive"}: ${round.periodLabel}`}
        description={`Paid with the ${months[round.month - 1] ?? round.month} ${round.year} salary${heading ? `. ${FREQUENCY_LABEL[heading.frequency]}; ${heading.taxable ? "taxable" : "not taxable"}${heading.countsForRetirement ? ", counts toward SSF/PF" : ""}.` : "."}`}
        back={{ href: "/payroll/incentives", label: "Performance incentives" }}
        className="!mb-0"
      />
      <RoundEditor
        roundId={round.id}
        status={round.status}
        locked={locked}
        note={round.note ?? ""}
        employees={choices}
        initial={entries.map((e) => ({ employeeId: e.employeeId, amount: String(e.amount), note: e.note ?? "" }))}
        canEdit={can(session, "payroll", "edit")}
        canDelete={can(session, "payroll", "delete")}
      />
    </div>
  );
}
