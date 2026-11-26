"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, ChevronRight } from "lucide-react";
import { RowMenu } from "@/components/row-menu";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useProblem } from "@/components/problem-dialog";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { Amount, DataTable, Td, Th, Tr } from "@/components/ui/data-table";
import { FilterBar, SearchInput } from "@/components/ui/filters";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { EmptyState } from "@/components/ui/empty-state";
import { DatePicker } from "@/components/calendar/date-picker";
import { D } from "@/components/calendar/date-text";
import { SOURCE_LABELS, type EntryState } from "@/lib/ledger/journal-rules";
import type { JournalFilters, JournalRow } from "@/lib/ledger/journal-list";
import { exportEntriesAction, listEntriesAction, reverseEntry } from "./actions";

type Account = { id: string; code: string; name: string };

const STATE: Record<EntryState, { label: string; tone: StatusTone }> = {
  posted: { label: "Posted", tone: "success" },
  reversed: { label: "Reversed", tone: "pending" },
  reversal: { label: "Reversal", tone: "neutral" },
};
const money = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const time = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kathmandu", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

/** The entries list: manual entries of this month to begin with; a row opens to its debit and credit lines. */
export function EntriesList({ accounts, month, opened, canReverse }: { accounts: Account[]; month: { from: string; to: string }; /** An entry to show opened (one just posted), with its date. */ opened: { id: string; date: string } | null; canReverse: boolean }) {
  const router = useRouter();
  const ask = useConfirm();
  const toast = useToast();
  const { report, dialog } = useProblem();
  // An entry just posted outside this month would be hidden by the month filter, so then all dates are shown.
  const outside = opened !== null && (opened.date < month.from || opened.date > month.to);
  const [filters, setFilters] = useState<JournalFilters>({ q: "", from: outside ? "" : month.from, to: outside ? "" : month.to, source: "manual", accountId: "", status: "" });
  const [rows, setRows] = useState<JournalRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set(opened ? [opened.id] : []));
  const asked = useRef(0);

  const set = (patch: Partial<JournalFilters>) => setFilters((f) => ({ ...f, ...patch }));

  async function load(offset: number) {
    const mine = ++asked.current;
    setLoading(true);
    try {
      const page = await listEntriesAction({ filters, offset });
      if (mine !== asked.current) return; // a newer filter has been asked for since
      setRows((before) => (offset === 0 ? page.rows : [...before, ...page.rows]));
      setHasMore(page.hasMore);
    } catch (e) {
      report(e instanceof Error ? e.message : "Could not load the entries", null);
    } finally {
      if (mine === asked.current) setLoading(false);
    }
  }

  useEffect(() => {
    const wait = window.setTimeout(() => void load(0), filters.q ? 300 : 0);
    return () => window.clearTimeout(wait);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  const toggle = (id: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  async function reverse(r: JournalRow) {
    if (!(await ask(`Reverse voucher ${r.voucher} for ${money.format(r.amount)}? A second entry with the opposite debits and credits is posted. The original stays in your books, marked reversed.`, { confirmLabel: "Reverse entry", danger: true }))) return;
    try {
      const form = new FormData();
      form.append("journalEntryId", r.id);
      await reverseEntry(form);
      toast.success(`Voucher ${r.voucher} reversed.`);
      await load(0);
      router.refresh();
    } catch (e) {
      report(e instanceof Error ? e.message : "Could not reverse the entry", null);
    }
  }

  async function download() {
    setExporting(true);
    try {
      const out = await exportEntriesAction(filters);
      if (out.entries === 0) return report("There are no entries to export with these filters.", null);
      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();
      const sheet = XLSX.utils.aoa_to_sheet(out.rows);
      sheet["!cols"] = [12, 12, 12, 40, 18, 10, 12, 32, 30, 14, 14, 18].map((wch) => ({ wch }));
      XLSX.utils.book_append_sheet(wb, sheet, "Journal entries");
      XLSX.writeFile(wb, "Journal entries.xlsx");
      if (out.cut) report(`Only the newest ${out.entries} entries were exported. Narrow the dates to get the rest.`, null);
    } catch (e) {
      report(e instanceof Error ? e.message : "Could not export", null);
    } finally {
      setExporting(false);
    }
  }

  const monthShown = filters.from === month.from && filters.to === month.to;
  const allDates = !filters.from && !filters.to;
  const chip = (on: boolean) => `rounded-full border px-3 py-1 text-xs transition-colors ${on ? "border-accent font-medium text-ink" : "border-line text-ink-2 hover:text-ink"}`;
  const narrowed = Boolean(filters.q || filters.accountId || filters.status || filters.source !== "manual" || !monthShown);

  return (
    <div className="space-y-3">
      <FilterBar className="!mb-0">
        <SearchInput value={filters.q ?? ""} onChange={(q) => set({ q })} placeholder="Search voucher, narration or amount" />
        <Select value={filters.source} onChange={(e) => set({ source: e.target.value })} aria-label="Source" className="w-44">
          <option value="manual">Source: Manual</option>
          <option value="all">All sources</option>
          {Object.entries(SOURCE_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </Select>
        <Select value={filters.accountId} onChange={(e) => set({ accountId: e.target.value })} aria-label="Account" className="w-56">
          <option value="">All accounts</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.code} — {a.name}
            </option>
          ))}
        </Select>
        <Select value={filters.status} onChange={(e) => set({ status: e.target.value as JournalFilters["status"] })} aria-label="Status" className="w-36">
          <option value="">All statuses</option>
          <option value="posted">Posted</option>
          <option value="reversed">Reversed</option>
          <option value="reversal">Reversal</option>
        </Select>
        <div className="ml-auto">
          <Button onClick={download} loading={exporting}>
            Export
          </Button>
        </div>
      </FilterBar>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={chip(monthShown)} onClick={() => set({ from: month.from, to: month.to })}>
          This month
        </button>
        <button type="button" className={chip(allDates)} onClick={() => set({ from: "", to: "" })}>
          All dates
        </button>
        <span className="text-xs text-ink-2">From</span>
        <DatePicker value={filters.from ?? ""} onChange={(from) => set({ from })} className="rounded-md border border-line-strong bg-surface px-2.5 py-[5px] text-[13px] text-ink" />
        <span className="text-xs text-ink-2">To</span>
        <DatePicker value={filters.to ?? ""} onChange={(to) => set({ to })} className="rounded-md border border-line-strong bg-surface px-2.5 py-[5px] text-[13px] text-ink" />
      </div>

      <DataTable>
        <thead>
          <Tr className="hover:bg-transparent">
            <Th>Date</Th>
            <Th>Voucher</Th>
            <Th>Narration</Th>
            <Th>Source</Th>
            <Th align="right">Amount</Th>
            <Th>Status</Th>
            <Th className="w-10" />
          </Tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isOpen = open.has(r.id);
            return (
              <Fragment key={r.id}>
                <Tr>
                  <Td className="whitespace-nowrap">
                    <D value={r.date} />
                  </Td>
                  <Td className="whitespace-nowrap font-mono text-xs">{r.voucher || "—"}</Td>
                  <Td>
                    <button type="button" aria-expanded={isOpen} onClick={() => toggle(r.id)} className="inline-flex items-center gap-1.5 text-left hover:underline" title={isOpen ? "Hide the lines" : "Show the lines"}>
                      <ChevronRight size={13} aria-hidden className={`shrink-0 text-ink-2 transition-transform ${isOpen ? "rotate-90" : ""}`} />
                      {r.narration || "No narration"}
                    </button>
                  </Td>
                  <Td className="text-ink-2">{r.source}</Td>
                  <Td numeric>
                    <Amount value={r.amount} />
                  </Td>
                  <Td>
                    <StatusPill tone={STATE[r.state].tone}>{STATE[r.state].label}</StatusPill>
                  </Td>
                  <Td className="text-right">
                    <RowMenu
                      items={[
                        { label: isOpen ? "Close" : "View", onClick: () => toggle(r.id) },
                        { label: "Print", onClick: () => router.push(`/journal/${r.id}?print=1`) },
                        { label: "Reverse", danger: true, hidden: !(canReverse && r.own && r.state === "posted"), onClick: () => void reverse(r) },
                      ]}
                    />
                  </Td>
                </Tr>
                {isOpen && (
                  <tr>
                    <td colSpan={7} className="border-b border-line bg-surface-2 px-3 py-2 pl-10">
                      <table className="w-full border-collapse text-[13px]">
                        <thead>
                          <tr className="text-left text-xs text-ink-2">
                            <th className="py-1 pr-3 font-medium">Account</th>
                            <th className="py-1 pr-3 font-medium">Line note</th>
                            <th className="w-32 py-1 text-right font-medium">Debit</th>
                            <th className="w-32 py-1 text-right font-medium">Credit</th>
                          </tr>
                        </thead>
                        <tbody>
                          {r.lines.map((l, i) => (
                            <tr key={i} className="border-t border-line">
                              <td className="py-1 pr-3">
                                {l.code} — {l.name}
                              </td>
                              <td className="py-1 pr-3 text-ink-2">{l.note}</td>
                              <td className="py-1 text-right tabular-nums">{l.debit ? money.format(l.debit) : ""}</td>
                              <td className="py-1 text-right tabular-nums">{l.credit ? money.format(l.credit) : ""}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <p className="mt-1.5 text-xs text-ink-3">
                        {r.enteredBy ? `Entered by ${r.enteredBy} on ` : "Entered on "}
                        <D value={r.enteredAt.slice(0, 10)} />, {time(r.enteredAt)}
                      </p>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </DataTable>

      {!loading && rows.length === 0 && (
        <EmptyState icon={BookOpen} title="No entries here" description={narrowed ? "Try other dates or filters." : "No manual entries this month. Choose All dates to see earlier ones, or post one from New entry."} />
      )}
      <div className="flex items-center justify-between text-xs text-ink-2">
        <span>{loading ? "Loading…" : `${rows.length}${hasMore ? "+" : ""} ${rows.length === 1 ? "entry" : "entries"}`}</span>
        {hasMore && (
          <Button size="sm" onClick={() => void load(rows.length)} disabled={loading}>
            Load more
          </Button>
        )}
      </div>
      {dialog}
    </div>
  );
}
