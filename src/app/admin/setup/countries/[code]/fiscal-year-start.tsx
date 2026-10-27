"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { monthNames } from "@/lib/calendar";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { adminField } from "../../../ui";
import { saveFiscalYearStart } from "../actions";

export function FiscalYearStart({ code, calendar, month }: { code: string; calendar: "AD" | "BS"; month: number }) {
  const router = useRouter();
  const ask = useConfirm();
  const [value, setValue] = useState(month);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const r = await saveFiscalYearStart(code, value);
      if (!r.ok) return setError(r.error);
      router.refresh();
      await ask(`The fiscal year now starts in ${monthNames(calendar)[value - 1]}.`, { title: "Saved", confirmLabel: "OK", cancelLabel: "" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-sm">
        <span className="mb-1 block text-xs text-[var(--text-secondary)]">Fiscal year starts in</span>
        <select className={adminField} value={value} onChange={(e) => setValue(Number(e.target.value))}>
          {monthNames(calendar).map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
      </label>
      <button type="button" disabled={busy || value === month} onClick={save} className="rounded bg-[var(--color-primary)] px-4 py-1.5 text-sm text-white disabled:opacity-50">
        Save
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
