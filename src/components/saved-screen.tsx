"use client";

import type { ReactNode } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";

export type SavedRow = { label: string; value: ReactNode };

/**
 * What a screen shows after a new record is saved: what was recorded, and ways to carry on, so a day's entries can be keyed one
 * after another. "Add another, same date" has the cursor, so Enter repeats the entry. Shared by Expenses and Purchases.
 */
export function SavedScreen({
  title,
  number,
  noun,
  rows,
  warnings = [],
  onDone,
  onAnother,
  onSameDate,
}: {
  title: string;
  /** The number the record was given (EXP-0062, a bill number). */
  number: string;
  /** What was recorded, for the headline: "was recorded." */
  noun?: string;
  rows: SavedRow[];
  warnings?: string[];
  onDone: () => void;
  onAnother: () => void;
  onSameDate: () => void;
}) {
  return (
    <Modal
      size="sm"
      title={title}
      onClose={onDone}
      footer={
        <>
          <Button onClick={onDone}>Done</Button>
          <Button onClick={onAnother}>Add another</Button>
          <Button variant="primary" autoFocus onClick={onSameDate}>
            Add another, same date
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-[13px]">
        <p className="text-ink">
          <span className="font-semibold">{number}</span> {noun ?? "was recorded."}
        </p>
        <div className="space-y-1 rounded-lg border border-line bg-surface-2 p-3">
          {rows.map((r) => (
            <div key={r.label} className="flex items-center justify-between">
              <span>{r.label}</span>
              {r.value}
            </div>
          ))}
        </div>
        {warnings.length > 0 && (
          <div className="rounded-md border border-[var(--warning-border)] bg-[var(--warning-bg)] px-3 py-2 text-xs text-[var(--warning-text)]">
            <p className="font-medium">Saved, but flagged by Rules &amp; Policies:</p>
            {warnings.map((w) => (
              <p key={w}>{w}</p>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
