"use client";

import { D } from "@/components/calendar/date-text";
import { ReportFooter, ReportHeader, ReportSheet } from "@/components/report-sheet";
import type { Line } from "@/lib/suppliers/reconcile-rules";

// The reconciliation as a report: the statement from your balance to theirs, what is only on one side, and what was matched. It is what Print, Excel, Image and PDF
// save (the shared export reads this #report-sheet), so it is kept off the screen: the interactive page above is the one people work in.

type Left = { id: string; date: string; reference: string; description: string; effect: number; reason: string };
type Group = { id: string; kind: string; status: "confirmed" | "suggested"; theirIds: string[]; ourIds: string[]; stale: boolean };

const REASON: Record<string, string> = { timing: "Timing", dispute: "Disputed", our_error: "Our mistake", their_error: "Their mistake", other: "Other" };
const KIND: Record<string, string> = { reference: "Same document number", reference_diff: "Same document number, different amount", amount_date: "Same amount, close dates", combination: "Several lines add up", manual: "Matched by hand" };

const money = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (n: number) => (n < 0 ? `(${money.format(Math.abs(n))})` : money.format(n));

const th = "border-b border-line px-2 py-1.5 text-left text-xs font-medium text-ink-2";
const thr = `${th} !text-right`;
const td = "px-2 py-1 text-[13px]";
const tdr = `${td} text-right`;

export function ReconciliationSheet({
  header,
  vendorName,
  from,
  to,
  status,
  signedOffAt,
  ourClosing,
  theirClosing,
  difference,
  bridge,
  theirs,
  ours,
  groups,
  theirsOnly,
  oursOnly,
}: {
  header: { company: string; address: string };
  vendorName: string;
  from: string;
  to: string;
  status: string;
  signedOffAt: string;
  ourClosing: number;
  theirClosing: number;
  difference: number;
  bridge: { label: string; amount: number }[];
  theirs: Line[];
  ours: Line[];
  groups: Group[];
  theirsOnly: Left[];
  oursOnly: Left[];
}) {
  const period = (
    <>
      {vendorName} · <D value={from} /> to <D value={to} />
      {status === "reconciled" && signedOffAt ? <> · signed off <D value={signedOffAt} /></> : null}
    </>
  );
  const head = (title: string) => <ReportHeader {...header} title={title} period={period} />;
  const theirById = new Map(theirs.map((l) => [l.id, l]));
  const ourById = new Map(ours.map((l) => [l.id, l]));
  const shown = groups.filter((g) => !g.stale);

  return (
    <div className="pointer-events-none absolute -left-[10000px] top-0 w-[1100px] print:pointer-events-auto print:static print:w-auto" aria-hidden="true">
      <ReportSheet name="Supplier reconciliation">
        <section className="mb-8">
          {head("Reconciliation statement")}
          <table className="w-full border-collapse">
            <tbody>
              <tr>
                <td className={`${td} font-medium`}>
                  Balance in our books at <D value={to} />
                </td>
                <td className={`${tdr} font-medium`}>{fmt(ourClosing)}</td>
              </tr>
              {bridge.map((r, i) => {
                const last = i === bridge.length - 1;
                return (
                  <tr key={r.label} className={last ? "border-t border-line-strong" : ""}>
                    <td className={`${td} ${last ? "font-medium" : ""}`}>{last ? r.label : `${r.amount < 0 ? "Less" : "Add"}: ${r.label.toLowerCase()}`}</td>
                    <td className={`${tdr} ${last ? "font-medium" : ""}`}>{fmt(r.amount)}</td>
                  </tr>
                );
              })}
              <tr>
                <td className={td}>Their statement says</td>
                <td className={tdr}>{fmt(theirClosing)}</td>
              </tr>
              <tr>
                <td className={`${td} font-medium`}>Difference</td>
                <td className={`${tdr} font-medium`}>{fmt(difference)}</td>
              </tr>
            </tbody>
          </table>
          <ReportFooter />
        </section>

        <section className="mb-8">
          {head("Only on their statement")}
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={th}>Date</th>
                <th className={th}>Document no.</th>
                <th className={th}>Particulars</th>
                <th className={thr}>Amount</th>
                <th className={th}>Reason</th>
              </tr>
            </thead>
            <tbody>
              {theirsOnly.map((l) => (
                <tr key={l.id}>
                  <td className={td}><D value={l.date} /></td>
                  <td className={td}>{l.reference}</td>
                  <td className={td}>{l.description}</td>
                  <td className={tdr}>{fmt(l.effect)}</td>
                  <td className={td}>{REASON[l.reason] ?? ""}</td>
                </tr>
              ))}
              {theirsOnly.length === 0 && (
                <tr>
                  <td className={td} colSpan={5}>Everything on their statement is matched.</td>
                </tr>
              )}
            </tbody>
          </table>
          <ReportFooter />
        </section>

        <section className="mb-8">
          {head("Only in our books")}
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={th}>Date</th>
                <th className={th}>Document no.</th>
                <th className={th}>Particulars</th>
                <th className={thr}>Amount</th>
                <th className={th}>Reason</th>
              </tr>
            </thead>
            <tbody>
              {oursOnly.map((l) => (
                <tr key={l.id}>
                  <td className={td}><D value={l.date} /></td>
                  <td className={td}>{l.reference}</td>
                  <td className={td}>{l.description}</td>
                  <td className={tdr}>{fmt(l.effect)}</td>
                  <td className={td}>{REASON[l.reason] ?? ""}</td>
                </tr>
              ))}
              {oursOnly.length === 0 && (
                <tr>
                  <td className={td} colSpan={5}>Everything in our books for this period is matched.</td>
                </tr>
              )}
            </tbody>
          </table>
          <ReportFooter />
        </section>

        <section>
          {head("Matched items")}
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={th}>Date</th>
                <th className={th}>Their document</th>
                <th className={th}>Our document</th>
                <th className={thr}>Their amount</th>
                <th className={thr}>Our amount</th>
                <th className={thr}>Difference</th>
                <th className={th}>Matched by</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((g) => {
                const t = g.theirIds.map((id) => theirById.get(id)).filter((x): x is Line => Boolean(x));
                const o = g.ourIds.map((id) => ourById.get(id)).filter((x): x is Line => Boolean(x));
                const tSum = t.reduce((s, l) => s + l.effect, 0);
                const oSum = o.reduce((s, l) => s + l.effect, 0);
                return (
                  <tr key={g.id}>
                    <td className={td}>{t[0] ? <D value={t[0].date} /> : null}</td>
                    <td className={td}>{t.map((l) => l.reference).filter(Boolean).join(", ")}</td>
                    <td className={td}>{o.map((l) => l.reference).filter(Boolean).join(", ")}</td>
                    <td className={tdr}>{fmt(tSum)}</td>
                    <td className={tdr}>{fmt(oSum)}</td>
                    <td className={tdr}>{fmt(oSum - tSum)}</td>
                    <td className={td}>
                      {KIND[g.kind] ?? g.kind}
                      {g.status === "suggested" ? " (not yet confirmed)" : ""}
                    </td>
                  </tr>
                );
              })}
              {shown.length === 0 && (
                <tr>
                  <td className={td} colSpan={7}>Nothing matched.</td>
                </tr>
              )}
            </tbody>
          </table>
          <ReportFooter />
        </section>
      </ReportSheet>
    </div>
  );
}
