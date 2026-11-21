"use client";

import { useEffect, useState } from "react";
import { getRevenueAccountOptions } from "@/app/(app)/sales/actions";

type Option = { id: string; code: string; name: string; group: string | null };
// The last list that was read, so a form can open with options at once. It is only a first paint: every form reads the list again when it opens, because
// sub-groups can be added in the Chart of Accounts while the page stays open.
let cache: Option[] | null = null;

/**
 * Picks the revenue account an invoice is booked to. Only the lowest level is offered: a revenue group that has
 * sub-groups can't be chosen, only its sub-groups (shown under the group's name). An invoice booked to an account that has since
 * been given sub-groups says so, and asks for one of them.
 */
export function RevenueAccountSelect({ value, onChange, className, blankLabel }: { value: string; onChange: (id: string) => void; className?: string; blankLabel: string }) {
  const [options, setOptions] = useState<Option[]>(cache ?? []);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let live = true;
    getRevenueAccountOptions()
      .then((o) => {
        cache = o;
        if (live) {
          setOptions(o);
          setLoaded(true);
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const grouped = new Map<string, Option[]>();
  for (const o of options) grouped.set(o.group ?? "", [...(grouped.get(o.group ?? "") ?? []), o]);
  // A saved account that can't be chosen any more (it now has sub-groups): said once the current list is in.
  const stale = loaded && value !== "" && !options.some((o) => o.id === value);

  return (
    <>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={className}>
        <option value="">{blankLabel}</option>
        {stale && (
          <option value={value} disabled>
            Choose a sub-group
          </option>
        )}
        {[...grouped.entries()].map(([group, list]) =>
          group ? (
            <optgroup key={group} label={group}>
              {list.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} — {a.name}
                </option>
              ))}
            </optgroup>
          ) : (
            list.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.name}
              </option>
            ))
          )
        )}
      </select>
      {stale && <p className="mt-1 text-xs text-[var(--warning-text)]">The account this was booked to now has sub-groups. Choose one of them, or leave it blank to use the default.</p>}
    </>
  );
}
