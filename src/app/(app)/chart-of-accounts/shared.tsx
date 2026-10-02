"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deleteAccount } from "./actions";
import { AccountEditModal } from "./account-edit-modal";
import { RowMenu } from "@/components/row-menu";
import { StatusPill } from "@/components/ui/status-pill";
import { ConfirmDialog } from "../sales/confirm-dialog";

export const TYPE_LABEL: Record<string, string> = { asset: "Asset", liability: "Liability", equity: "Equity", income: "Income", expense: "Expense" };

/** A balance signed to the account's normal side; a negative one (the "wrong" side) is shown in red. */
export function Balance({ value }: { value: number }) {
  if (Math.abs(value) < 0.005) return <span className="text-gray-400">0.00</span>;
  return <span className={value < 0 ? "text-red-600" : ""}>{value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>;
}

/** Marks an account that came with the system: other parts of the app rely on it, so it can't be deleted or deactivated. */
export function SystemBadge() {
  return (
    <span title="Built in: other parts of the system rely on this account, so it can't be deleted or deactivated" className="ml-2 align-middle">
      <StatusPill tone="pending">System</StatusPill>
    </span>
  );
}

type RowAccount = {
  id: string;
  name: string;
  isActive: boolean;
  category?: "asset" | "liability" | "equity" | "income" | "expense";
  subCategory?: string | null;
  system: boolean;
};

/**
 * The three-dot menu at the end of an account row: Edit, and Delete — which a built-in (system) account doesn't
 * offer, since other parts of the system rely on it.
 */
export function AccountRowActions({ account, showSubCategory, onError }: { account: RowAccount; showSubCategory: boolean; onError: (message: string) => void }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  async function confirmDelete() {
    setConfirmingDelete(false);
    const r = await deleteAccount(account.id);
    if (!r.ok) onError(r.error);
    else router.refresh();
  }

  return (
    <>
      <RowMenu
        items={[
          { label: "Edit", onClick: () => setEditing(true) },
          { label: "Delete", onClick: () => setConfirmingDelete(true), danger: true, hidden: account.system },
        ]}
      />
      {editing && (
        <AccountEditModal
          defaultOpen
          onClose={() => setEditing(false)}
          initial={{ id: account.id, name: account.name, isActive: account.isActive, category: account.category, subCategory: account.subCategory, system: account.system }}
          showSubCategory={showSubCategory}
        />
      )}
      {confirmingDelete && <ConfirmDialog message={`Delete "${account.name}"? This can't be undone.`} onYes={confirmDelete} onNo={() => setConfirmingDelete(false)} />}
    </>
  );
}
