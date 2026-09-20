"use client";

import { useState } from "react";
import { QuickSelect } from "./quick-select";
import { CustomerFormModal } from "@/app/(app)/customers/customer-form-modal";
import { SupplierFormModal } from "@/app/(app)/suppliers/supplier-form-modal";
import { createCustomer } from "@/app/(app)/customers/actions";
import { createSupplier } from "@/app/(app)/suppliers/actions";
import { ItemAddForm } from "@/app/(app)/inventory/items/item-add-form";
import { getItemFormOptions, type CreatedItem } from "@/app/(app)/inventory/items/actions";

type Option = { id: string; name: string };
type Common = { value: string; options: Option[]; onChange: (id: string) => void; className?: string; disabled?: boolean };

/** Customer dropdown with "+ Add new" inside the list: opens the normal new-customer form and selects the saved customer. */
export function CustomerSelect({ onAdded, ...rest }: Common & { onAdded: (c: Option) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <QuickSelect {...rest} placeholder="Select customer" onAddNew={() => setOpen(true)} />
      <CustomerFormModal
        open={open}
        onOpenChange={setOpen}
        title="Add customer"
        action={createCustomer}
        onCreated={(c) => {
          onAdded(c);
          rest.onChange(c.id);
        }}
      />
    </>
  );
}

/** Supplier dropdown with "+ Add new" inside the list. */
export function SupplierSelect({ onAdded, ...rest }: Common & { onAdded: (s: Option) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <QuickSelect {...rest} placeholder="Select supplier" onAddNew={() => setOpen(true)} />
      <SupplierFormModal
        open={open}
        onOpenChange={setOpen}
        title="Add supplier"
        action={createSupplier}
        onCreated={(s) => {
          onAdded(s);
          rest.onChange(s.id);
        }}
      />
    </>
  );
}

type ItemOptions = Awaited<ReturnType<typeof getItemFormOptions>>;

/**
 * Product dropdown with "+ Add new" inside the list. `onAdded` gets the full saved item (with its prices)
 * so the form can fill the rate; the new item is then selected.
 */
export function ItemSelect({ onAdded, placeholder, ...rest }: Common & { onAdded: (item: CreatedItem) => void; placeholder: string }) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<ItemOptions | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function show() {
    setOpen(true);
    if (options) return;
    try {
      setOptions(await getItemFormOptions());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the item form");
    }
  }

  return (
    <>
      <QuickSelect {...rest} placeholder={placeholder} onAddNew={show} />
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto py-8">
          <div className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} />
          <div className="relative w-full max-w-xl rounded-lg bg-white p-5 shadow-lg space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900">Add item</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="text-gray-400 hover:text-gray-600">
                ✕
              </button>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            {!options && !error && <p className="text-sm text-gray-500">Loading...</p>}
            {options && (
              <ItemAddForm
                embedded
                units={options.units}
                groups={options.groups}
                categories={options.categories}
                onCreated={(item) => {
                  setOpen(false);
                  onAdded(item);
                }}
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}
