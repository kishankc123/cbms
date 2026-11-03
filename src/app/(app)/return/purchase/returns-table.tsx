"use client";

import { voidPurchaseReturn } from "./actions";
import { ReturnsList } from "../returns-list";

type Vendor = { id: string; name: string };
type Note = { id: string; noteNumber: string; vendorId: string; noteDate: string; total: string; status: string };

export function PurchaseReturnsTable({ noteList, vendorById }: { noteList: Note[]; vendorById: Record<string, Vendor> }) {
  return (
    <ReturnsList
      notes={noteList.map((n) => ({ id: n.id, number: n.noteNumber, partyId: n.vendorId, date: n.noteDate, total: n.total, status: n.status }))}
      partyById={vendorById}
      partyLabel="Supplier"
      noteLabel="Credit note"
      onVoid={(noteId) => {
        const fd = new FormData();
        fd.set("noteId", noteId);
        return voidPurchaseReturn(fd);
      }}
    />
  );
}
