"use client";

import { useState, type ComponentProps } from "react";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import { ExpensesTable } from "./expenses-table";
import { ImportExpenses } from "./import/import-expenses";

// The Expenses page: its header, the list, and Import Expenses beside it (the import is only offered to people who can create
// expenses). "New expense" is the page's one primary action, so it sits in the header and opens the form held by the list.
export function ExpensesWorkspace({ canImport, canCreate, ...table }: { canImport: boolean; canCreate: boolean } & Omit<ComponentProps<typeof ExpensesTable>, "newOpen" | "onNew" | "onNewClose">) {
  const [tab, setTab] = useState<"list" | "import">("list");
  const [newOpen, setNewOpen] = useState(false);

  return (
    <div>
      <PageHeader
        title="Expenses"
        description="What the business spends, by supplier and category."
        primary={tab === "list" && canCreate ? <Button variant="primary" icon={<Plus size={14} />} onClick={() => setNewOpen(true)}>New expense</Button> : undefined}
      />
      {canImport && (
        <Tabs
          className="mb-4"
          value={tab}
          onChange={(id) => setTab(id as "list" | "import")}
          items={[
            { id: "list", label: "Expenses" },
            { id: "import", label: "Import expenses" },
          ]}
        />
      )}
      {tab === "list" ? <ExpensesTable {...table} newOpen={newOpen} onNew={() => setNewOpen(true)} onNewClose={() => setNewOpen(false)} /> : <ImportExpenses />}
    </div>
  );
}
