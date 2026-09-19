import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenantSession } from "@/lib/session";
import { StatusPill } from "@/components/ui/status-pill";
import { getInterTransferDetail } from "../actions";
import { VoidButton } from "./void-button";

const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function TransferDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireTenantSession();
  const t = await getInterTransferDetail(id);
  if (!t) notFound();

  const rows: [string, string][] = [
    ["Transfer No.", t.transferNumber],
    ["Date", t.transferDate],
    ["From Account", t.fromAccountName],
    ["To Account", t.toAccountName],
    ["Amount", fmt(t.amount)],
    ["Reference", t.reference ?? "—"],
    ["Description", t.description ?? "—"],
  ];

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Transfer {t.transferNumber}</h1>
          <p className="mt-0.5 text-sm text-gray-500">Inter-Transfer</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill tone={t.status === "posted" ? "success" : "critical"}>{t.status}</StatusPill>
          {t.status === "posted" && (
            <>
              <Link href={`/payments/inter-transfer/${t.id}/edit`} className="rounded border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm px-4 py-1.5">Edit</Link>
              <VoidButton transferId={t.id} transferNumber={t.transferNumber} />
            </>
          )}
        </div>
      </div>

      <section className="rounded-lg border border-gray-200 bg-white p-5 space-y-3">
        <div className="grid grid-cols-[10rem_1fr] gap-x-4 gap-y-1.5 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <span className="text-gray-500">{label}</span>
              <span className="text-gray-900">{value}</span>
            </div>
          ))}
          <span className="text-gray-500">Attachment</span>
          <span>
            {t.attachmentUrl ? (
              <a href={t.attachmentUrl} target="_blank" rel="noreferrer" className="text-[var(--color-primary)] hover:underline break-all">{t.attachmentUrl}</a>
            ) : "—"}
          </span>
          {t.status === "voided" && (
            <>
              <span className="text-gray-500">Void reason</span>
              <span className="text-gray-900">{t.voidReason}</span>
            </>
          )}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-900">Accounting Entry</h2>
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-500">
              <tr>
                <th className="px-3 py-2 text-xs font-semibold">Account</th>
                <th className="px-3 py-2 text-xs font-semibold text-right">Debit</th>
                <th className="px-3 py-2 text-xs font-semibold text-right">Credit</th>
              </tr>
            </thead>
            <tbody>
              {t.entryLines.map((l, i) => (
                <tr key={i} className="border-t border-gray-100">
                  <td className="px-3 py-2">{l.accountName}</td>
                  <td className="px-3 py-2 text-right">{l.debit > 0 ? fmt(l.debit) : "-"}</td>
                  <td className="px-3 py-2 text-right">{l.credit > 0 ? fmt(l.credit) : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {t.status === "voided" && <p className="text-xs text-gray-500">This entry has been reversed by the void.</p>}
      </section>

      <Link href="/payments/inter-transfer" className="text-sm text-gray-500 hover:text-gray-700">← Back to transfers</Link>
    </div>
  );
}
