"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { formatMoney } from "@/lib/ledger/daybook-export";
import { NOTE_VALUES, compareCount, countedTotal, type SavedCount } from "@/lib/ledger/cash-count-rules";
import { saveCashCountAction } from "./actions";

const card = "rounded-lg border border-line bg-surface p-4";
const td = "border-b border-line px-2.5 py-1.5";

export type CountAccount = { id: string; name: string; book: number; saved: SavedCount | null };

// Count the notes in the till at the end of the day; the page shows how far the count is from the books. Saving it records the count only: the books are not changed.
export function CashCount({ day, accounts, canEdit }: { day: string; accounts: CountAccount[]; canEdit: boolean }) {
  if (accounts.length === 0) return null;
  return (
    <section className={card}>
      <h2 className="mb-1 text-sm font-semibold text-ink">Cash count</h2>
      <p className="mb-3 text-xs text-ink-2">Count the notes in your till and see how far you are from the books. Saving a count does not change your books.</p>
      <div className="space-y-5">
        {accounts.map((a) => (
          <CountForm key={`${day}-${a.id}`} day={day} account={a} canEdit={canEdit} showName={accounts.length > 1} />
        ))}
      </div>
    </section>
  );
}

// Used by the Daybook and by Bank Reconciliation (a cash account): one count record, written from either.
export function CountForm({ day, account, canEdit, showName, onSaved }: { day: string; account: CountAccount; canEdit: boolean; showName: boolean; onSaved?: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const saved = account.saved;
  const [notes, setNotes] = useState<Record<string, string>>(() => Object.fromEntries(NOTE_VALUES.map((v) => [String(v), saved?.notes[String(v)] ? String(saved.notes[String(v)]) : ""])));
  const [other, setOther] = useState(saved && saved.other > 0 ? String(saved.other) : "");
  const [remark, setRemark] = useState(saved?.remark ?? "");
  const [busy, setBusy] = useState(false);
  // A business with no note-by-note record can enter just the total: it is kept as "coins and other cash" with no notes.
  const [totalOnly, setTotalOnly] = useState(Boolean(saved && Object.keys(saved.notes).length === 0 && saved.other > 0));

  const parsed = Object.fromEntries((totalOnly ? [] : Object.entries(notes)).map(([k, v]) => [k, Number(v === "" ? 0 : v)]));
  const noteProblem = !totalOnly && Object.values(parsed).some((n) => !Number.isInteger(n) || n < 0);
  const otherNum = other.trim() === "" ? 0 : Number(other);
  const otherProblem = !Number.isFinite(otherNum) || otherNum < 0;
  const counted = noteProblem || otherProblem ? 0 : countedTotal(parsed, otherNum);
  const result = compareCount(counted, account.book);
  const touched = (!totalOnly && Object.values(notes).some((v) => v !== "")) || other !== "";

  async function save() {
    setBusy(true);
    const r = await saveCashCountAction({ day, accountId: account.id, notes: totalOnly ? {} : notes, other, remark });
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    toast.success("Cash count saved.");
    router.refresh();
    onSaved?.();
  }

  const tone = result.status === "matches" ? "text-[var(--success-text)]" : "text-[var(--danger-text)]";
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]">
      <div>
        {showName && <p className="mb-1.5 text-[13px] font-medium text-ink">{account.name}</p>}
        {canEdit && (
          <div className="mb-2 flex gap-3 text-xs">
            <button type="button" onClick={() => setTotalOnly(false)} className={totalOnly ? "text-accent hover:underline" : "font-medium text-ink"}>
              By notes and coins
            </button>
            <button type="button" onClick={() => setTotalOnly(true)} className={totalOnly ? "font-medium text-ink" : "text-accent hover:underline"}>
              Total only
            </button>
          </div>
        )}
        {totalOnly ? (
          <label className="flex items-center gap-2 text-[13px]">
            <span className="text-ink-2">Total cash counted</span>
            <Input inputMode="decimal" value={other} disabled={!canEdit} onChange={(e) => setOther(e.target.value)} placeholder="0" className="!h-8 w-36 text-right" aria-label="Total cash counted" />
          </label>
        ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-x-3 gap-y-2">
          {NOTE_VALUES.map((v) => (
            <label key={v} className="flex items-center gap-2 text-[13px]">
              <span className="tnum w-12 text-right text-ink-2">{v}</span>
              <span className="text-ink-2">×</span>
              <Input inputMode="numeric" value={notes[String(v)]} disabled={!canEdit} onChange={(e) => setNotes({ ...notes, [String(v)]: e.target.value })} placeholder="0" className="!h-8 w-20 text-right" aria-label={`Number of ${v} notes`} />
            </label>
          ))}
          <label className="flex items-center gap-2 text-[13px]">
            <span className="w-12 text-right text-ink-2">Coins</span>
            <span className="text-ink-2">=</span>
            <Input inputMode="decimal" value={other} disabled={!canEdit} onChange={(e) => setOther(e.target.value)} placeholder="0" className="!h-8 w-20 text-right" aria-label="Coins and other cash" />
          </label>
        </div>
        )}
        {(noteProblem || otherProblem) && <p className="mt-2 text-xs text-[var(--danger-text)]">Use whole numbers for notes and a plain amount for coins.</p>}
        <div className="mt-3">
          <Input value={remark} disabled={!canEdit} onChange={(e) => setRemark(e.target.value)} placeholder="Note, e.g. who counted or why it differs" maxLength={300} aria-label="Note about this count" />
        </div>
      </div>
      <div>
        <table className="w-full border-collapse text-[13px]">
          <tbody>
            <tr>
              <td className={td}>Counted</td>
              <td className={`${td} tnum text-right`}>{formatMoney(result.counted)}</td>
            </tr>
            <tr>
              <td className={td}>Books say</td>
              <td className={`${td} tnum text-right`}>{formatMoney(result.book)}</td>
            </tr>
            <tr className="font-semibold">
              <td className="px-2.5 py-1.5">{result.status === "matches" ? "Matches" : result.status === "short" ? "Short by" : "Over by"}</td>
              <td className={`tnum px-2.5 py-1.5 text-right ${touched ? tone : "text-ink-2"}`}>{touched ? formatMoney(Math.abs(result.difference)) : "—"}</td>
            </tr>
          </tbody>
        </table>
        {saved && <p className="mt-2 text-xs text-ink-2">Saved count: {formatMoney(saved.counted)}. The books said {formatMoney(saved.book)} at the time.</p>}
        {canEdit && (
          <div className="mt-3">
            <Button size="sm" variant="primary" loading={busy} disabled={noteProblem || otherProblem || !touched} onClick={save}>
              {saved ? "Update count" : "Save count"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
