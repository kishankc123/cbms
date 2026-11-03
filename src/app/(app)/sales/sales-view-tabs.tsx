"use client";

import { useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";

const VIEWS = [
  { id: "invoices", label: "Invoices" },
  { id: "new", label: "Add new" },
] as const;
export type SalesView = (typeof VIEWS)[number]["id"];

/** The Sales page's two views — Add new and Invoices — as a switcher, so Sales is a single nav entry. */
export function SalesViewTabs({ initialView, addNew, invoices }: { initialView: SalesView; addNew: ReactNode; invoices: ReactNode }) {
  const [view, setView] = useState<SalesView>(initialView);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Sales"
        description="Record customer sales and review invoices."
        className="!mb-0"
        primary={view === "invoices" ? <Button variant="primary" icon={<Plus size={14} />} onClick={() => setView("new")}>New invoice</Button> : undefined}
      />
      <Tabs items={VIEWS.map((v) => ({ id: v.id, label: v.label }))} value={view} onChange={(id) => setView(id as SalesView)} />
      {/* Both stay mounted so a half-filled invoice survives a peek at the invoice list. */}
      <div hidden={view !== "new"}>{addNew}</div>
      <div hidden={view !== "invoices"}>{invoices}</div>
    </div>
  );
}
