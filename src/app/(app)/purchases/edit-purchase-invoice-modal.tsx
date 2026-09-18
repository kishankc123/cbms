"use client";

import { useEffect, useState } from "react";
import { getPurchaseInvoiceForEdit, type PurchaseInvoiceEditData } from "./actions";
import { PurchaseInvoiceForm } from "./purchase-invoice-form";

type Vendor = { id: string; name: string };
type Item = { id: string; name: string; unit: string | null; defaultRate: string };
type CashBankGroup = { id: string; code: string; name: string; children: { id: string; code: string; name: string }[] };

export function EditPurchaseInvoiceModal({
  billId,
  vendors,
  items,
  cashBankAccounts,
  vatRate,
  onClose,
}: {
  billId: string;
  vendors: Vendor[];
  items: Item[];
  cashBankAccounts: CashBankGroup[];
  vatRate: number;
  onClose: () => void;
}) {
  const [data, setData] = useState<PurchaseInvoiceEditData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getPurchaseInvoiceForEdit(billId)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Failed to load invoice");
      });
    return () => {
      cancelled = true;
    };
  }, [billId]);

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
          <PurchaseInvoiceForm
            vendors={vendors}
            items={items}
            cashBankAccounts={cashBankAccounts}
            vatRate={vatRate}
            initial={{
              billId: data.billId,
              invoiceNumber: data.invoiceNumber,
              invoiceDate: data.invoiceDate,
              vendorId: data.vendorId,
              billType: data.billType,
              lines: data.lineItems,
              payments: data.payments,
            }}
            onDone={onClose}
          />
        )}
      </div>
    </div>
  );
}
