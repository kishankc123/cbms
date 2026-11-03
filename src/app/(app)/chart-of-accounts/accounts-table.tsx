"use client";

import { useMemo, useState } from "react";
import { ListTree } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { DataTable, RowActions, SortableTh, Td, Th, Tr } from "@/components/ui/data-table";
import { FilterBar, SearchInput } from "@/components/ui/filters";
import { StatusPill } from "@/components/ui/status-pill";
import { EmptyState } from "@/components/ui/empty-state";
import { AddAccountDialog } from "./add-account-dialog";
import { useProblem } from "@/components/problem-dialog";
import { AccountRowActions, Balance, SystemBadge, TYPE_LABEL } from "./shared";
import { ACCOUNT_SUB_CATEGORIES } from "@/lib/ledger/account-sub-categories";

type Account = {
  id: string;
  code: string;
  name: string;
  category: "asset" | "liability" | "equity" | "income" | "expense";
  subCategory: string | null;
  tdsHeadKey: string | null;
  isActive: boolean;
  /** Balance including every account beneath it. */
  total: number;
  system: boolean;
  contra?: boolean;
};

type SortField = "code" | "name" | "category" | "total";

export function AccountsTable({ accounts }: { accounts: Account[] }) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [subCategoryFilter, setSubCategoryFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortField, setSortField] = useState<SortField>("code");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const filtering = Boolean(search || typeFilter !== "all" || subCategoryFilter !== "all" || statusFilter !== "all");
  // Problems are shown in a dialog that says why; closing it puts the cursor in the field that needs attention.
  const { report, dialog } = useProblem();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return accounts
      .filter((a) => !q || a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q))
      .filter((a) => typeFilter === "all" || a.category === typeFilter)
      .filter((a) => subCategoryFilter === "all" || a.subCategory === subCategoryFilter)
      .filter((a) => statusFilter === "all" || (statusFilter === "active" ? a.isActive : !a.isActive))
      .sort((a, b) => {
        const cmp = sortField === "total" ? a.total - b.total : a[sortField].localeCompare(b[sortField]);
        return sortDir === "asc" ? cmp : -cmp;
      });
  }, [accounts, search, typeFilter, subCategoryFilter, statusFilter, sortField, sortDir]);
  const dirOf = (field: SortField) => (field === sortField ? sortDir : null);
  function clearFilters() {
    setSearch("");
    setTypeFilter("all");
    setSubCategoryFilter("all");
    setStatusFilter("all");
  }

  function toggleSort(field: SortField) {
    if (field === sortField) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortField(field);
      setSortDir("asc");
    }
  }

  return (
    <div className="space-y-4">
      <FilterBar className="!mb-0">
        <SearchInput value={search} onChange={setSearch} placeholder="Search code or name" />
        <Select aria-label="Type" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="w-36">
          <option value="all">All types</option>
          {(Object.keys(TYPE_LABEL) as (keyof typeof TYPE_LABEL)[]).map((k) => (
            <option key={k} value={k}>
              {TYPE_LABEL[k]}
            </option>
          ))}
        </Select>
        <Select aria-label="Category" value={subCategoryFilter} onChange={(e) => setSubCategoryFilter(e.target.value)} className="w-44">
          <option value="all">All categories</option>
          {ACCOUNT_SUB_CATEGORIES.map((sc) => (
            <option key={sc.label} value={sc.label}>
              {sc.label}
            </option>
          ))}
        </Select>
        <Select aria-label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-32">
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </Select>
        {filtering && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Clear filters
          </Button>
        )}
        <div className="ml-auto">
          <AddAccountDialog label="Add account" startInside={false} groups={accounts.filter((a) => a.isActive).map((a) => ({ id: a.id, code: a.code, name: a.name, category: a.category, tdsHeadKey: a.tdsHeadKey }))} />
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
            <SortableTh direction={dirOf("category")} onSort={() => toggleSort("category")}>
              Type
            </SortableTh>
            <Th>Category</Th>
            <SortableTh align="right" direction={dirOf("total")} onSort={() => toggleSort("total")}>
              Balance
            </SortableTh>
            <Th>Status</Th>
            <Th className="w-10" />
          </Tr>
        </thead>
        <tbody>
          {filtered.map((a) => (
            <Tr key={a.id} className={a.isActive ? "" : "text-ink-2"}>
              <Td className="font-mono text-xs">{a.code}</Td>
              <Td>
                {a.name}
                {a.system && <SystemBadge />}
              </Td>
              <Td className="text-ink-2">{TYPE_LABEL[a.category]}</Td>
              <Td className="text-ink-2">{a.subCategory ?? "—"}</Td>
              <Td numeric>
                <Balance value={a.total} contra={a.contra} />
              </Td>
              <Td>{a.isActive ? <StatusPill tone="success">Active</StatusPill> : <StatusPill tone="neutral">Inactive</StatusPill>}</Td>
              <Td className="whitespace-nowrap text-right">
                <RowActions>
                  <AccountRowActions account={a} showSubCategory onError={(message) => report(message)} />
                </RowActions>
              </Td>
            </Tr>
          ))}
        </tbody>
      </DataTable>
      {filtered.length === 0 && (
        <EmptyState icon={ListTree} title="No accounts match" description="Try a different search, or clear the filters." action={filtering ? <Button onClick={clearFilters}>Clear filters</Button> : undefined} />
      )}
      <p className="text-xs text-ink-2">A group&apos;s balance includes everything in its sub-groups.</p>
    </div>
  );
}
