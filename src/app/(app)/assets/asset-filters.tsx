"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { STATUS_LABEL } from "./shared";

const input = "rounded border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-1.5 text-sm text-[var(--text-primary)]";

/** Search, status and category filters. They live in the URL, so the list is filtered and paged in the database. */
export function AssetFilters({ categories }: { categories: { id: string; name: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [search, setSearch] = useState(params.get("q") ?? "");

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("page");
    router.replace(`${pathname}?${next.toString()}`);
  }

  // Wait for a pause in typing before searching.
  useEffect(() => {
    if (search === (params.get("q") ?? "")) return;
    const t = setTimeout(() => setParam("q", search.trim()), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const active = params.get("q") || params.get("status") || params.get("category");

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by code or name..." className={`${input} w-64`} />
      <select value={params.get("status") ?? ""} onChange={(e) => setParam("status", e.target.value)} className={input}>
        <option value="">All statuses</option>
        {Object.entries(STATUS_LABEL).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <select value={params.get("category") ?? ""} onChange={(e) => setParam("category", e.target.value)} className={input}>
        <option value="">All categories</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      {active && (
        <button
          type="button"
          onClick={() => {
            setSearch("");
            router.replace(pathname);
          }}
          className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
