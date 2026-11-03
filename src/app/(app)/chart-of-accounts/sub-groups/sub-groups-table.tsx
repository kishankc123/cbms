"use client";

import { useMemo, useState } from "react";
import { ListTree } from "lucide-react";
import { AddAccountDialog, type GroupChoice } from "../add-account-dialog";
import { useProblem } from "@/components/problem-dialog";
import { AccountRowActions, Balance, SystemBadge } from "../shared";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { DataTable, RowActions, SortableTh, Td, Th, Tr } from "@/components/ui/data-table";
import { FilterBar, SearchInput } from "@/components/ui/filters";
import { StatusPill } from "@/components/ui/status-pill";
import { EmptyState } from "@/components/ui/empty-state";

type Group = GroupChoice;
type SubGroup = {
  id: string;
  code: string;
  name: string;
  category: "asset" | "liability" | "equity" | "income" | "expense";
  isActive: boolean;
  parentAccountId: string | null;
  tdsHeadKey: string | null;
  /** This account's own balance (its group's total includes it). */
  own: number;
  system: boolean;
};

type SortField = "code" | "name" | "own";

export function SubGroupsTable({ groups, subGroups, groupById }: { groups: Group[]; subGroups: SubGroup[]; groupById: Record<string, Group> }) {
  // Problems are shown in a dialog that says why; closing it puts the cursor in the field that needs attention.
  const { report, dialog } = useProblem();
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sortField, setSortField] = useState<SortField>("code");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const filtering = Boolean(search || groupFilter || statusFilter);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return subGroups
      .filter((s) => (!q || s.code.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)) && (!groupFilter || s.parentAccountId === groupFilter) && (statusFilter === "active" ? s.isActive : statusFilter === "inactive" ? !s.isActive : true))
      .sort((a, b) => {
        const cmp = sortField === "own" ? a.own - b.own : a[sortField].localeCompare(b[sortField], undefined, { numeric: true });
        return sortDir === "asc" ? cmp : -cmp;
      });
  }, [subGroups, search, groupFilter, statusFilter, sortField, sortDir]);

  function toggleSort(field: SortField) {
    if (field === sortField) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortField(field);
      setSortDir("asc");
    }
  }
  const dirOf = (field: SortField) => (field === sortField ? sortDir : null);
  function clearFilters() {
    setSearch("");
    setGroupFilter("");
    setStatusFilter("");
  }

  return (
    <div className="space-y-4">
      <FilterBar className="!mb-0">
        <SearchInput value={search} onChange={setSearch} placeholder="Search code or name" />
        <Select aria-label="Group" value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)} className="w-48">
          <option value="">All groups</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.code} — {g.name}
            </option>
          ))}
        </Select>
        <Select aria-label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-32">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </Select>
        {filtering && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Clear filters
          </Button>
        )}
        <div className="ml-auto">
          <AddAccountDialog label="Add sub-group" startInside groups={groups} />
        </div>
      </FilterBar>

      {dialog}

      <DataTable stickyHeader>
        <thead>
          <Tr className="hover:bg-transparent">
            <SortableTh direction={dirOf("code")} onSort={() => toggleSort("code")}>
              Code
            </SortableTh>
            <SortableTh direction={dirOf("name")} onSort={() => toggleSort("name")}>
              Name
            </SortableTh>
            <Th>Group</Th>
            <SortableTh align="right" direction={dirOf("own")} onSort={() => toggleSort("own")}>
              Balance
            </SortableTh>
            <Th>Status</Th>
            <Th className="w-10" />
          </Tr>
        </thead>
        <tbody>
          {shown.map((sg) => (
            <Tr key={sg.id} className={sg.isActive ? "" : "text-ink-2"}>
              <Td className="font-mono text-xs">{sg.code}</Td>
              <Td>
                {sg.name}
                {sg.system && <SystemBadge />}
              </Td>
              <Td className="text-ink-2">{sg.parentAccountId ? groupById[sg.parentAccountId]?.name ?? "—" : "—"}</Td>
              <Td numeric>
                <Balance value={sg.own} />
              </Td>
              <Td>{sg.isActive ? <StatusPill tone="success">Active</StatusPill> : <StatusPill tone="neutral">Inactive</StatusPill>}</Td>
              <Td className="whitespace-nowrap text-right">
                <RowActions>
                  <AccountRowActions account={{ ...sg, parentTdsHeadKey: sg.parentAccountId ? groupById[sg.parentAccountId]?.tdsHeadKey ?? null : null }} showSubCategory={false} onError={(message) => report(message)} />
                </RowActions>
              </Td>
            </Tr>
          ))}
        </tbody>
      </DataTable>
      {shown.length === 0 &&
        (subGroups.length === 0 ? (
          <EmptyState icon={ListTree} title="No sub-groups yet" description="Add a sub-group to break a group down into smaller accounts." />
        ) : (
          <EmptyState icon={ListTree} title="No sub-groups match" description="Try a different search, or clear the filters." action={<Button onClick={clearFilters}>Clear filters</Button>} />
        ))}
    </div>
  );
}
