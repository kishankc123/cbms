"use client";

import { useMemo, useState } from "react";
import { History } from "lucide-react";
import { listAuditTrail } from "../actions";
import { DatePicker } from "@/components/calendar/date-picker";
import { DT } from "@/components/calendar/date-text";
import { Button } from "@/components/ui/button";
import { controlClass, Select } from "@/components/ui/field";
import { DataTable, Td, Th, Tr } from "@/components/ui/data-table";
import { FilterBar, SearchInput } from "@/components/ui/filters";
import { EmptyState } from "@/components/ui/empty-state";
import { TableSkeleton } from "@/components/ui/skeleton";

type Entry = Awaited<ReturnType<typeof listAuditTrail>>[number];

export function AuditTrailTable({ initialEntries }: { initialEntries: Entry[] }) {
  const [entries, setEntries] = useState(initialEntries);
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [entityType, setEntityType] = useState("");
  const [loading, setLoading] = useState(false);
  const [applied, setApplied] = useState(false);

  // Entity types to choose from: those seen in the trail loaded first.
  const entityTypes = useMemo(() => [...new Set(initialEntries.map((e) => e.entityType))].sort(), [initialEntries]);

  async function load(next: { from: string; to: string; entityType: string }) {
    setLoading(true);
    try {
      setEntries(await listAuditTrail({ from: next.from || undefined, to: next.to || undefined, entityType: next.entityType || undefined }));
      setApplied(Boolean(next.from || next.to || next.entityType));
    } finally {
      setLoading(false);
    }
  }

  function clearFilters() {
    setSearch("");
    setFrom("");
    setTo("");
    setEntityType("");
    load({ from: "", to: "", entityType: "" });
  }

  // The search box narrows what is already loaded; the dates and entity type ask for a fresh list.
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? entries.filter((e) => `${e.userName} ${e.action} ${e.entityType}`.toLowerCase().includes(q)) : entries;
  }, [entries, search]);
  const filtering = Boolean(search || applied || from || to || entityType);

  return (
    <div className="space-y-4">
      <FilterBar className="!mb-0">
        <SearchInput value={search} onChange={setSearch} placeholder="Search user, action or entity" />
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-ink-2">From</span>
          <DatePicker value={from} onChange={setFrom} className={`${controlClass} w-40`} />
          <span className="text-xs text-ink-2">To</span>
          <DatePicker value={to} onChange={setTo} className={`${controlClass} w-40`} />
        </div>
        <Select aria-label="Entity type" value={entityType} onChange={(e) => setEntityType(e.target.value)} className="w-48">
          <option value="">All entity types</option>
          {entityTypes.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Select>
        <Button variant="primary" loading={loading} onClick={() => load({ from, to, entityType })}>
          Apply
        </Button>
        {filtering && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Clear filters
          </Button>
        )}
      </FilterBar>

      {loading ? (
        <TableSkeleton rows={6} cols={6} />
      ) : (
        <DataTable stickyHeader>
          <thead>
            <Tr className="hover:bg-transparent">
              <Th>Date / time</Th>
              <Th>User</Th>
              <Th>Action</Th>
              <Th>Entity</Th>
              <Th>Before</Th>
              <Th>After</Th>
            </Tr>
          </thead>
          <tbody>
            {shown.map((e) => (
              <Tr key={e.id}>
                <Td className="whitespace-nowrap">
                  <DT value={e.timestamp} />
                </Td>
                <Td className="whitespace-nowrap">{e.userName}</Td>
                <Td>{e.action}</Td>
                <Td>
                  {e.entityType}
                  {e.entityId ? <span className="text-ink-3"> ({e.entityId.slice(0, 8)})</span> : ""}
                </Td>
                <Td className="max-w-52 truncate text-xs text-ink-2">{e.beforeValue ? JSON.stringify(e.beforeValue) : "—"}</Td>
                <Td className="max-w-52 truncate text-xs text-ink-2">{e.afterValue ? JSON.stringify(e.afterValue) : "—"}</Td>
              </Tr>
            ))}
          </tbody>
        </DataTable>
      )}
      {!loading && shown.length === 0 && (
        <EmptyState icon={History} title={filtering ? "No entries match" : "No audit entries recorded yet"} description={filtering ? "Try different filters, or clear them." : "Changes made in the books will be recorded here."} action={filtering ? <Button onClick={clearFilters}>Clear filters</Button> : undefined} />
      )}
    </div>
  );
}
