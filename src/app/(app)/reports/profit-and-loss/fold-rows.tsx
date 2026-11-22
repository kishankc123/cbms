"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";

/**
 * A sub-heading of the Profit & Loss (Performance incentives under Salaries): its own row with the total of what is under it, and the lines under it,
 * which can be folded away. Open to begin with, so a report that is printed or exported shows everything unless it was folded on screen.
 */
export function FoldRows({ lead, label, amounts, topBorder, children }: { lead: React.ReactNode; label: string; amounts: React.ReactNode; topBorder: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <tr className={`transition-colors hover:bg-hover ${topBorder ? "border-t border-line" : ""}`}>
        <td className="px-2.5 py-1 font-medium">{lead}</td>
        <td className="px-2.5 py-1">
          <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1 text-left font-medium text-ink hover:underline" title={open ? "Fold the lines under it" : "Show the lines under it"}>
            <ChevronRight size={13} aria-hidden className={`shrink-0 text-ink-2 transition-transform ${open ? "rotate-90" : ""}`} />
            {label}
          </button>
        </td>
        {amounts}
      </tr>
      {open && children}
    </>
  );
}
