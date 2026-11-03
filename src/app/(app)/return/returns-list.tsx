"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Undo2 } from "lucide-react";
import { RowMenu } from "@/components/row-menu";
import { useProblem } from "@/components/problem-dialog";
import { D } from "@/components/calendar/date-text";
import { DatePicker } from "@/components/calendar/date-picker";
import { Button } from "@/components/ui/button";
import { controlClass, Select } from "@/components/ui/field";
import { Amount, DataTable, RowActions, SortableTh, Td, Th, Tr } from "@/components/ui/data-table";
import { FilterBar, SearchInput } from "@/components/ui/filters";
import { StatStrip } from "@/components/ui/stat-strip";
import { StatusPill } from "@/components/ui/status-pill";
import { EmptyState } from "@/components/ui/empty-state";
import { useConfirm } from "@/components/ui/confirm-dialog";

// The list of debit notes (sales returns) or credit notes (purchase returns): the two screens differ only in their words and
// in which action voids a note, so one list serves both.

export type ReturnNote = { id: string; number: string; partyId: string; date: string; total: string; status: string };

type SortKey = "date" | "number" | "party" | "total" | "status";
type SortDir = "asc" | "desc";

const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2 });

export function ReturnsList({
  notes,
  partyById,
  partyLabel,
  noteLabel,
  onVoid,
}: {
  notes: ReturnNote[];
  partyById: Record<string, { id: string; name: string }>;
  /** "Customer" or "Supplier". */
  partyLabel: string;
  /** "Debit note" or "Credit note". */
  noteLabel: string;
  /** Voids one note by its id (the screen's own server action). */
  onVoid: (noteId: string) => Promise<unknown>;
}) {
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [partyFilter, setPartyFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const router = useRouter();
  const ask = useConfirm();
  const { report, dialog } = useProblem();
  const filtering = Boolean(search || dateFrom || dateTo || partyFilter || statusFilter);
  const lower = noteLabel.toLowerCase();

  async function voidRow(n: ReturnNote) {
    if (!(await ask(`Void ${lower} ${n.number}?`, { danger: true, confirmLabel: "Void" }))) return;
    try {
      await onVoid(n.id);
      router.refresh();
    } catch (e) {
      report(e instanceof Error ? e.message : `Could not void the ${lower}`, null);
    }
  }

  function toggleSort(key: SortKey) {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir("asc");
    } else {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    }
  }
  const dirOf = (key: SortKey) => (sortKey === key ? sortDir : null);

  function clearFilters() {
    setSearch("");
    setDateFrom("");
    setDateTo("");
    setPartyFilter("");
    setStatusFilter("");
  }

  const live = notes.filter((n) => n.status !== "void");
  const sorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = notes.filter((n) => {
      if (q && !(n.number.toLowerCase().includes(q) || (partyById[n.partyId]?.name ?? "").toLowerCase().includes(q) || n.total.toLowerCase().includes(q))) return false;
      if (dateFrom && n.date < dateFrom) return false;
      if (dateTo && n.date > dateTo) return false;
      if (partyFilter && n.partyId !== partyFilter) return false;
      if (statusFilter === "void" ? n.status !== "void" : statusFilter === "active" ? n.status === "void" : false) return false;
      return true;
    });
    if (sortKey) {
      rows = [...rows].sort((a, b) => {
        let av: string | number;
        let bv: string | number;
        switch (sortKey) {
          case "date":
            av = a.date;
            bv = b.date;
            break;
          case "number":
            av = a.number;
            bv = b.number;
            break;
          case "total":
            av = Number(a.total);
            bv = Number(b.total);
            break;
          case "status":
            av = a.status;
            bv = b.status;
            break;
          default:
            av = partyById[a.partyId]?.name ?? "";
            bv = partyById[b.partyId]?.name ?? "";
        }
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return sortDir === "asc" ? cmp : -cmp;
      });
    }
    return rows;
  }, [notes, partyById, search, dateFrom, dateTo, partyFilter, statusFilter, sortKey, sortDir]);

  return (
    <div className="space-y-4">
      <StatStrip
        items={[
          { label: `${noteLabel}s`, value: live.length },
          { label: "Total returned", value: fmt(live.reduce((s, n) => s + Number(n.total), 0)) },
          { label: "Voided", value: notes.length - live.length },
        ]}
      />

      <FilterBar className="!mb-0">
        <SearchInput value={search} onChange={setSearch} placeholder={`Search ${lower} #, ${partyLabel.toLowerCase()} or amount`} />
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-ink-2">From</span>
          <DatePicker value={dateFrom} onChange={setDateFrom} className={`${controlClass} w-40`} />
          <span className="text-xs text-ink-2">To</span>
          <DatePicker value={dateTo} onChange={setDateTo} className={`${controlClass} w-40`} />
        </div>
        <Select aria-label={partyLabel} value={partyFilter} onChange={(e) => setPartyFilter(e.target.value)} className="w-44">
          <option value="">All {partyLabel.toLowerCase()}s</option>
          {Object.values(partyById).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <Select aria-label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-36">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="void">Void</option>
        </Select>
        {filtering && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Clear filters
          </Button>
        )}
      </FilterBar>

      <DataTable stickyHeader>
        <thead>
          <Tr className="hover:bg-transparent">
            <SortableTh direction={dirOf("date")} onSort={() => toggleSort("date")}>
              Date
            </SortableTh>
            <SortableTh direction={dirOf("number")} onSort={() => toggleSort("number")}>
              {noteLabel} #
            </SortableTh>
            <SortableTh direction={dirOf("party")} onSort={() => toggleSort("party")}>
              {partyLabel}
            </SortableTh>
            <SortableTh align="right" direction={dirOf("total")} onSort={() => toggleSort("total")}>
              Amount
            </SortableTh>
            <SortableTh direction={dirOf("status")} onSort={() => toggleSort("status")}>
              Status
            </SortableTh>
            <Th className="w-10" />
          </Tr>
        </thead>
        <tbody>
          {sorted.map((n) => (
            <Tr key={n.id}>
              <Td className="whitespace-nowrap">
                <D value={n.date} />
              </Td>
              <Td className="font-mono text-xs">{n.number}</Td>
              <Td className="max-w-56 truncate">{partyById[n.partyId]?.name ?? "—"}</Td>
              <Td numeric className="font-medium">
                <Amount value={Number(n.total)} />
              </Td>
              <Td>
                <StatusPill tone={n.status === "void" ? "neutral" : "success"}>{n.status === "void" ? "Void" : "Posted"}</StatusPill>
              </Td>
              <Td className="whitespace-nowrap">
                <RowActions>
                  <RowMenu items={[{ label: "Void", onClick: () => voidRow(n), danger: true, hidden: n.status === "void" }]} />
                </RowActions>
              </Td>
            </Tr>
          ))}
        </tbody>
      </DataTable>
      {sorted.length === 0 &&
        (notes.length === 0 ? (
          <EmptyState icon={Undo2} title={`No ${lower}s yet`} description={`Record a return from the Add new tab and its ${lower} will be listed here.`} />
        ) : (
          <EmptyState icon={Undo2} title={`No ${lower}s match`} description="Try a different search, or clear the filters." action={<Button onClick={clearFilters}>Clear filters</Button>} />
        ))}
      {dialog}
    </div>
  );
}
