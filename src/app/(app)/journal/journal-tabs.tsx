"use client";

import { useState } from "react";
import { Tabs } from "@/components/ui/tabs";
import { EntriesList } from "./entries-list";
import { JournalEntryForm } from "./journal-entry-form";

type Account = { id: string; code: string; name: string };

/** Journal Entries as two screens to switch between: the entries already made, and a new one. */
export function JournalTabs({ allAccounts, activeAccounts, nextVoucher, month, canCreate, canReverse }: { allAccounts: Account[]; activeAccounts: Account[]; nextVoucher: string; month: { from: string; to: string }; canCreate: boolean; canReverse: boolean }) {
  const [tab, setTab] = useState("entries");
  const [posted, setPosted] = useState<{ id: string; date: string } | null>(null);

  return (
    <div className="space-y-4">
      <Tabs items={[{ id: "entries", label: "Entries" }, ...(canCreate ? [{ id: "new", label: "New entry" }] : [])]} value={tab} onChange={setTab} />
      {tab === "entries" && <EntriesList accounts={allAccounts} month={month} opened={posted} canReverse={canReverse} />}
      {tab === "new" && canCreate && (
        <JournalEntryForm
          accounts={activeAccounts}
          nextVoucher={nextVoucher}
          onPosted={(entry) => {
            // Back to the list, with the new entry opened.
            setPosted(entry);
            setTab("entries");
          }}
        />
      )}
    </div>
  );
}
