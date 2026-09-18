"use client";

import { useState } from "react";
import { InvoiceForm } from "./invoice-form";

type Customer = { id: string; name: string };
type CashBankGroup = { id: string; code: string; name: string; children: { id: string; code: string; name: string }[] };
type InvoiceNumbering = { prefix: string; suffix: string; format: string; nextSequence: number };

const TABS = [
  { id: "invoice", label: "Invoice-wise" },
  { id: "daily", label: "Total daily" },
  { id: "import", label: "Import sales" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function SalesEntryTabs({
  customers,
  vatRate,
  cashBankAccounts,
  customerBalances,
  invoiceNumbering,
}: {
  customers: Customer[];
  vatRate: number;
  cashBankAccounts: CashBankGroup[];
  customerBalances: Record<string, number>;
  invoiceNumbering: InvoiceNumbering;
}) {
  const [tab, setTab] = useState<TabId>("invoice");

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

      {tab === "invoice" && (
        <InvoiceForm
          customers={customers}
          vatRate={vatRate}
          cashBankAccounts={cashBankAccounts}
          customerBalances={customerBalances}
          invoiceNumbering={invoiceNumbering}
        />
      )}

      {tab === "daily" && (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
          Recording a single total for the day's sales is coming soon.
        </div>
      )}

      {tab === "import" && (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
          Importing sales from a file is coming soon.
        </div>
      )}
    </div>
  );
}
