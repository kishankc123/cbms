"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createCalendarItem, updateCalendarItemStatus, deleteCalendarItem, seedNepaliDefaults, type listCalendarItems, type listAssignableUsers } from "../actions";

type Item = Awaited<ReturnType<typeof listCalendarItems>>[number];
type UserOption = Awaited<ReturnType<typeof listAssignableUsers>>[number];

const STATUSES = ["upcoming", "due", "prepared", "under_review", "submitted", "paid", "completed", "overdue"] as const;

export function CalendarTable({ items, users }: { items: Item[]; users: UserOption[] }) {
  const router = useRouter();
  const [showNew, setShowNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [applicableCompany, setApplicableCompany] = useState("");
  const [period, setPeriod] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [responsibleUserId, setResponsibleUserId] = useState("");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");

  async function handleCreate() {
    setError(null);
    setBusy(true);
    try {
      await createCalendarItem({
        name,
        applicableCompany,
        period,
        dueDate,
        responsibleUserId: responsibleUserId || null,
        amount: amount ? parseFloat(amount) : null,
        notes,
      });
      setShowNew(false);
      setName("");
      setPeriod("");
      setDueDate("");
      setAmount("");
      setNotes("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create item");
    } finally {
      setBusy(false);
    }
  }

  async function handleStatusChange(id: string, status: (typeof STATUSES)[number]) {
    setBusy(true);
    try {
      await updateCalendarItemStatus({ itemId: id, status });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this compliance item?")) return;
    setBusy(true);
    try {
      await deleteCalendarItem(id);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleSeed() {
    if (!confirm("Add default VAT Return / TDS Deposit items for the next 6 months? Verify dates against current IRD rules afterward.")) return;
    setBusy(true);
    try {
      await seedNepaliDefaults(6);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        Default items (if seeded) use commonly-cited Nepal filing patterns as a starting point — verify every date against current IRD rules before relying on them.
      </p>

      <div className="flex justify-end gap-2">
        <button type="button" disabled={busy} onClick={handleSeed} className="rounded border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm px-4 py-1.5 disabled:opacity-50">
          Seed Nepal defaults (6 months)
        </button>
        <button type="button" onClick={() => setShowNew(true)} className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5">
          + New Item
        </button>
      </div>

      <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden">
        <thead className="bg-gray-50 text-left text-gray-500">
          <tr>
            <th className="px-4 py-2 font-medium">Name</th>
            <th className="px-4 py-2 font-medium">Period</th>
            <th className="px-4 py-2 font-medium">Due date</th>
            <th className="px-4 py-2 font-medium">Responsible</th>
            <th className="px-4 py-2 font-medium">Amount</th>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id} className="border-t border-gray-100">
              <td className="px-4 py-2">{i.name}</td>
              <td className="px-4 py-2">{i.period}</td>
              <td className="px-4 py-2">{i.dueDate}</td>
              <td className="px-4 py-2">{i.responsibleUserName}</td>
              <td className="px-4 py-2">{i.amount ? Number(i.amount).toLocaleString(undefined, { minimumFractionDigits: 2 }) : "—"}</td>
              <td className="px-4 py-2">
                <select
                  value={i.status}
                  disabled={busy}
                  onChange={(e) => handleStatusChange(i.id, e.target.value as (typeof STATUSES)[number])}
                  className="rounded border border-gray-300 px-1.5 py-1 text-xs capitalize"
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s.replace("_", " ")}
                    </option>
                  ))}
                </select>
              </td>
              <td className="px-4 py-2 text-right">
                <button type="button" disabled={busy} onClick={() => handleDelete(i.id)} className="text-xs text-red-600 hover:underline disabled:opacity-40">
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {items.length === 0 && (
            <tr>
              <td colSpan={7} className="px-4 py-6 text-center text-gray-400">
                No compliance items yet
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto py-8">
          <div className="absolute inset-0 bg-black/30" onClick={() => setShowNew(false)} />
          <div className="relative w-full max-w-lg rounded-lg bg-white p-5 shadow-lg space-y-4">
            <h2 className="text-base font-semibold text-gray-900">New compliance item</h2>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-xs text-gray-500 mb-1">Compliance name</label>
                <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Applicable company</label>
                <input value={applicableCompany} onChange={(e) => setApplicableCompany(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Period</label>
                <input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="e.g. September 2026" className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Due date</label>
                <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Responsible user</label>
                <select value={responsibleUserId} onChange={(e) => setResponsibleUserId(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm">
                  <option value="">Unassigned</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Amount</label>
                <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-gray-500 mb-1">Notes</label>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
              </div>
            </div>

            {error && <p className="text-xs text-red-600">{error}</p>}

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowNew(false)} className="rounded px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100">
                Cancel
              </button>
              <button type="button" disabled={busy || !name.trim() || !dueDate} onClick={handleCreate} className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5 disabled:opacity-50">
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
