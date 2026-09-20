"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createCalendarItem, updateCalendarItemStatus, deleteCalendarItem, generateComplianceItems, type listCalendarItems, type listAssignableUsers } from "../actions";

import { DatePicker } from "@/components/calendar/date-picker";
import { D } from "@/components/calendar/date-text";
import { useCalendar } from "@/components/calendar/calendar-provider";
import { WEEKDAYS_SHORT, monthCells, todayIso, ymdOf } from "@/lib/calendar";
type Item = Awaited<ReturnType<typeof listCalendarItems>>[number];
type UserOption = Awaited<ReturnType<typeof listAssignableUsers>>[number];

// Stored statuses. "Overdue" is not one of them: it is worked out from the due date, so it is shown as a flag.
const STATUSES = ["pending", "in_progress", "filed", "paid", "partially_paid", "not_applicable"] as const;
const CATEGORIES = [
  { key: "tax", name: "Tax" },
  { key: "statutory", name: "Statutory" },
  { key: "ownership", name: "Ownership" },
  { key: "company", name: "Company" },
];

export function CalendarTable({ items, users }: { items: Item[]; users: UserOption[] }) {
  const router = useRouter();
  const [showNew, setShowNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "month">("list");

  const [name, setName] = useState("");
  const [categoryKey, setCategoryKey] = useState("statutory");
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
        categoryKey,
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
    // Nothing is deleted to make it go away: "not applicable" needs a reason.
    let reason: string | undefined;
    if (status === "not_applicable") {
      reason = window.prompt("Why is this not applicable?")?.trim();
      if (!reason) return;
    }
    setBusy(true);
    setError(null);
    try {
      await updateCalendarItemStatus({ itemId: id, status, reason });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update status");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this compliance item?")) return;
    setBusy(true);
    setError(null);
    try {
      await deleteCalendarItem(id);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    } finally {
      setBusy(false);
    }
  }

  async function handleGenerate() {
    setBusy(true);
    setError(null);
    try {
      const created = await generateComplianceItems();
      setNotice(created > 0 ? `Added ${created} item${created === 1 ? "" : "s"}.` : "Everything that applies is already on the calendar.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate items");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        Items are generated from the requirement templates for your country and entity type. Due dates follow commonly-cited filing patterns — verify them against current rules before relying on them.
      </p>

      <div className="flex items-center justify-end gap-2">
        <div className="mr-auto flex rounded border border-gray-300 overflow-hidden text-sm">
          {(["list", "month"] as const).map((v) => (
            <button key={v} type="button" onClick={() => setView(v)} className={`px-3 py-1.5 capitalize ${view === v ? "bg-[var(--color-primary)] text-white" : "bg-white text-gray-600"}`}>
              {v === "list" ? "List" : "Month"} view
            </button>
          ))}
        </div>
        {notice && <span className="self-center text-xs text-gray-500">{notice}</span>}
        <button type="button" disabled={busy} onClick={handleGenerate} className="rounded border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm px-4 py-1.5 disabled:opacity-50">
          Generate items
        </button>
        <button type="button" onClick={() => setShowNew(true)} className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5">
          + New Item
        </button>
      </div>

      {error && !showNew && <p className="text-sm text-red-600">{error}</p>}

      {view === "month" && <MonthView items={items} />}

      {view === "list" && (
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
              <td className="px-4 py-2">
                {i.name}
                <span className="ml-2 text-xs capitalize text-gray-400">{i.categoryKey}</span>
              </td>
              <td className="px-4 py-2">{i.period}</td>
              <td className="px-4 py-2"><D value={i.dueDate} /></td>
              <td className="px-4 py-2">{i.responsibleUserName}</td>
              <td className="px-4 py-2">{i.amount ? Number(i.amount).toLocaleString(undefined, { minimumFractionDigits: 2 }) : "—"}</td>
              <td className="px-4 py-2">
                {i.isOverdue && <span className="mr-2 rounded bg-red-50 px-1.5 py-0.5 text-xs text-red-700">Overdue</span>}
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
                {i.source === "manual" && i.status === "pending" ? (
                  <button type="button" disabled={busy} onClick={() => handleDelete(i.id)} className="text-xs text-red-600 hover:underline disabled:opacity-40">
                    Delete
                  </button>
                ) : i.status === "not_applicable" && i.notApplicableReason ? (
                  <span className="text-xs text-gray-400" title={i.notApplicableReason}>
                    {i.notApplicableReason.slice(0, 24)}
                  </span>
                ) : null}
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
      )}

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
                <label className="block text-xs text-gray-500 mb-1">Category</label>
                <select value={categoryKey} onChange={(e) => setCategoryKey(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm">
                  {CATEGORIES.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Period</label>
                <input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="e.g. September 2026" className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Due date</label>
                <DatePicker value={dueDate} onChange={(v) => setDueDate(v)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
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

const CATEGORY_DOT: Record<string, string> = { tax: "bg-blue-500", statutory: "bg-violet-500", ownership: "bg-teal-500", company: "bg-slate-400" };

// A month grid in the organization's own calendar (a BS month for a BS organization).
// Every event sits on its real due date; only the display follows the calendar setting.
function MonthView({ items }: { items: Item[] }) {
  const calendar = useCalendar();
  const today = todayIso();
  const start = ymdOf(calendar, today) ?? ymdOf("AD", today)!;
  const [ym, setYm] = useState({ year: start.year, month: start.month });
  const cells = monthCells(calendar, ym.year, ym.month);

  const byDate = new Map<string, Item[]>();
  for (const i of items) {
    if (i.status === "not_applicable") continue;
    byDate.set(i.dueDate, [...(byDate.get(i.dueDate) ?? []), i]);
  }

  const step = (delta: number) =>
    setYm((prev) => {
      const idx = prev.year * 12 + (prev.month - 1) + delta;
      const next = { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
      return monthCells(calendar, next.year, next.month) ? next : prev;
    });

  if (!cells) return <p className="text-sm text-gray-500">This month is outside the supported calendar range.</p>;

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2">
        <button type="button" onClick={() => step(-1)} className="rounded px-2 py-1 text-gray-600 hover:bg-gray-100" aria-label="Previous month">
          ‹
        </button>
        <p className="text-sm font-semibold text-gray-900">
          {cells.monthName} {cells.year}
        </p>
        <button type="button" onClick={() => step(1)} className="rounded px-2 py-1 text-gray-600 hover:bg-gray-100" aria-label="Next month">
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 border-b border-gray-100 text-center text-xs text-gray-400">
        {WEEKDAYS_SHORT.map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {Array.from({ length: cells.leading }).map((_, i) => (
          <div key={`b${i}`} className="min-h-20 border-b border-r border-gray-50 bg-gray-50/40" />
        ))}
        {cells.days.map((d) => {
          const events = byDate.get(d.iso) ?? [];
          return (
            <div key={d.iso} className={`min-h-20 border-b border-r border-gray-100 p-1 ${d.iso === today ? "bg-blue-50/50" : ""}`}>
              <p className={`text-xs ${d.iso === today ? "font-semibold text-[var(--color-primary)]" : "text-gray-400"}`}>{d.day}</p>
              <div className="mt-1 space-y-0.5">
                {events.slice(0, 3).map((e) => {
                  const done = e.status === "filed" || e.status === "paid";
                  return (
                    <div key={e.id} title={`${e.name} — ${e.period} (${e.status.replace("_", " ")}${e.isOverdue ? ", overdue" : ""})`} className="flex items-center gap-1 text-[11px] leading-tight">
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${CATEGORY_DOT[e.categoryKey] ?? "bg-gray-400"}`} />
                      <span className={`truncate ${done ? "text-gray-400 line-through" : e.isOverdue ? "text-red-600" : "text-gray-700"}`}>{e.name}</span>
                    </div>
                  );
                })}
                {events.length > 3 && <p className="text-[10px] text-gray-400">+{events.length - 3} more</p>}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex gap-4 border-t border-gray-100 px-4 py-2 text-xs text-gray-500">
        {Object.entries({ tax: "Tax", statutory: "Statutory", ownership: "Ownership", company: "Company" }).map(([k, label]) => (
          <span key={k} className="flex items-center gap-1">
            <span className={`h-2 w-2 rounded-full ${CATEGORY_DOT[k]}`} /> {label}
          </span>
        ))}
      </div>
    </div>
  );
}
