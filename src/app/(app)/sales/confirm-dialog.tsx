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
      <div className="absolute inset-0 bg-black/30" onClick={onNo} />

      <div className="relative w-full max-w-sm rounded-lg bg-white p-5 shadow-lg space-y-4">
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
            className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5"
          >
            Yes
          </button>
        </div>
      </div>
    </div>
  );
}
