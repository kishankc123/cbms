"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { StatusPill } from "@/components/ui/status-pill";
import { adminCard, adminField } from "../../ui";
import { addNewCountry, removeActiveCountry, type CountriesAdminData } from "./actions";
import { useConfirm } from "@/components/ui/confirm-dialog";

const TABS = ["Active countries", "Add new country"] as const;
const blank = { code: "", currency: "", calendar: "AD" as "AD" | "BS" };

export function CountriesAdmin({ data }: { data: CountriesAdminData }) {
  const router = useRouter();
  const ask = useConfirm();
  const [tab, setTab] = useState<(typeof TABS)[number]>(TABS[0]);
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A failure is shown under the tabs until the next try or tab change; a success is announced in a pop-up that closes on OK.
  async function run(job: () => Promise<{ ok: true } | { ok: false; error: string }>, onDone?: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      const r = await job();
      if (!r.ok) return setError(r.error);
      setForm(blank);
      router.refresh();
      await onDone?.();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b border-[var(--card-border)]">
        {TABS.map((t) => (
          <button key={t} type="button" onClick={() => {
              setTab(t);
              setError(null);
            }} className={`px-4 py-2 text-sm ${tab === t ? "border-b-2 border-[var(--color-primary)] font-medium text-[var(--text-primary)]" : "text-[var(--text-secondary)]"}`}>
            {t}
          </button>
        ))}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}

      {tab === TABS[0] ? (
        <div className={`${adminCard} overflow-x-auto`}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--card-border)] text-left text-xs text-[var(--text-secondary)]">
                <th className="px-4 py-2">Country</th>
                <th className="px-4 py-2">Code</th>
                <th className="px-4 py-2">Currency</th>
                <th className="px-4 py-2">Calendar</th>
                <th className="px-4 py-2">Organizations</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {data.countries.map((c) => (
                <tr key={c.code} className="border-b border-[var(--card-border)] last:border-0">
                  <td className="px-4 py-2 font-medium text-[var(--text-primary)]">{c.name}</td>
                  <td className="px-4 py-2">{c.code}</td>
                  <td className="px-4 py-2">{c.currency}</td>
                  <td className="px-4 py-2">{c.statutoryCalendar}</td>
                  <td className="px-4 py-2">{c.organizations > 0 ? <StatusPill tone="success">{c.organizations} in use</StatusPill> : 0}</td>
                  <td className="px-4 py-2 text-right">
                    <button
                      type="button"
                      disabled={busy || c.organizations > 0}
                      title={c.organizations > 0 ? "Organizations use this country" : undefined}
                      onClick={async () => (await ask(`Remove ${c.name} from the countries organizations can choose?`, { confirmLabel: "Remove", danger: true })) && run(() => removeActiveCountry(c.code))}
                      className="text-sm text-red-600 disabled:text-gray-300"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const name = data.available.find((c) => c.code === form.code)?.name;
            run(() => addNewCountry(form), async () => {
              setTab(TABS[0]);
              await ask(`${name} has been added to the active countries list.`, { title: "Country added", confirmLabel: "OK", cancelLabel: "" });
            });
          }}
          className={`${adminCard} grid gap-4 p-5 sm:grid-cols-3`}
        >
          <label className="text-sm">
            <span className="mb-1 block text-xs text-[var(--text-secondary)]">Country</span>
            <select
              className={`${adminField} w-full`}
              value={form.code}
              onChange={(e) => {
                const pick = data.available.find((c) => c.code === e.target.value);
                setForm({ code: e.target.value, currency: pick?.currency ?? "", calendar: pick?.calendar ?? "AD" });
              }}
              required
            >
              <option value="">Choose a country</option>
              {data.available.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-[var(--text-secondary)]">Currency (suggested, you can change it)</span>
            <input className={`${adminField} w-full uppercase`} value={form.currency} maxLength={3} onChange={(e) => setForm({ ...form, currency: e.target.value })} required />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-[var(--text-secondary)]">Calendar</span>
            <select className={`${adminField} w-full`} value={form.calendar} onChange={(e) => setForm({ ...form, calendar: e.target.value as "AD" | "BS" })}>
              <option value="AD">AD</option>
              <option value="BS">BS</option>
            </select>
          </label>
          <div className="sm:col-span-3">
            <p className="mb-3 text-xs text-[var(--text-secondary)]">The currency and calendar are suggested from the country. A new country has no tax rates, fines or filing requirements yet. Add them under Compliance Configuration.</p>
            <button type="submit" disabled={busy} className="rounded bg-[var(--color-primary)] px-4 py-2 text-sm text-white disabled:opacity-50">
              Add country
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
