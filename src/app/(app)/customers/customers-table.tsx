"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Users } from "lucide-react";
import { createCustomer } from "./actions";
import { CustomerFormModal } from "./customer-form-modal";
import { DateRangeControl, type DateFilter } from "./date-range-control";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { Amount, DataTable, RowActions, SortableTh, Td, Th, Tr } from "@/components/ui/data-table";
import { FilterBar, SearchInput } from "@/components/ui/filters";
import { StatStrip } from "@/components/ui/stat-strip";
import { EmptyState } from "@/components/ui/empty-state";

type Customer = {
  id: string;
  name: string;
  phone: string;
  details: string;
  openingBalance: number;
  /** The opening balance as the ledger has it (what the balance builds on). */
  ledgerOpening: number;
  /** Other entries posted to the customer's account (manual vouchers...), signed to the balance. */
  others: { date: string; amount: number }[];
  invoices: { date: string; total: number }[];
  receipts: { date: string; amount: number }[];
};

type SortField = "name" | "outstanding";

function computePeriod(c: Customer, filter: DateFilter) {
  const isBeforeFrom = (date: string) => filter.mode === "range" && !!filter.from && date < filter.from;
  const inRange = (date: string) => {
    if (filter.mode === "all") return true;
    if (filter.from && date < filter.from) return false;
    if (filter.to && date > filter.to) return false;
    return true;
  };

  const opening =
    c.ledgerOpening +
    c.invoices.filter((i) => isBeforeFrom(i.date)).reduce((s, i) => s + i.total, 0) -
    c.receipts.filter((r) => isBeforeFrom(r.date)).reduce((s, r) => s + r.amount, 0) +
    c.others.filter((o) => isBeforeFrom(o.date)).reduce((s, o) => s + o.amount, 0);

  const sales = c.invoices.filter((i) => inRange(i.date)).reduce((s, i) => s + i.total, 0);
  const paid = c.receipts.filter((r) => inRange(r.date)).reduce((s, r) => s + r.amount, 0);
  const otherInRange = c.others.filter((o) => inRange(o.date)).reduce((s, o) => s + o.amount, 0);
  const outstanding = opening + sales - paid + otherInRange;

  return { opening, sales, paid, outstanding };
}

export function CustomersTable({ customers }: { customers: Customer[] }) {
  const [search, setSearch] = useState("");
  const [balanceFilter, setBalanceFilter] = useState<"" | "owing" | "settled">("");
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [dateFilter, setDateFilter] = useState<DateFilter>({ mode: "all", from: "", to: "" });
  const filtering = Boolean(search || balanceFilter || dateFilter.mode !== "all");

  const rows = useMemo(() => customers.map((c) => ({ ...c, ...computePeriod(c, dateFilter) })), [customers, dateFilter]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((c) => !q || c.name.toLowerCase().includes(q) || c.phone.toLowerCase().includes(q))
      .filter((c) => (balanceFilter === "owing" ? c.outstanding > 0.005 : balanceFilter === "settled" ? Math.abs(c.outstanding) <= 0.005 : true))
      .sort((a, b) => {
        const cmp = sortField === "name" ? a.name.localeCompare(b.name) : a.outstanding - b.outstanding;
        return sortDir === "asc" ? cmp : -cmp;
      });
  }, [rows, search, balanceFilter, sortField, sortDir]);

  // The figures add up the customers shown below, for the date range chosen.
  const totals = useMemo(
    () => ({
      sales: filtered.reduce((s, c) => s + c.sales, 0),
      paid: filtered.reduce((s, c) => s + c.paid, 0),
      outstanding: filtered.reduce((s, c) => s + c.outstanding, 0),
    }),
    [filtered]
  );

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
    setDateFilter({ mode: "all", from: "", to: "" });
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Customers"
        description="Who owes you, and what they have bought and paid."
        primary={
          <CustomerFormModal
            title="Add customer"
            action={createCustomer}
            trigger={(open) => (
              <Button variant="primary" icon={<Plus size={14} />} onClick={open}>
                Add customer
              </Button>
            )}
          />
        }
      />

      <StatStrip
        items={[
          { label: "Total sales", value: fmt(totals.sales) },
          { label: "Total payment received", value: fmt(totals.paid) },
          { label: "Total outstanding", value: fmt(totals.outstanding), tone: totals.outstanding > 0.005 ? "warning" : "default" },
        ]}
      />

      <FilterBar className="!mb-0">
        <SearchInput value={search} onChange={setSearch} placeholder="Search name or phone" />
        <Select aria-label="Balance" value={balanceFilter} onChange={(e) => setBalanceFilter(e.target.value as "" | "owing" | "settled")} className="w-40">
          <option value="">All customers</option>
          <option value="owing">Owing money</option>
          <option value="settled">Settled</option>
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
            <Th align="right">Opening</Th>
            <Th align="right">Sales</Th>
            <Th align="right">Paid</Th>
            <SortableTh align="right" direction={dirOf("outstanding")} onSort={() => toggleSort("outstanding")}>
              Outstanding (AR)
            </SortableTh>
            <Th className="w-24" />
          </Tr>
        </thead>
        <tbody>
          {filtered.map((c) => (
            <Tr key={c.id}>
              <Td className="font-medium">
                <Link href={`/customers/${c.id}`} className="hover:underline">
                  {c.name}
                </Link>
              </Td>
              <Td numeric>
                <Amount value={c.opening} />
              </Td>
              <Td numeric>
                <Amount value={c.sales} />
              </Td>
              <Td numeric>
                <Amount value={c.paid} />
              </Td>
              <Td numeric className="font-medium">
                <Amount value={c.outstanding} />
              </Td>
              <Td className="whitespace-nowrap text-right">
                <RowActions>
                  <Link href={`/customers/${c.id}`} className="text-xs text-accent-text hover:underline">
                    View profile
                  </Link>
                </RowActions>
              </Td>
            </Tr>
          ))}
        </tbody>
      </DataTable>
      {filtered.length === 0 &&
        (customers.length === 0 ? (
          <EmptyState icon={Users} title="No customers yet" description="Add a customer, or record a sale and add them there." />
        ) : (
          <EmptyState icon={Users} title="No customers match" description="Try a different search, or clear the filters." action={<Button onClick={clearFilters}>Clear filters</Button>} />
        ))}
    </div>
  );
}
