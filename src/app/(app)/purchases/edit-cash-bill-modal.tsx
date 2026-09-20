"use client";

import { useEffect, useState } from "react";
import { getCashPurchaseForEdit, type CashPurchaseEditData } from "./actions";
import { ConsumablePurchaseForm } from "./consumable-purchase-form";

type Vendor = { id: string; name: string };
type Account = { id: string; code: string; name: string };
type CashBankGroup = { id: string; code: string; name: string; children: { id: string; code: string; name: string }[] };

// Editing a consumable bill uses the same form as adding one, filled in with the bill.
export function EditCashBillModal({
  billId,
  vendors,
  categoryAccounts,
  cashBankAccounts,
  vatRate,
  onClose,
}: {
  billId: string;
  vendors: Vendor[];
  categoryAccounts: Account[];
  cashBankAccounts: CashBankGroup[];
  vatRate: number;
  onClose: () => void;
}) {
  const [data, setData] = useState<CashPurchaseEditData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCashPurchaseForEdit(billId)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Failed to load bill");
      });
    return () => {
      cancelled = true;
    };
  }, [billId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto py-8">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      <div className="relative w-full max-w-5xl space-y-4 rounded-lg bg-white p-5 shadow-lg">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Edit consumable purchase</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-600">
            ✕
          </button>
        </div>

        {loadError && <p className="text-sm text-red-600">{loadError}</p>}
        {!data && !loadError && <p className="text-sm text-gray-500">Loading...</p>}

        {data && (
          <ConsumablePurchaseForm
            vendors={vendors}
            categoryAccounts={categoryAccounts}
            cashBankAccounts={cashBankAccounts}
            vatRate={vatRate}
            initial={{
              billId: data.billId,
              billNumber: data.billNumber,
              billDate: data.billDate,
              vendorId: data.vendorId ?? "",
              billType: data.billType,
              billAvailable: data.billAvailable,
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
