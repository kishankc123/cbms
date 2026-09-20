"use client";

import { useEffect, useState } from "react";
import { getSalesInvoiceForEdit, type SingleInvoiceEditData } from "./actions";
import { SingleInvoiceForm } from "./single-invoice-form";

type Customer = { id: string; name: string };
type Item = { id: string; name: string; sellingPrice: string };
type CashBankGroup = { id: string; code: string; name: string; children: { id: string; code: string; name: string }[] };

export function EditSingleInvoiceModal({
  invoiceId,
  customers,
  items,
  cashBankAccounts,
  customerBalances,
  vatRate,
  onClose,
}: {
  invoiceId: string;
  customers: Customer[];
  items: Item[];
  cashBankAccounts: CashBankGroup[];
  customerBalances: Record<string, number>;
  vatRate: number;
  onClose: () => void;
}) {
  const [data, setData] = useState<SingleInvoiceEditData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getSalesInvoiceForEdit(invoiceId)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Failed to load invoice");
      });
    return () => {
      cancelled = true;
    };
  }, [invoiceId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto py-8">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      <div className="relative w-full max-w-4xl rounded-lg bg-white p-5 shadow-lg space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Edit invoice</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-600">
            ✕
          </button>
        </div>

        {loadError && <p className="text-sm text-red-600">{loadError}</p>}
        {!data && !loadError && <p className="text-sm text-gray-500">Loading...</p>}

        {data && (
          <SingleInvoiceForm
            customers={customers}
            items={items}
            cashBankAccounts={cashBankAccounts}
            customerBalances={customerBalances}
            vatRate={vatRate}
            initial={{
              invoiceId: data.invoiceId,
              invoiceNumber: data.invoiceNumber,
              invoiceDate: data.invoiceDate,
              dueDate: data.dueDate,
              customerId: data.customerId,
              lines: data.lines,
              payments: data.payments,
            }}
            onDone={onClose}
          />
        )}
      </div>
    </div>
  );
}
