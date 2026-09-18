"use client";

import { deleteItem } from "./actions";

export function DeleteItemButton({ itemId, name }: { itemId: string; name: string }) {
  return (
    <form
      action={deleteItem}
      onSubmit={(e) => {
        if (!confirm(`Delete item ${name}?`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="itemId" value={itemId} />
      <button type="submit" className="text-red-600 hover:underline text-xs">
        Delete
      </button>
    </form>
  );
}
