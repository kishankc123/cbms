"use client";

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
        <p className="text-sm text-gray-900">{message}</p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onNo}
            className="rounded px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
          >
            No
          </button>
          <button
            type="button"
            onClick={onYes}
            className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-accent px-3 py-[5px] text-[13px] font-medium text-[var(--on-accent)] transition-colors hover:bg-accent-hover disabled:pointer-events-none disabled:opacity-50"
          >
            Yes
          </button>
        </div>
      </div>
    </div>
  );
}
