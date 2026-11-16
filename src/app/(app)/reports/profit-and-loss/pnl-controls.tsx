"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { KIND_LABEL, PERIOD_KINDS, type CompareWith, type PeriodKind } from "@/lib/ledger/pnl-compare-rules";

// Both controls keep their choices in the address, so a view can be bookmarked and the page stays a server page.
function useSetParams() {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  return (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    router.push(`${path}?${next.toString()}`);
  };
}

export function ViewSelect({ view, otherLabel = "Comparative" }: { view: "standard" | "comparative"; otherLabel?: string }) {
  const set = useSetParams();
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-ink-2">View</span>
      <Select value={view} onChange={(e) => set({ view: e.target.value === "standard" ? null : e.target.value })} className="w-44">
        <option value="standard">Standard</option>
        <option value="comparative">{otherLabel}</option>
      </Select>
    </label>
  );
}

/** Choose one of the recent quarters. */
export function QuarterSelect({ at, options }: { at: string; options: { value: string; label: string }[] }) {
  const set = useSetParams();
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-ink-2">Quarter</span>
      <Select value={at} onChange={(e) => set({ at: e.target.value })} className="w-80">
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </label>
  );
}

export function ComparePicker({ kind, at, compare, options, noCompare }: { kind: PeriodKind; at: string; compare: CompareWith; options: { value: string; label: string }[]; /** A report of one period has nothing to compare with. */ noCompare?: boolean }) {
  const set = useSetParams();
  return (
    <>
      <div>
        <span className="mb-1 block text-xs font-medium text-ink-2">Period</span>
        <div className="flex gap-1">
          {PERIOD_KINDS.map((k) => (
            <Button key={k} size="sm" variant={k === kind ? "primary" : "secondary"} onClick={() => set({ kind: k, at: null })}>
              {KIND_LABEL[k]}
            </Button>
          ))}
        </div>
      </div>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-ink-2">{KIND_LABEL[kind]}</span>
        <Select value={at} onChange={(e) => set({ at: e.target.value })} className="w-56">
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </label>
      {!noCompare && (
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-ink-2">Compare with</span>
        <Select value={compare} onChange={(e) => set({ compare: e.target.value })} className="w-52">
          <option value="previous">Previous {KIND_LABEL[kind].toLowerCase()}</option>
          <option value="last_year">Same {KIND_LABEL[kind].toLowerCase()} last year</option>
        </Select>
      </label>
      )}
    </>
  );
}
