"use client";

import { useState } from "react";
import { InvoiceForm } from "./invoice-form";
import { SingleInvoiceForm } from "./single-invoice-form";

type Customer = { id: string; name: string };
type Item = { id: string; name: string; sellingPrice: string };
type CashBankGroup = { id: string; code: string; name: string; children: { id: string; code: string; name: string }[] };
type InvoiceNumbering = { prefix: string; suffix: string; format: string; nextSequence: number };

const TABS = [
  { id: "multi", label: "Multi-invoice" },
  { id: "single", label: "Single invoice" },
  { id: "import", label: "Import sales" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function SalesEntryTabs({
  customers,
  items,
  vatRate,
  cashBankAccounts,
  customerBalances,
  invoiceNumbering,
}: {
  customers: Customer[];
  items: Item[];
  vatRate: number;
  cashBankAccounts: CashBankGroup[];
  customerBalances: Record<string, number>;
  invoiceNumbering: InvoiceNumbering;
}) {
  const [tab, setTab] = useState<TabId>("multi");

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-full bg-gray-100 p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-full px-4 py-1.5 text-sm transition-colors ${
              tab === t.id
                ? "bg-white text-gray-900 font-medium shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "multi" && (
        <InvoiceForm
          customers={customers}
          vatRate={vatRate}
          cashBankAccounts={cashBankAccounts}
          customerBalances={customerBalances}
          invoiceNumbering={invoiceNumbering}
        />
      )}

      {tab === "single" && (
        <SingleInvoiceForm
          customers={customers}
          items={items}
          cashBankAccounts={cashBankAccounts}
          customerBalances={customerBalances}
          vatRate={vatRate}
        />
      )}

      {tab === "import" && (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
          Importing sales from a file is coming soon.
        </div>
      )}
    </div>
  );
}
