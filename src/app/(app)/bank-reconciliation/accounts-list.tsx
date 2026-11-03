"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Landmark } from "lucide-react";
import type { AccountOverview } from "./actions";
import { D } from "@/components/calendar/date-text";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { Amount, DataTable, SortableTh, Td, Th, Tr } from "@/components/ui/data-table";
import { FilterBar, SearchInput } from "@/components/ui/filters";
import { StatStrip } from "@/components/ui/stat-strip";
import { StatusPill } from "@/components/ui/status-pill";
import { EmptyState } from "@/components/ui/empty-state";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// Where this account's bank balance stands against the books, in a sentence.
function differenceText(a: AccountOverview) {
  if (!a.updatedUpTo) return "Upload a statement to compare it with your books.";
  if (Math.abs(a.difference) < 0.005) return "The bank balance matches your books.";
  return a.difference > 0 ? "The bank balance is higher than your books." : "The bank balance is lower than your books.";
}

// The badge tells the truth about where the account stands: nothing imported, lines to match, a difference still to explain, or done.
function StatusBadge({ a }: { a: AccountOverview }) {
  if (!a.updatedUpTo) return <StatusPill tone="pending">No statement uploaded yet</StatusPill>;
  if (a.unreconciled > 0) return <StatusPill tone="action">{plural(a.unreconciled, "unreconciled transaction", "unreconciled transactions")}</StatusPill>;
  if (Math.abs(a.difference) >= 0.005) return <StatusPill tone="action">Difference to explain</StatusPill>;
  return <StatusPill tone="success">All reconciled</StatusPill>;
}

const stateOf = (a: AccountOverview) => (!a.updatedUpTo ? "nostatement" : a.unreconciled > 0 || Math.abs(a.difference) >= 0.005 ? "attention" : "reconciled");

type SortKey = "name" | "difference";

export function AccountsList({ accounts }: { accounts: AccountOverview[] }) {
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const filtering = Boolean(search || kindFilter || stateFilter);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = accounts.filter((a) => (!q || a.label.toLowerCase().includes(q) || (a.accountNumber ?? "").toLowerCase().includes(q)) && (!kindFilter || a.kind === kindFilter) && (!stateFilter || stateOf(a) === stateFilter));
    if (sortKey) {
      list = [...list].sort((a, b) => {
        const cmp = sortKey === "name" ? a.label.localeCompare(b.label) : Math.abs(a.difference) - Math.abs(b.difference);
        return sortDir === "asc" ? cmp : -cmp;
      });
    }
    return list;
  }, [accounts, search, kindFilter, stateFilter, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir("asc");
    } else setSortDir((d) => (d === "asc" ? "desc" : "asc"));
  }
  const dirOf = (key: SortKey) => (sortKey === key ? sortDir : null);
  function clearFilters() {
    setSearch("");
    setKindFilter("");
    setStateFilter("");
  }

  const needAttention = accounts.filter((a) => stateOf(a) !== "reconciled").length;

  return (
    <div className="space-y-4">
      <StatStrip
        items={[
          { label: "Accounts", value: accounts.length },
          { label: "Need attention", value: needAttention, tone: needAttention > 0 ? "warning" : "default" },
          { label: "Unreconciled transactions", value: accounts.reduce((s, a) => s + a.unreconciled, 0) },
          { label: "Flagged transactions", value: accounts.reduce((s, a) => s + a.flagged, 0), tone: accounts.some((a) => a.flagged > 0) ? "danger" : "default" },
        ]}
      />

      <FilterBar className="!mb-0">
        <SearchInput value={search} onChange={setSearch} placeholder="Search account or number" />
        <Select aria-label="Account type" value={kindFilter} onChange={(e) => setKindFilter(e.target.value)} className="w-44">
          <option value="">All account types</option>
          <option value="bank">Bank</option>
          <option value="wallet">Cash or wallet</option>
        </Select>
        <Select aria-label="State" value={stateFilter} onChange={(e) => setStateFilter(e.target.value)} className="w-48">
          <option value="">All states</option>
          <option value="attention">Needs attention</option>
          <option value="nostatement">No statement yet</option>
          <option value="reconciled">All reconciled</option>
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
            <SortableTh direction={dirOf("name")} onSort={() => toggleSort("name")}>
              Account
            </SortableTh>
            <Th align="right">Per bank statement</Th>
            <Th align="right">Per your books</Th>
            <SortableTh align="right" direction={dirOf("difference")} onSort={() => toggleSort("difference")}>
              Difference
            </SortableTh>
            <Th>Status</Th>
            <Th className="w-16" />
          </Tr>
        </thead>
        <tbody>
          {shown.map((a) => (
            <Tr key={a.id}>
              <Td>
                <Link href={`/bank-reconciliation/${a.id}`} className="font-medium hover:underline">
                  {a.label}
                </Link>
                <p className="text-xs text-ink-2">
                  {a.kind === "bank" ? "Bank" : "Cash or wallet"}
                  {a.accountNumber ? ` · ${a.accountNumber}` : ""}
                </p>
              </Td>
              <Td numeric>
                <Amount value={a.statementBalance} />
                <p className="text-xs text-ink-3">{a.updatedUpTo ? <>up to <D value={a.updatedUpTo} /></> : "no statement"}</p>
              </Td>
              <Td numeric>
                <Amount value={a.ledgerBalance} />
              </Td>
              <Td numeric>
                <span className={Math.abs(a.difference) < 0.005 ? "text-[var(--success-text)]" : "text-[var(--danger-text)]"}>
                  <Amount value={a.difference} />
                </span>
                <p className="text-xs text-ink-3">{differenceText(a)}</p>
              </Td>
              <Td>
                <div className="flex flex-wrap gap-1">
                  <StatusBadge a={a} />
                  {a.flagged > 0 && <StatusPill tone="critical">{plural(a.flagged, "flagged", "flagged")}</StatusPill>}
                </div>
              </Td>
              <Td className="whitespace-nowrap text-right">
                <Link href={`/bank-reconciliation/${a.id}`} className="text-xs font-medium text-accent-text hover:underline">
                  Open
                </Link>
              </Td>
            </Tr>
          ))}
        </tbody>
      </DataTable>
      {shown.length === 0 && (
        <EmptyState
          icon={Landmark}
          title={accounts.length === 0 ? "No active bank accounts yet" : "No accounts match"}
          description={accounts.length === 0 ? "Set up a bank account before reconciling." : "Try a different search, or clear the filters."}
          action={accounts.length === 0 ? <Link href="/bank-reconciliation/setup" className="text-[13px] text-accent-text hover:underline">Set one up</Link> : <Button onClick={clearFilters}>Clear filters</Button>}
        />
      )}
    </div>
  );
}
