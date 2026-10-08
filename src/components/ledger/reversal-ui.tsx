"use client";

// The small pieces every ledger-style report uses for reversed (voided or edited) entries: the tags on a line, and the checkbox
// that shows or hides them. Hidden by default: the pair cancels out, and the balance is worked out again without it.

export function ReversalTags({ isReversed, isReversal }: { isReversed?: boolean; isReversal?: boolean }) {
  return (
    <>
      {isReversed && <span className="ml-2 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-800">Reversed</span>}
      {isReversal && <span className="ml-2 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-800">Reversal</span>}
    </>
  );
}

export function ReversedToggle({ checked, onChange, hiddenPairs }: { checked: boolean; onChange: (v: boolean) => void; hiddenPairs: number }) {
  return (
    <label className="flex items-center gap-2 text-sm text-gray-600">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      Show reversed and voided entries
      {!checked && hiddenPairs > 0 && <span className="text-xs text-gray-400">({hiddenPairs} hidden)</span>}
    </label>
  );
}
