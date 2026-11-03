"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { Amount, DataTable, RowActions, SortableTh, Td, Th, Tr } from "@/components/ui/data-table";
import { FilterBar, SearchInput } from "@/components/ui/filters";
import { StatStrip } from "@/components/ui/stat-strip";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { EmptyState } from "@/components/ui/empty-state";

type Employee = {
  id: string;
  employeeCode: string;
  fullName: string;
  department: string | null;
  designation: string | null;
  employmentStatus: string;
};

type SortKey = "code" | "name" | "salary";

const STATUS_TONE: Record<string, StatusTone> = { active: "success", on_leave: "pending", inactive: "neutral", terminated: "neutral", resigned: "neutral" };

export function EmployeesTable({ employees, currentSalaries }: { employees: Employee[]; currentSalaries: Record<string, number> | null }) {
  const [search, setSearch] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const departments = useMemo(() => [...new Set(employees.map((e) => e.department).filter((d): d is string => Boolean(d)))].sort(), [employees]);
  const statuses = useMemo(() => [...new Set(employees.map((e) => e.employmentStatus))].sort(), [employees]);
  const label = (s: string) => s.replace("_", " ").replace(/^./, (c) => c.toUpperCase());
  const filtering = Boolean(search || departmentFilter || statusFilter);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = employees.filter(
      (e) =>
        (!q || e.fullName.toLowerCase().includes(q) || e.employeeCode.toLowerCase().includes(q) || (e.department ?? "").toLowerCase().includes(q)) &&
        (!departmentFilter || e.department === departmentFilter) &&
        (!statusFilter || e.employmentStatus === statusFilter)
    );
    if (sortKey) {
      rows = [...rows].sort((a, b) => {
        const cmp = sortKey === "salary" ? (currentSalaries?.[a.id] ?? 0) - (currentSalaries?.[b.id] ?? 0) : sortKey === "name" ? a.fullName.localeCompare(b.fullName) : a.employeeCode.localeCompare(b.employeeCode, undefined, { numeric: true });
        return sortDir === "asc" ? cmp : -cmp;
      });
    }
    return rows;
  }, [employees, search, departmentFilter, statusFilter, sortKey, sortDir, currentSalaries]);

  function toggleSort(key: SortKey) {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir("asc");
    } else setSortDir((d) => (d === "asc" ? "desc" : "asc"));
  }
  const dirOf = (key: SortKey) => (sortKey === key ? sortDir : null);
  function clearFilters() {
    setSearch("");
    setDepartmentFilter("");
    setStatusFilter("");
  }

  const active = employees.filter((e) => e.employmentStatus === "active");

  return (
    <div className="space-y-4">
      <StatStrip
        items={[
          { label: "Employees", value: employees.length },
          { label: "Active", value: active.length },
          { label: "Not active", value: employees.length - active.length },
          ...(currentSalaries ? [{ label: "Monthly basic (active)", value: <Amount value={active.reduce((s, e) => s + (currentSalaries[e.id] ?? 0), 0)} /> }] : []),
        ]}
      />

      <FilterBar className="!mb-0">
        <SearchInput value={search} onChange={setSearch} placeholder="Search name, ID or department" />
        {departments.length > 0 && (
          <Select aria-label="Department" value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)} className="w-44">
            <option value="">All departments</option>
            {departments.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>
        )}
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

      <DataTable stickyHeader>
        <thead>
          <Tr className="hover:bg-transparent">
            <SortableTh direction={dirOf("code")} onSort={() => toggleSort("code")}>
              Employee ID
            </SortableTh>
            <SortableTh direction={dirOf("name")} onSort={() => toggleSort("name")}>
              Full name
            </SortableTh>
            <Th>Department</Th>
            <Th>Designation</Th>
            <Th>Status</Th>
            {currentSalaries && (
              <SortableTh align="right" direction={dirOf("salary")} onSort={() => toggleSort("salary")}>
                Current basic salary
              </SortableTh>
            )}
            <Th className="w-24" />
          </Tr>
        </thead>
        <tbody>
          {filtered.map((e) => (
            <Tr key={e.id}>
              <Td className="font-mono text-xs">{e.employeeCode}</Td>
              <Td className="font-medium">
                <Link href={`/payroll/employees/${e.id}`} className="hover:underline">
                  {e.fullName}
                </Link>
              </Td>
              <Td className="text-ink-2">{e.department ?? "—"}</Td>
              <Td className="text-ink-2">{e.designation ?? "—"}</Td>
              <Td>
                <StatusPill tone={STATUS_TONE[e.employmentStatus] ?? "neutral"}>{label(e.employmentStatus)}</StatusPill>
              </Td>
              {currentSalaries && (
                <Td numeric>
                  <Amount value={currentSalaries[e.id] ?? 0} />
                </Td>
              )}
              <Td className="whitespace-nowrap text-right">
                <RowActions>
                  <Link href={`/payroll/employees/${e.id}`} className="text-xs text-accent-text hover:underline">
                    View profile
                  </Link>
                </RowActions>
              </Td>
            </Tr>
          ))}
        </tbody>
      </DataTable>
      {filtered.length === 0 &&
        (employees.length === 0 ? (
          <EmptyState icon={UserRound} title="No employees yet" description="Add an employee from the Add new tab and they will be listed here." />
        ) : (
          <EmptyState icon={UserRound} title="No employees match" description="Try a different search, or clear the filters." action={<Button onClick={clearFilters}>Clear filters</Button>} />
        ))}
    </div>
  );
}
