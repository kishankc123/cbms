"use client";

import { useRouter } from "next/navigation";
import { adminField } from "../../ui";

type Year = { startYear: number; label: string; toConfirm: number };

// The fiscal year the Setup and Penalty & fines views are showing. It lives in the address (`fy=`), so a view can be bookmarked.
export function FiscalYearFilter({ years, selected, hrefFor }: { years: Year[]; selected: number; hrefFor: Record<number, string> }) {
  const router = useRouter();
  return (
    <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
      Fiscal year
      <select value={selected} onChange={(e) => router.push(hrefFor[Number(e.target.value)])} className={`${adminField} min-w-40`}>
        {[...years].reverse().map((y) => (
          <option key={y.startYear} value={y.startYear}>
            {y.label}
            {y.toConfirm > 0 ? ` · ${y.toConfirm} to confirm` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
