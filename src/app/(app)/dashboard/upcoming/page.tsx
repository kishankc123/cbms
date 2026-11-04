import Link from "next/link";
import { guardView } from "@/components/page-guard";
import { requireTenantSession, requireUserSession } from "@/lib/session";
import { validateADDate, todayIso } from "@/lib/calendar";
import { getFiscalRange, getActiveFiscalYear, fiscalYearDefaultRange } from "@/lib/fiscal";
import { StatStrip } from "@/components/ui/stat-strip";
import { StatusPill } from "@/components/ui/status-pill";
import { BUCKETS, isBucket, totalOf, upcomingParties, upcomingSummary, type DueBucket } from "@/lib/dashboard/upcoming";
import { DashboardHeader } from "../dashboard-header";
import { money } from "../cash-sections";
import { PartyRows } from "./party-rows";
import { pendingCheques } from "@/lib/cheques/pending";
import { viewOf } from "@/lib/cheques/cheque-rules";
import { D } from "@/components/calendar/date-text";

const asIso = (v: string | string[] | undefined) => (typeof v === "string" && validateADDate(v) ? v : null);

export default async function UpcomingTab({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const denied = await guardView("chart_of_accounts");
  if (denied) return denied;
  const session = await requireTenantSession();
  const user = await requireUserSession();
  const sp = await searchParams;

  const fiscal = await getFiscalRange(session.tenantId);
  const activeFiscalYear = await getActiveFiscalYear(session.tenantId);
  const dflt = fiscalYearDefaultRange(activeFiscalYear, session.calendar);
  let from = asIso(sp.from) ?? dflt.from;
  const to = asIso(sp.to) ?? dflt.to;
  if (from > to) from = to;
  const today = todayIso();
  const show = isBucket(sp.show) ? sp.show : null;

  const [summary, coming, going, cheques] = await Promise.all([upcomingSummary(session.tenantId, today), upcomingParties(session.tenantId, today, "coming", show), upcomingParties(session.tenantId, today, "going", show), pendingCheques(session.tenantId)]);
  const chequeTotal = Math.round(cheques.reduce((s, c) => s + c.amount, 0) * 100) / 100;
  const inAll = totalOf(summary.coming);
  const outAll = totalOf(summary.going);
  const hrefFor = (b: DueBucket | null) => `/dashboard/upcoming?${new URLSearchParams({ from, to, ...(b ? { show: b } : {}) }).toString()}`;
  const chips: { key: DueBucket | null; label: string; inAmt: number; outAmt: number }[] = [
    { key: null, label: "All", inAmt: inAll.amount, outAmt: outAll.amount },
    ...BUCKETS.map((b) => ({ key: b.key as DueBucket, label: b.label, inAmt: summary.coming[b.key].amount, outAmt: summary.going[b.key].amount })),
  ];
  const shown = (side: "coming" | "going") => (show ? totalOf(summary[side], [show]) : totalOf(summary[side]));

  return (
    <div className="space-y-5">
      <DashboardHeader name={user.name ?? ""} activeFiscalYear={activeFiscalYear} from={from} to={to} fiscal={fiscal} />

      <StatStrip
        items={[
          { label: "Still to collect", value: money(inAll.amount) },
          { label: "Still to pay", value: money(outAll.amount) },
          { label: "Overdue to collect", value: money(summary.coming.overdue.amount), tone: summary.coming.overdue.amount > 0 ? "warning" : "default" },
          { label: "Overdue to pay", value: money(summary.going.overdue.amount), tone: summary.going.overdue.amount > 0 ? "danger" : "default" },
          { label: "Cheques waiting to clear", value: money(chequeTotal) },
        ]}
      />
      <p className="-mt-3 text-xs text-ink-2">
        What is still unpaid on posted invoices, bills and expenses, by due date. These are the amounts on the documents, not a forecast of when money will actually move. Drafts and voided documents are left out.
      </p>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Show">
        {chips.map((c) => (
          <Link
            key={c.label}
            href={hrefFor(c.key)}
            aria-current={c.key === show ? "true" : undefined}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${c.key === show ? "border-accent bg-surface-2 font-medium text-ink" : "border-line text-ink-2 hover:bg-hover hover:text-ink"}`}
          >
            {c.label}
            <span className="ml-1.5 text-ink-2">
              <span className="tnum">{money(c.inAmt).replace("Rs ", "")}</span> in · <span className="tnum">{money(c.outAmt).replace("Rs ", "")}</span> out
            </span>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <section>
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-ink">Money coming in</h2>
            <span className="text-xs text-ink-2">
              {coming.parties.length}{coming.hasMore ? "+" : ""} {coming.parties.length === 1 && !coming.hasMore ? "customer" : "customers"} · <span className="tnum font-medium text-ink">{money(shown("coming").amount)}</span>
            </span>
          </div>
          <PartyRows parties={coming.parties} today={today} side="coming" bucket={show} empty="Nothing waiting to be collected." />
          {coming.hasMore && <p className="mt-1.5 text-xs text-ink-2">Showing the 30 most overdue. The Receivable Ageing report lists everyone.</p>}
        </section>
        <section>
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-ink">Money going out</h2>
            <span className="text-xs text-ink-2">
              {going.parties.length}{going.hasMore ? "+" : ""} {going.parties.length === 1 && !going.hasMore ? "party" : "parties"} · <span className="tnum font-medium text-ink">{money(shown("going").amount)}</span>
            </span>
          </div>
          {cheques.length > 0 && (
            <div className="mb-4">
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-2">Cheques waiting to clear</h3>
                <Link href="/payments/cheques" className="text-xs font-medium text-accent-text hover:underline">
                  See all →
                </Link>
              </div>
              <ul className="divide-y divide-[var(--border)] border-y border-line">
                {cheques.slice(0, 5).map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] text-ink">{c.payeeName}</p>
                      <p className="text-xs text-ink-2">
                        Cheque {c.chequeNumber} · <D value={c.chequeDate} style="short" />
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="tnum text-[13px] font-medium text-ink">{money(c.amount)}</span>
                      <StatusPill tone={viewOf({ status: "issued", chequeDate: c.chequeDate }, today) === "post_dated" ? "pending" : "action"}>{viewOf({ status: "issued", chequeDate: c.chequeDate }, today) === "post_dated" ? "Post-dated" : "Due"}</StatusPill>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <PartyRows parties={going.parties} today={today} side="going" bucket={show} empty="Nothing waiting to be paid." />
          {going.hasMore && <p className="mt-1.5 text-xs text-ink-2">Showing the 30 most overdue. The Payable Ageing report lists everything.</p>}
        </section>
      </div>
    </div>
  );
}
