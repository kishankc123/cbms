"use client";

import { useState } from "react";
import { FileText, Plus, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs } from "@/components/ui/tabs";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { Skeleton, TableSkeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Amount, DataTable, RowActions, SortableTh, Td, Th, Tr } from "@/components/ui/data-table";
import { FilterBar, FilterChip, SearchInput } from "@/components/ui/filters";
import { StatusPill } from "@/components/ui/status-pill";
import { useConfirm } from "@/components/ui/confirm-dialog";

const ROWS = [
  { no: "EXP-0001", party: "Landlord ABC", date: "02-06-2083", amount: 100000, balance: 0, status: "Paid" },
  { no: "EXP-0002", party: "ZZ Test Landlord", date: "25-05-2083", amount: 1000, balance: 1000, status: "Unpaid" },
  { no: "EXP-0003", party: "Himal Traders", date: "27-05-2083", amount: -200, balance: -200, status: "Overdue" },
  { no: "EXP-0004", party: "Everest Stationery", date: "29-05-2083", amount: 12450.5, balance: 4450.5, status: "Partial" },
];
const TONE = { Paid: "success", Unpaid: "action", Overdue: "critical", Partial: "pending" } as const;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 border-t border-line pt-5">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      {children}
    </section>
  );
}

export function DesignSystemDemo() {
  const toast = useToast();
  const ask = useConfirm();
  const [tab, setTab] = useState("all");
  const [search, setSearch] = useState("");
  const [chip, setChip] = useState(true);
  const [sort, setSort] = useState<"asc" | "desc">("asc");
  const [modal, setModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState("EXP-0002");

  const rows = ROWS.filter((r) => `${r.no} ${r.party}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => (sort === "asc" ? a.amount - b.amount : b.amount - a.amount));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Design system"
        description="Every shared component, in the current theme. Switch the theme from the top bar to check both."
        breadcrumbs={[{ label: "Settings", href: "/settings" }, { label: "Design system" }]}
        actions={<Button icon={<Download size={14} />}>Export</Button>}
        primary={<Button variant="primary" icon={<Plus size={14} />}>New expense</Button>}
      />

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary">Primary</Button>
          <Button>Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Delete</Button>
          <Button variant="primary" loading>
            Saving
          </Button>
          <Button disabled>Disabled</Button>
          <Button size="sm">Small</Button>
          <Button size="sm" variant="primary">
            Small primary
          </Button>
        </div>
      </Section>

      <Section title="Tabs, search and filters">
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { id: "all", label: "All", count: ROWS.length },
            { id: "unpaid", label: "Unpaid", count: 2 },
            { id: "paid", label: "Paid" },
          ]}
        />
        <FilterBar>
          <SearchInput value={search} onChange={setSearch} placeholder="Search supplier or number" />
          <Select className="w-40" defaultValue="all" aria-label="Status">
            <option value="all">All statuses</option>
            <option>Paid</option>
            <option>Unpaid</option>
          </Select>
          {chip && <FilterChip label="Category: Rent" onRemove={() => setChip(false)} />}
        </FilterBar>
      </Section>

      <Section title="Accounting table">
        <DataTable stickyHeader>
          <thead>
            <Tr>
              <Th>Number</Th>
              <Th>Supplier</Th>
              <Th>Date</Th>
              <SortableTh align="right" direction={sort} onSort={() => setSort(sort === "asc" ? "desc" : "asc")}>
                Amount
              </SortableTh>
              <Th align="right">Balance</Th>
              <Th>Status</Th>
              <Th className="w-10" />
            </Tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Tr key={r.no} clickable selected={selected === r.no} onClick={() => setSelected(r.no)}>
                <Td className="font-mono text-xs">{r.no}</Td>
                <Td>{r.party}</Td>
                <Td className="text-ink-2">{r.date}</Td>
                <Td numeric>
                  <Amount value={r.amount} />
                </Td>
                <Td numeric>
                  <Amount value={r.balance} side={r.balance === 0 ? undefined : "cr"} />
                </Td>
                <Td>
                  <StatusPill tone={TONE[r.status as keyof typeof TONE]}>{r.status}</StatusPill>
                </Td>
                <Td>
                  <RowActions>
                    <Button size="sm" variant="ghost">
                      View
                    </Button>
                  </RowActions>
                </Td>
              </Tr>
            ))}
          </tbody>
        </DataTable>
        {rows.length === 0 && <EmptyState icon={FileText} title="No expenses match" description="Try a different search, or clear the filters." action={<Button onClick={() => setSearch("")}>Clear search</Button>} />}
      </Section>

      <Section title="Status badges">
        <div className="flex flex-wrap gap-2">
          <StatusPill tone="success">Paid</StatusPill>
          <StatusPill tone="pending">Partially paid</StatusPill>
          <StatusPill tone="action">Action required</StatusPill>
          <StatusPill tone="critical">Overdue</StatusPill>
          <StatusPill tone="neutral">Draft</StatusPill>
        </div>
      </Section>

      <Section title="Form controls">
        <div className="grid max-w-3xl gap-3 sm:grid-cols-3">
          <Field label="Supplier" required>
            <Input placeholder="Search supplier" />
          </Field>
          <Field label="Amount" hint="VAT is added on top.">
            <Input type="number" defaultValue="1250.00" className="text-right" />
          </Field>
          <Field label="Category" error="Choose a category.">
            <Select invalid defaultValue="">
              <option value="">Select category</option>
            </Select>
          </Field>
          <Field label="Reference (disabled)">
            <Input disabled defaultValue="Auto-generated" />
          </Field>
          <Field label="Notes" className="sm:col-span-2">
            <Textarea placeholder="Internal notes" />
          </Field>
        </div>
      </Section>

      <Section title="Dialogs, confirmation and toasts">
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setModal(true)}>Open dialog</Button>
          <Button variant="danger" onClick={async () => (await ask("Delete this expense? This cannot be undone.", { danger: true, confirmLabel: "Delete" })) && toast.success("Expense deleted")}>
            Confirm a delete
          </Button>
          <Button onClick={() => toast.success("Payment recorded")}>Success toast</Button>
          <Button onClick={() => toast.error("The payment date is in a closed period.")}>Error toast</Button>
          <Button onClick={() => toast.info("Bank statement uploaded.")}>Info toast</Button>
        </div>
      </Section>

      <Section title="Loading and empty states">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Skeleton className="h-4 w-40" />
            <TableSkeleton rows={4} cols={4} />
          </div>
          <EmptyState icon={FileText} title="No payments yet" description="Payments you record will appear here." action={<Button variant="primary" icon={<Plus size={14} />}>New payment</Button>} />
        </div>
      </Section>

      {modal && (
        <Modal
          title="New expense"
          description="Record something the business paid for."
          onClose={() => setModal(false)}
          dismissible={!saving}
          footer={
            <>
              <Button onClick={() => setModal(false)} disabled={saving}>
                Cancel
              </Button>
              <Button
                variant="primary"
                loading={saving}
                onClick={() => {
                  setSaving(true);
                  setTimeout(() => {
                    setSaving(false);
                    setModal(false);
                    toast.success("Expense saved");
                  }, 900);
                }}
              >
                Save
              </Button>
            </>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Supplier">
              <Input autoFocus />
            </Field>
            <Field label="Amount">
              <Input type="number" className="text-right" />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
