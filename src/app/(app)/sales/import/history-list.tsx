"use client";

import { useState } from "react";
import { useProblem } from "@/components/problem-dialog";
import { StatusPill } from "@/components/ui/status-pill";
import { ConfirmDialog } from "../confirm-dialog";
import { InfoDialog } from "../../inventory/info-dialog";
import { undoImport, type ImportSetup } from "./actions";

const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const TONE = { completed: "success", stopped: "action", undone: "pending", partly_undone: "action" } as const;
const LABEL = { completed: "Completed", stopped: "Stopped part-way", undone: "Undone", partly_undone: "Partly undone" } as const;

export function HistoryList({ history, canUndo, onChanged }: { history: ImportSetup["history"]; canUndo: boolean; onChanged: () => void }) {
  const { reportError, dialog } = useProblem();
  const [undoing, setUndoing] = useState<ImportSetup["history"][number] | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function confirmed() {
    const imp = undoing;
    setUndoing(null);
    if (!imp) return;
    try {
      const r = await undoImport(imp.id);
      if (!r.ok) return reportError(new Error(r.error));
      setMessage(r.kept.length === 0 ? `${r.voided} invoice${r.voided === 1 ? "" : "s"} voided.` : `${r.voided} voided. ${r.kept.length} kept: ${r.kept.slice(0, 3).map((k) => `${k.number} (${k.reason})`).join("; ")}${r.kept.length > 3 ? "…" : ""}`);
      onChanged();
    } catch (e) {
      reportError(e);
    }
  }

  return (
    <section className="overflow-x-auto rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)]">
      <h2 className="px-4 py-3 text-sm font-semibold text-[var(--text-primary)]">Previous imports</h2>
      <table className="w-full text-sm">
        <thead className="bg-[var(--surface-muted-bg)] text-left text-[var(--text-secondary)]">
          <tr>
            <th className="px-4 py-2 font-medium">File</th>
            <th className="px-4 py-2 font-medium">When</th>
            <th className="px-4 py-2 text-right font-medium">Invoices</th>
            <th className="px-4 py-2 text-right font-medium">Total</th>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2" />
          </tr>
        </thead>
        <tbody>
          {history.map((h) => (
            <tr key={h.id} className="border-t border-[var(--card-border)]">
              <td className="px-4 py-2">{h.fileName}</td>
              <td className="px-4 py-2 text-[var(--text-secondary)]">{new Date(h.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</td>
              <td className="px-4 py-2 text-right tabular-nums">{h.invoiceCount}</td>
              <td className="px-4 py-2 text-right tabular-nums">{money(h.total)}</td>
              <td className="px-4 py-2">
                <StatusPill tone={TONE[h.status as keyof typeof TONE] ?? "pending"}>{LABEL[h.status as keyof typeof LABEL] ?? h.status}</StatusPill>
              </td>
              <td className="px-4 py-2 text-right">
                {canUndo && h.active > 0 && (
                  <button type="button" onClick={() => setUndoing(h)} className="text-sm text-red-600 hover:underline">
                    Undo import
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {undoing && <ConfirmDialog message={`Void all ${undoing.active} invoice${undoing.active === 1 ? "" : "s"} from ${undoing.fileName}? An invoice with a payment recorded later can't be voided and stays.`} onYes={confirmed} onNo={() => setUndoing(null)} />}
      {message && <InfoDialog message={message} onOk={() => setMessage(null)} />}
      {dialog}
    </section>
  );
}
