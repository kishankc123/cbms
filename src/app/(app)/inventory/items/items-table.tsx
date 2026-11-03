"use client";

import { useMemo, useState } from "react";
import { useProblem } from "@/components/problem-dialog";
import { useRouter } from "next/navigation";
import { deleteItem, setItemActive, type BillingType, type ItemType } from "./actions";
import { EditItemModal } from "./edit-item-modal";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Boxes } from "lucide-react";
import { RowMenu } from "@/components/row-menu";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { Amount, DataTable, RowActions, SortableTh, Td, Th, Tr } from "@/components/ui/data-table";
import { FilterBar, SearchInput } from "@/components/ui/filters";
import { StatStrip } from "@/components/ui/stat-strip";
import { StatusPill } from "@/components/ui/status-pill";
import { EmptyState } from "@/components/ui/empty-state";

type Unit = { id: string; name: string };
type Group = { id: string; name: string };
type Category = { id: string; name: string; groupId: string };
type Account = { id: string; code: string; name: string };
type Item = {
  id: string;
  name: string;
  unitId: string | null;
  categoryId: string | null;
  purchasePrice: string;
  sellingPrice: string;
  isActive: boolean;
  inventoryTracking: boolean;
  billingType: BillingType;
  revenueAccountId: string | null;
  stockQuantity: string;
  stockValue: string;
};

const BILLING_TYPE_LABEL: Record<BillingType, string> = { one_time: "One-time", recurring: "Recurring", subscription: "Subscription", usage_based: "Usage-based" };

type SortKey = "name" | "category";

export function ItemsTable({
  itemType = "product",
  rateLabel = "Selling price",
  items,
  units,
  groups = [],
  categories = [],
  accounts = [],
}: {
  itemType?: ItemType;
  rateLabel?: string;
  items: Item[];
  units: Unit[];
  groups?: Group[];
  categories?: Category[];
  accounts?: Account[];
}) {
  const isProduct = itemType === "product";
  const router = useRouter();
  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [stateFilter, setStateFilter] = useState<"" | "active" | "inactive">("");
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [editingId, setEditingId] = useState<string | null>(null);
  // Problems are shown in a dialog that says why.
  const { report, dialog } = useProblem();

  function toggleSort(key: SortKey) {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir("asc");
    } else {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = items.filter((it) => (!q || it.name.toLowerCase().includes(q)) && (!categoryFilter || it.categoryId === categoryFilter) && (stateFilter === "active" ? it.isActive : stateFilter === "inactive" ? !it.isActive : true));

    if (sortKey) {
      rows = [...rows].sort((a, b) => {
        const av = sortKey === "category" ? categoryById.get(a.categoryId ?? "")?.name ?? "" : a.name;
        const bv = sortKey === "category" ? categoryById.get(b.categoryId ?? "")?.name ?? "" : b.name;
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return sortDir === "asc" ? cmp : -cmp;
      });
    }

    return rows;
  }, [items, search, categoryFilter, stateFilter, categoryById, sortKey, sortDir]);

  const dirOf = (key: SortKey) => (sortKey === key ? sortDir : null);
  const filtering = Boolean(search || categoryFilter || stateFilter);
  function clearFilters() {
    setSearch("");
    setCategoryFilter("");
    setStateFilter("");
  }
  const activeCount = items.filter((it) => it.isActive).length;
  const stockValue = items.filter((it) => it.isActive).reduce((sum, it) => sum + Number(it.stockValue), 0);

  async function handleActive(id: string, isActive: boolean) {
    try {
      await setItemActive({ itemId: id, isActive });
      router.refresh();
    } catch (e) {
      report(e instanceof Error ? e.message : "Failed to update", null);
    }
  }

  const ask = useConfirm();
  async function handleDelete(id: string, name: string) {
    if (!(await ask(`Delete item ${name}?`, { confirmLabel: "Delete", danger: true }))) return;
    try {
      await deleteItem({ itemId: id });
      router.refresh();
    } catch (e) {
      report(e instanceof Error ? e.message : "Failed to delete", null);
    }
  }

  return (
    <div className="space-y-4">
      <StatStrip
        items={[
          { label: "Items", value: items.length },
          { label: "Active", value: activeCount },
          { label: "Inactive", value: items.length - activeCount },
          ...(isProduct ? [{ label: "Stock value", value: <Amount value={stockValue} /> }] : []),
        ]}
      />

      <FilterBar className="!mb-0">
        <SearchInput value={search} onChange={setSearch} placeholder="Search items" />
        {isProduct && categories.length > 0 && (
          <Select aria-label="Category" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="w-44">
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        )}
        <Select aria-label="Status" value={stateFilter} onChange={(e) => setStateFilter(e.target.value as "" | "active" | "inactive")} className="w-36">
          <option value="">All items</option>
          <option value="active">Active</option>
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
            <Th className="w-10">#</Th>
            <SortableTh direction={dirOf("name")} onSort={() => toggleSort("name")}>
              Item
            </SortableTh>
            {isProduct && (
              <SortableTh direction={dirOf("category")} onSort={() => toggleSort("category")}>
                Category
              </SortableTh>
            )}
            {isProduct ? (
              <>
                <Th align="right">On hand</Th>
                <Th align="right">Stock value</Th>
              </>
            ) : (
              <Th align="right">{rateLabel}</Th>
            )}
            <Th className="w-10" />
          </Tr>
        </thead>
        <tbody>
          {filtered.map((it, i) => (
            <Tr key={it.id}>
              <Td className="text-ink-2">{i + 1}</Td>
              <Td>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={it.isActive ? "" : "text-ink-2"}>{it.name}</span>
                  {!it.isActive && <StatusPill tone="neutral">Inactive</StatusPill>}
                  {isProduct && !it.inventoryTracking && <StatusPill tone="neutral">Not tracked</StatusPill>}
                  {it.billingType !== "one_time" && <StatusPill tone="neutral">{BILLING_TYPE_LABEL[it.billingType]}</StatusPill>}
                </div>
                {it.revenueAccountId && <p className="text-xs text-ink-2">→ {accountById.get(it.revenueAccountId)?.name ?? "Revenue account"}</p>}
              </Td>
              {isProduct && <Td className="text-ink-2">{categoryById.get(it.categoryId ?? "")?.name ?? "—"}</Td>}
              {isProduct ? (
                <>
                  <Td numeric>{Number(it.stockQuantity)}</Td>
                  <Td numeric>
                    <Amount value={Number(it.stockValue)} />
                  </Td>
                </>
              ) : (
                <Td numeric>
                  <Amount value={Number(it.sellingPrice)} />
                </Td>
              )}
              <Td className="whitespace-nowrap">
                <RowActions>
                  <RowMenu
                    items={[
                      { label: "Edit", onClick: () => setEditingId(it.id) },
                      { label: it.isActive ? "Make inactive" : "Make active", onClick: () => handleActive(it.id, !it.isActive) },
                      { label: "Delete", onClick: () => handleDelete(it.id, it.name), danger: true },
                    ]}
                  />
                </RowActions>
              </Td>
            </Tr>
          ))}
        </tbody>
      </DataTable>
      {filtered.length === 0 &&
        (items.length === 0 ? (
          <EmptyState icon={Boxes} title="No items yet" description="Add an item from the Add new tab and it will be listed here." />
        ) : (
          <EmptyState icon={Boxes} title="No items match" description="Try a different search, or clear the filters." action={<Button onClick={clearFilters}>Clear filters</Button>} />
        ))}

      {editingId && (
        <EditItemModal
          itemType={itemType}
          rateLabel={rateLabel}
          item={items.find((it) => it.id === editingId)!}
          units={units}
          groups={groups}
          categories={categories}
          accounts={accounts}
          onClose={() => setEditingId(null)}
        />
      )}
      {dialog}
    </div>
  );
}
