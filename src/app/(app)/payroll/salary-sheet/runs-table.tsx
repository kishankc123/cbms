"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { D } from "@/components/calendar/date-text";
import { payrollPeriodLabel } from "@/lib/payroll/period-label";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { DataTable, RowActions, Td, Th, Tr } from "@/components/ui/data-table";
import { FilterBar, SearchInput } from "@/components/ui/filters";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { EmptyState } from "@/components/ui/empty-state";

type Run = { id: string; calendarSystem: string; month: number; year: number; status: string; periodStart: string; periodEnd: string };

const STATUS_TONE: Record<string, StatusTone> = { draft: "pending", finalized: "success", approved: "action", paid: "success", posted: "success", void: "neutral", voided: "neutral" };

export function RunsTable({ runs }: { runs: Run[] }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const statuses = useMemo(() => [...new Set(runs.map((r) => r.status))].sort(), [runs]);
  const label = (s: string) => s.replace("_", " ").replace(/^./, (c) => c.toUpperCase());
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return runs.filter((r) => (!q || payrollPeriodLabel(r).toLowerCase().includes(q)) && (!statusFilter || r.status === statusFilter));
  }, [runs, search, statusFilter]);
  const filtering = Boolean(search || statusFilter);
  const clearFilters = () => {
    setSearch("");
    setStatusFilter("");
  };

  return (
    <div className="space-y-4">
      <FilterBar className="!mb-0">
        <SearchInput value={search} onChange={setSearch} placeholder="Search period" />
        <Select aria-label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-40">
          <option value="">All statuses</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {label(s)}
            </option>
          ))}
        </Select>
        {filtering && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Clear filters
          </Button>
        )}
      </FilterBar>

      <DataTable>
        <thead>
          <Tr className="hover:bg-transparent">
            <Th>Period</Th>
            <Th>Date range</Th>
            <Th>Status</Th>
            <Th className="w-20" />
          </Tr>
        </thead>
        <tbody>
          {filtered.map((r) => (
            <Tr key={r.id}>
              <Td className="font-medium">
                <Link href={`/payroll/salary-sheet/${r.id}`} className="hover:underline">
                  {payrollPeriodLabel(r)}
                </Link>
              </Td>
              <Td className="whitespace-nowrap text-ink-2">
                <D value={r.periodStart} /> – <D value={r.periodEnd} />
              </Td>
              <Td>
                <StatusPill tone={STATUS_TONE[r.status] ?? "neutral"}>{label(r.status)}</StatusPill>
              </Td>
              <Td className="whitespace-nowrap text-right">
                <RowActions>
                  <Link href={`/payroll/salary-sheet/${r.id}`} className="text-xs text-accent-text hover:underline">
                    View
                  </Link>
                </RowActions>
              </Td>
            </Tr>
          ))}
        </tbody>
      </DataTable>
      {filtered.length === 0 &&
        (runs.length === 0 ? (
          <EmptyState icon={CalendarDays} title="No payroll runs yet" description="Generate a salary sheet from the Generate tab and it will be listed here." />
        ) : (
          <EmptyState icon={CalendarDays} title="No runs match" description="Try a different search, or clear the filters." action={<Button onClick={clearFilters}>Clear filters</Button>} />
        ))}
    </div>
  );
}
