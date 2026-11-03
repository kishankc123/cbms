"use client";

import { Button } from "@/components/ui/button";

export function ConfirmDialog({
  message,
  onYes,
  onNo,
}: {
  message: string;
  onYes: () => void;
  onNo: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-[var(--bg-overlay)]" onClick={onNo} />

      <div className="relative w-full max-w-sm rounded-[var(--radius-modal)] border border-line bg-surface p-5 shadow-[var(--shadow-modal)] space-y-4">
        <p className="text-[13px] text-ink">{message}</p>
        <div className="flex justify-end gap-2">
          <Button onClick={onNo}>No</Button>
          <Button variant="primary" onClick={onYes}>
            Yes
          </Button>
        </div>
      </div>
    </div>
  );
}
