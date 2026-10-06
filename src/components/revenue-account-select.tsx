"use client";

import { useEffect, useState } from "react";
import { getRevenueAccountOptions } from "@/app/(app)/sales/actions";

type Option = { id: string; code: string; name: string; group: string | null };
let cache: Option[] | null = null;

/**
 * Picks the revenue account an invoice is booked to. Only the lowest level is offered: a revenue group that has
 * sub-groups can't be chosen, only its sub-groups (shown under the group's name).
 */
export function RevenueAccountSelect({ value, onChange, className, blankLabel }: { value: string; onChange: (id: string) => void; className?: string; blankLabel: string }) {
  const [options, setOptions] = useState<Option[]>(cache ?? []);

  useEffect(() => {
    if (cache) return;
    let live = true;
    getRevenueAccountOptions()
      .then((o) => {
        cache = o;
        if (live) setOptions(o);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const grouped = new Map<string, Option[]>();
  for (const o of options) grouped.set(o.group ?? "", [...(grouped.get(o.group ?? "") ?? []), o]);

  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={className}>
      <option value="">{blankLabel}</option>
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
  );
}
