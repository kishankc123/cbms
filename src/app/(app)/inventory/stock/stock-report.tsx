"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Boxes } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { Amount, DataTable, RowActions, SortableTh, Td, Th, Tr } from "@/components/ui/data-table";
import { FilterBar, SearchInput } from "@/components/ui/filters";
import { StatStrip } from "@/components/ui/stat-strip";
import { StatusPill } from "@/components/ui/status-pill";
import { EmptyState } from "@/components/ui/empty-state";

export type StockRow = { id: string; name: string; unit: string; isActive: boolean; quantity: number; averageCost: number; value: number };

type SortKey = "name" | "quantity" | "value";

const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// What is on hand: the figures that tie stock to the Inventory account, then one row per item.
export function StockReport({ rows, stockValue, ledger, difference }: { rows: StockRow[]; stockValue: number; ledger: number; difference: number }) {
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const balanced = Math.abs(difference) < 0.005;
  const filtering = Boolean(search || stateFilter);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = rows.filter((r) => {
      if (q && !r.name.toLowerCase().includes(q)) return false;
      if (stateFilter === "inactive") return !r.isActive;
      if (stateFilter === "negative") return r.quantity < 0;
      if (stateFilter === "novalue") return r.quantity === 0 && r.value !== 0;
      if (stateFilter === "instock") return r.quantity > 0;
      return true;
    });
    if (sortKey) {
      list = [...list].sort((a, b) => {
        const cmp = sortKey === "name" ? a.name.localeCompare(b.name) : sortKey === "quantity" ? a.quantity - b.quantity : a.value - b.value;
        return sortDir === "asc" ? cmp : -cmp;
      });
    }
    return list;
  }, [rows, search, stateFilter, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir("asc");
    } else setSortDir((d) => (d === "asc" ? "desc" : "asc"));
  }
  const dirOf = (key: SortKey) => (sortKey === key ? sortDir : null);
  function clearFilters() {
    setSearch("");
    setStateFilter("");
  }

  return (
    <div className="space-y-4">
      <StatStrip
        items={[
          { label: "Stock value (all items)", value: fmt(stockValue) },
          { label: "Inventory account (ledger)", value: fmt(ledger) },
          {
            label: "Difference",
            tone: balanced ? "default" : "danger",
            value: (
              <span className="flex items-center gap-2">
                {fmt(difference)}
                <StatusPill tone={balanced ? "success" : "critical"}>{balanced ? "Matches" : "Needs attention"}</StatusPill>
              </span>
            ),
          },
        ]}
      />
      {!balanced && <p className="text-xs text-ink-2">Inventory holds value no item accounts for (or the reverse). Post a stock adjustment or correct the entry behind it.</p>}

      <FilterBar className="!mb-0">
        <SearchInput value={search} onChange={setSearch} placeholder="Search items" />
        <Select aria-label="Stock state" value={stateFilter} onChange={(e) => setStateFilter(e.target.value)} className="w-48">
          <option value="">All items</option>
          <option value="instock">In stock</option>
          <option value="negative">Negative stock</option>
          <option value="novalue">Value with no stock</option>
          <option value="inactive">Inactive</option>
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
            <SortableTh direction={dirOf("name")} onSort={() => toggleSort("name")}>
              Item
            </SortableTh>
            <Th>Unit</Th>
            <SortableTh align="right" direction={dirOf("quantity")} onSort={() => toggleSort("quantity")}>
              On hand
            </SortableTh>
            <Th align="right">Average cost</Th>
            <SortableTh align="right" direction={dirOf("value")} onSort={() => toggleSort("value")}>
              Value
            </SortableTh>
            <Th className="w-24" />
          </Tr>
        </thead>
        <tbody>
          {shown.map((i) => (
            <Tr key={i.id}>
              <Td>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={i.isActive ? "" : "text-ink-2"}>{i.name}</span>
                  {!i.isActive && <StatusPill tone="neutral">Inactive</StatusPill>}
                  {i.quantity < 0 && <StatusPill tone="critical">Negative stock</StatusPill>}
                  {i.quantity === 0 && i.value !== 0 && <StatusPill tone="pending">Value with no stock</StatusPill>}
                </div>
              </Td>
              <Td className="text-ink-2">{i.unit}</Td>
              <Td numeric>{i.quantity}</Td>
              <Td numeric>
                <Amount value={i.averageCost} />
              </Td>
              <Td numeric className="font-medium">
                <Amount value={i.value} />
              </Td>
              <Td className="whitespace-nowrap text-right">
                <RowActions>
                  <Link href={`/inventory/stock/${i.id}`} className="text-xs text-accent-text hover:underline">
                    Stock card
                  </Link>
                </RowActions>
              </Td>
            </Tr>
          ))}
        </tbody>
      </DataTable>
      {shown.length === 0 &&
        (rows.length === 0 ? (
          <EmptyState icon={Boxes} title="No stock yet" description="Stock appears once you enter opening stock or record a stockable purchase." />
        ) : (
          <EmptyState icon={Boxes} title="No items match" description="Try a different search, or clear the filters." action={<Button onClick={clearFilters}>Clear filters</Button>} />
        ))}
    </div>
  );
}
