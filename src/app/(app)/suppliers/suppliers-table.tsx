"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Truck } from "lucide-react";
import { createSupplier } from "./actions";
import { SupplierFormModal } from "./supplier-form-modal";
import { DateRangeControl, type DateFilter } from "./date-range-control";
import { payeeTypeLabel, PAYEE_TYPES } from "@/lib/compliance/platform-tax-rate-types";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { Amount, DataTable, RowActions, SortableTh, Td, Th, Tr } from "@/components/ui/data-table";
import { FilterBar, SearchInput } from "@/components/ui/filters";
import { StatStrip } from "@/components/ui/stat-strip";
import { StatusPill } from "@/components/ui/status-pill";
import { EmptyState } from "@/components/ui/empty-state";

type Supplier = {
  id: string;
  name: string;
  phone: string;
  details: string;
  /** "company" or "individual" (proprietorship), or "" when not set: decides the TDS rate on what is paid to them. */
  businessType: string;
  openingBalance: number;
  /** The opening balance as the ledger has it (what the balance builds on). */
  ledgerOpening: number;
  /** Other entries posted to the supplier's account (manual vouchers...), signed to the balance. */
  others: { date: string; amount: number }[];
  bills: { date: string; total: number }[];
  payments: { date: string; amount: number }[];
};

type SortField = "name" | "outstanding";

function computePeriod(s: Supplier, filter: DateFilter) {
  const isBeforeFrom = (date: string) => filter.mode === "range" && !!filter.from && date < filter.from;
  const inRange = (date: string) => {
    if (filter.mode === "all") return true;
    if (filter.from && date < filter.from) return false;
    if (filter.to && date > filter.to) return false;
    return true;
  };

  const opening =
    s.ledgerOpening +
    s.bills.filter((b) => isBeforeFrom(b.date)).reduce((sum, b) => sum + b.total, 0) -
    s.payments.filter((p) => isBeforeFrom(p.date)).reduce((sum, p) => sum + p.amount, 0) +
    s.others.filter((o) => isBeforeFrom(o.date)).reduce((sum, o) => sum + o.amount, 0);

  const purchases = s.bills.filter((b) => inRange(b.date)).reduce((sum, b) => sum + b.total, 0);
  const paid = s.payments.filter((p) => inRange(p.date)).reduce((sum, p) => sum + p.amount, 0);
  const otherInRange = s.others.filter((o) => inRange(o.date)).reduce((sum, o) => sum + o.amount, 0);
  const outstanding = opening + purchases - paid + otherInRange;

  return { opening, purchases, paid, outstanding };
}

export function SuppliersTable({ suppliers }: { suppliers: Supplier[] }) {
  const [search, setSearch] = useState("");
  const [balanceFilter, setBalanceFilter] = useState<"" | "owed" | "settled">("");
  const [typeFilter, setTypeFilter] = useState("");
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [dateFilter, setDateFilter] = useState<DateFilter>({ mode: "all", from: "", to: "" });
  const filtering = Boolean(search || balanceFilter || typeFilter || dateFilter.mode !== "all");

  const rows = useMemo(() => suppliers.map((s) => ({ ...s, ...computePeriod(s, dateFilter) })), [suppliers, dateFilter]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((s) => !q || s.name.toLowerCase().includes(q) || s.phone.toLowerCase().includes(q))
      .filter((s) => (balanceFilter === "owed" ? s.outstanding > 0.005 : balanceFilter === "settled" ? Math.abs(s.outstanding) <= 0.005 : true))
      .filter((s) => (typeFilter === "none" ? !s.businessType : typeFilter ? s.businessType === typeFilter : true))
      .sort((a, b) => {
        const cmp = sortField === "name" ? a.name.localeCompare(b.name) : a.outstanding - b.outstanding;
        return sortDir === "asc" ? cmp : -cmp;
      });
  }, [rows, search, balanceFilter, typeFilter, sortField, sortDir]);

  // The figures add up the suppliers shown below, for the date range chosen.
  const totals = useMemo(
    () => ({
      purchases: filtered.reduce((sum, s) => sum + s.purchases, 0),
      paid: filtered.reduce((sum, s) => sum + s.paid, 0),
      outstanding: filtered.reduce((sum, s) => sum + s.outstanding, 0),
    }),
    [filtered]
  );
  const untyped = suppliers.filter((s) => !s.businessType).length;

  function toggleSort(field: SortField) {
    if (field === sortField) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  }
  const dirOf = (field: SortField) => (field === sortField ? sortDir : null);

  const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2 });

  function clearFilters() {
    setSearch("");
    setBalanceFilter("");
    setTypeFilter("");
    setDateFilter({ mode: "all", from: "", to: "" });
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Suppliers"
        description="Who you owe, and what you have bought and paid."
        primary={
          <SupplierFormModal
            title="Add supplier"
            action={createSupplier}
            trigger={(open) => (
              <Button variant="primary" icon={<Plus size={14} />} onClick={open}>
                Add supplier
              </Button>
            )}
          />
        }
      />

      <StatStrip
        items={[
          { label: "Total purchases", value: fmt(totals.purchases) },
          { label: "Total payment made", value: fmt(totals.paid) },
          { label: "Total outstanding", value: fmt(totals.outstanding), tone: totals.outstanding > 0.005 ? "warning" : "default" },
        ]}
      />

      <FilterBar className="!mb-0">
        <SearchInput value={search} onChange={setSearch} placeholder="Search name or phone" />
        <Select aria-label="Balance" value={balanceFilter} onChange={(e) => setBalanceFilter(e.target.value as "" | "owed" | "settled")} className="w-40">
          <option value="">All suppliers</option>
          <option value="owed">Owed money</option>
          <option value="settled">Settled</option>
        </Select>
        <Select aria-label="Business type" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="w-44">
          <option value="">Any business type</option>
          {PAYEE_TYPES.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
          <option value="none">Not set{untyped > 0 ? ` (${untyped})` : ""}</option>
        </Select>
        <DateRangeControl value={dateFilter} onChange={setDateFilter} />
        {filtering && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Clear filters
          </Button>
        )}
      </FilterBar>

      <DataTable stickyHeader>
        <thead>
          <Tr className="hover:bg-transparent">
            <SortableTh direction={dirOf("name")} onSort={() => toggleSort("name")}>
              Name
            </SortableTh>
            <Th>Business type</Th>
            <Th align="right">Opening</Th>
            <Th align="right">Purchases</Th>
            <Th align="right">Paid</Th>
            <SortableTh align="right" direction={dirOf("outstanding")} onSort={() => toggleSort("outstanding")}>
              Outstanding (AP)
            </SortableTh>
            <Th className="w-24" />
          </Tr>
        </thead>
        <tbody>
          {filtered.map((s) => (
            <Tr key={s.id}>
              <Td className="font-medium">
                <Link href={`/suppliers/${s.id}`} className="hover:underline">
                  {s.name}
                </Link>
              </Td>
              <Td>{s.businessType ? <span className="text-ink-2">{payeeTypeLabel(s.businessType)}</span> : <StatusPill tone="action">Not set</StatusPill>}</Td>
              <Td numeric>
                <Amount value={s.opening} />
              </Td>
              <Td numeric>
                <Amount value={s.purchases} />
              </Td>
              <Td numeric>
                <Amount value={s.paid} />
              </Td>
              <Td numeric className="font-medium">
                <Amount value={s.outstanding} />
              </Td>
              <Td className="whitespace-nowrap text-right">
                <RowActions>
                  <Link href={`/suppliers/${s.id}`} className="text-xs text-accent-text hover:underline">
                    View profile
                  </Link>
                </RowActions>
              </Td>
            </Tr>
          ))}
        </tbody>
      </DataTable>
      {filtered.length === 0 &&
        (suppliers.length === 0 ? (
          <EmptyState icon={Truck} title="No suppliers yet" description="Add a supplier, or record a purchase and add them there." />
        ) : (
          <EmptyState icon={Truck} title="No suppliers match" description="Try a different search, or clear the filters." action={<Button onClick={clearFilters}>Clear filters</Button>} />
        ))}
    </div>
  );
}
