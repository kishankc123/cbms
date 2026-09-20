"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createStatutoryItem, updateStatutoryItem, type listStatutory, type StatutoryPatch, type StatutoryInput } from "../statutory-actions";
import { updateCalendarItemStatus } from "../actions";
import type { ObligationStatus } from "@/lib/compliance/engine/status";
import { ObligationStatusPill } from "@/components/compliance/status-pill";
import { StatusPill } from "@/components/ui/status-pill";
import { D } from "@/components/calendar/date-text";
import { DatePicker } from "@/components/calendar/date-picker";

type Data = Awaited<ReturnType<typeof listStatutory>>;
type Item = Data["items"][number];

const sel = "rounded border border-gray-300 px-2 py-1.5 text-sm";
const input = "w-full rounded border border-gray-300 px-2 py-1.5 text-sm disabled:bg-gray-50";
const FREQ: Record<string, string> = { monthly: "Monthly", quarterly: "Quarterly", annual: "Annual", one_time: "One-time", event_based: "When it happens" };
const CATEGORY: Record<string, string> = { statutory: "Statutory", ownership: "Ownership", company: "Company" };
// Statutory items are done or not: the tax-only statuses (paid, partly paid) do not apply.
const STATUSES: { key: ObligationStatus; label: string }[] = [
  { key: "pending", label: "Pending" },
  { key: "in_progress", label: "In progress" },
  { key: "filed", label: "Completed" },
  { key: "not_applicable", label: "Not applicable" },
];

export function StatutoryTable({ data }: { data: Data }) {
  const router = useRouter();
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState("open");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<Item | null>(null);
  const [adding, setAdding] = useState(false);
  const [showReqs, setShowReqs] = useState(false);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.items.filter((i) => {
      if (category !== "all" && i.categoryKey !== category) return false;
      if (status === "open" && ["filed", "not_applicable"].includes(i.effective)) return false;
      if (status !== "all" && status !== "open" && i.effective !== status) return false;
      return !q || `${i.name} ${i.period}`.toLowerCase().includes(q);
    });
  }, [data.items, category, status, search]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Search</label>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Requirement or period…" className={`${sel} w-52`} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Category</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className={sel}>
              <option value="all">All categories</option>
              {Object.entries(CATEGORY).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={sel}>
              <option value="open">Open</option>
              <option value="all">All statuses</option>
              <option value="overdue">Overdue</option>
              <option value="pending">Pending</option>
              <option value="in_progress">In progress</option>
              <option value="filed">Completed</option>
              <option value="not_applicable">Not applicable</option>
            </select>
          </div>
        </div>
        {data.canCreate && (
          <button type="button" onClick={() => setAdding(true)} className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5">
            + Add Compliance
          </button>
        )}
      </div>

      {!data.entityTypeSet && (
        <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Requirements depend on your company type. <Link href="/compliance/company" className="underline">Set it in Company Details</Link>.
        </p>
      )}

      <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden">
        <thead className="bg-gray-50 text-left text-gray-500">
          <tr>
            <th className="px-4 py-2 font-medium">Requirement</th>
            <th className="px-4 py-2 font-medium">Frequency</th>
            <th className="px-4 py-2 font-medium">Due date</th>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 font-medium">Completed</th>
            <th className="px-4 py-2 font-medium">Reference</th>
            <th className="px-4 py-2 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((i) => (
            <tr key={i.id} className="border-t border-gray-100 hover:bg-gray-50/60 cursor-pointer" onClick={() => setOpen(i)}>
              <td className="px-4 py-2">
                <span className="font-medium text-gray-900">{i.name}</span>
                <span className="ml-2 text-xs text-gray-400">
                  {CATEGORY[i.categoryKey] ?? i.categoryKey}
                  {i.period && i.period !== "—" ? ` · ${i.period}` : ""}
                </span>
              </td>
              <td className="px-4 py-2">{FREQ[i.frequency]}</td>
              <td className="px-4 py-2 whitespace-nowrap">
                <D value={i.dueDate} />
              </td>
              <td className="px-4 py-2">
                <ObligationStatusPill status={i.effective} completedLabel="Completed" />
              </td>
              <td className="px-4 py-2 whitespace-nowrap">{i.completedDate ? <D value={i.completedDate} /> : "—"}</td>
              <td className="px-4 py-2">{i.referenceNumber || "—"}</td>
              <td className="px-4 py-2 text-right">
                <button type="button" className="text-xs text-[var(--color-primary)] hover:underline">
                  View
                </button>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                {data.items.length === 0 ? "No statutory items yet. Add one, or they appear once their deadlines are set up for your company type." : "Nothing matches these filters."}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <section className="rounded-lg border border-gray-200 bg-white">
        <button type="button" onClick={() => setShowReqs((v) => !v)} className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-gray-900">
          Requirements that apply to your company ({data.requirements.length})
          <span className="text-gray-400">{showReqs ? "−" : "+"}</span>
        </button>
        {showReqs && (
          <div className="border-t border-gray-100">
            <table className="w-full text-sm">
              <tbody>
                {data.requirements.map((r) => (
                  <tr key={r.key} className="border-t border-gray-50 first:border-t-0">
                    <td className="px-4 py-2">
                      <p className="text-gray-900">{r.name}</p>
                      {r.description && <p className="text-xs text-gray-400">{r.description}</p>}
                    </td>
                    <td className="px-4 py-2 text-gray-500">{FREQ[r.frequency]}</td>
                    <td className="px-4 py-2 text-gray-500">{r.authority || "—"}</td>
                    <td className="px-4 py-2 text-right">
                      <StatusPill tone={r.scheduled ? "success" : "action"}>{r.scheduled ? "Scheduled" : "Deadline not yet confirmed"}</StatusPill>
                    </td>
                  </tr>
                ))}
                {data.requirements.length === 0 && (
                  <tr>
                    <td className="px-4 py-4 text-center text-gray-400">No requirements apply yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
            <p className="border-t border-gray-100 px-4 py-2 text-xs text-gray-400">A requirement is scheduled once a platform administrator has confirmed its deadline rule. Until then it can still be tracked by adding it manually.</p>
          </div>
        )}
      </section>

      {open && <ItemModal key={open.id} item={open} data={data} onClose={() => setOpen(null)} onSaved={() => router.refresh()} />}
      {adding && <AddModal data={data} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); router.refresh(); }} />}
    </div>
  );
}

function Shell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto py-8">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-lg bg-white p-5 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-600">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ItemModal({ item, data, onClose, onSaved }: { item: Item; data: Data; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<StatutoryPatch>({ completedDate: item.completedDate, referenceNumber: item.referenceNumber, supportingDocument: item.supportingDocument, notes: item.notes, responsibleUserId: item.responsibleUserId, dueDate: item.dueDate });
  const [status, setStatus] = useState<ObligationStatus>(item.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editable = data.canEdit;
  const dueEditable = editable && item.source !== "generated";

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (status !== item.status) {
        let reason: string | undefined;
        if (status === "not_applicable") {
          reason = window.prompt("Why is this not applicable?")?.trim();
          if (!reason) throw new Error("A reason is required");
        }
        await updateCalendarItemStatus({ itemId: item.id, status, reason });
      }
      await updateStatutoryItem(item.id, { ...form, dueDate: dueEditable ? form.dueDate : undefined });
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell title={item.name} onClose={onClose}>
      <p className="mb-3 text-xs text-gray-500">
        {CATEGORY[item.categoryKey]} · {FREQ[item.frequency]}
        {item.period !== "—" ? ` · ${item.period}` : ""}
      </p>
      {item.notApplicableReason && <p className="mb-3 rounded bg-gray-50 px-3 py-2 text-xs text-gray-600">Marked not applicable: {item.notApplicableReason}</p>}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Status</label>
          <select className={input} value={status} onChange={(e) => setStatus(e.target.value as ObligationStatus)} disabled={!editable}>
            {STATUSES.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Due date</label>
          <DatePicker value={form.dueDate ?? ""} onChange={(v) => setForm({ ...form, dueDate: v })} disabled={!dueEditable} className={input} />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Completed date</label>
          <DatePicker value={form.completedDate} onChange={(v) => setForm({ ...form, completedDate: v })} disabled={!editable} className={input} />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Reference number</label>
          <input className={input} value={form.referenceNumber} onChange={(e) => setForm({ ...form, referenceNumber: e.target.value })} disabled={!editable} />
        </div>
        <div className="col-span-2">
          <label className="block text-xs text-gray-500 mb-1">Responsible</label>
          <select className={input} value={form.responsibleUserId} onChange={(e) => setForm({ ...form, responsibleUserId: e.target.value })} disabled={!editable}>
            <option value="">Unassigned</option>
            {data.users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>
        <div className="col-span-2">
          <label className="block text-xs text-gray-500 mb-1">Supporting document (reference)</label>
          <input className={input} value={form.supportingDocument} onChange={(e) => setForm({ ...form, supportingDocument: e.target.value })} disabled={!editable} placeholder="Link or file name" />
        </div>
        <div className="col-span-2">
          <label className="block text-xs text-gray-500 mb-1">Notes</label>
          <textarea rows={2} className={input} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} disabled={!editable} />
        </div>
      </div>
      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100">
          {editable ? "Cancel" : "Close"}
        </button>
        {editable && (
          <button type="button" disabled={busy} onClick={save} className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5 disabled:opacity-50">
            {busy ? "Saving..." : "Save"}
          </button>
        )}
      </div>
    </Shell>
  );
}

function AddModal({ data, onClose, onSaved }: { data: Data; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: "", categoryKey: "statutory", frequency: "one_time", period: "", dueDate: "", responsibleUserId: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await createStatutoryItem({ ...f, frequency: f.frequency as StatutoryInput["frequency"] });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell title="Add compliance requirement" onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="block text-xs text-gray-500 mb-1">Requirement</label>
          <input className={input} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Category</label>
          <select className={input} value={f.categoryKey} onChange={(e) => setF({ ...f, categoryKey: e.target.value })}>
            {Object.entries(CATEGORY).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Frequency</label>
          <select className={input} value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value })}>
            {Object.entries(FREQ).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Period (optional)</label>
          <input className={input} value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })} placeholder="e.g. FY 2082/83" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Due date</label>
          <DatePicker value={f.dueDate} onChange={(v) => setF({ ...f, dueDate: v })} className={input} />
        </div>
        <div className="col-span-2">
          <label className="block text-xs text-gray-500 mb-1">Responsible</label>
          <select className={input} value={f.responsibleUserId} onChange={(e) => setF({ ...f, responsibleUserId: e.target.value })}>
            <option value="">Unassigned</option>
            {data.users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>
        <div className="col-span-2">
          <label className="block text-xs text-gray-500 mb-1">Notes</label>
          <textarea rows={2} className={input} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </div>
      </div>
      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100">
          Cancel
        </button>
        <button type="button" disabled={busy || !f.name.trim() || !f.dueDate} onClick={save} className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5 disabled:opacity-50">
          {busy ? "Adding..." : "Add"}
        </button>
      </div>
    </Shell>
  );
}
