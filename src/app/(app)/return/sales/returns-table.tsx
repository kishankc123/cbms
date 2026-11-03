"use client";

import { voidSalesReturn } from "./actions";
import { ReturnsList } from "../returns-list";

type Customer = { id: string; name: string };
type Note = { id: string; noteNumber: string; customerId: string; noteDate: string; total: string; status: string };

export function SalesReturnsTable({ noteList, customerById }: { noteList: Note[]; customerById: Record<string, Customer> }) {
  return (
    <ReturnsList
      notes={noteList.map((n) => ({ id: n.id, number: n.noteNumber, partyId: n.customerId, date: n.noteDate, total: n.total, status: n.status }))}
      partyById={customerById}
      partyLabel="Customer"
      noteLabel="Debit note"
      onVoid={(noteId) => {
        const fd = new FormData();
        fd.set("noteId", noteId);
        return voidSalesReturn(fd);
      }}
    />
  );
}
