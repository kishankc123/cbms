"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { FileBarChart } from "lucide-react";
import type { ReportCategory } from "./report-catalog";
import { SearchInput } from "@/components/ui/filters";
import { StatusPill } from "@/components/ui/status-pill";
import { EmptyState } from "@/components/ui/empty-state";

// Every report, grouped by what it answers. One quiet row per report: its name, what it shows, and a note where it isn't built yet.
export function ReportsLanding({ categories }: { categories: ReportCategory[] }) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return categories;
    return categories
      .map((c) => ({ ...c, reports: c.reports.filter((r) => r.title.toLowerCase().includes(q) || (r.note ?? "").toLowerCase().includes(q)) }))
      .filter((c) => c.reports.length > 0);
  }, [categories, search]);

  return (
    <div className="space-y-6">
      <SearchInput value={search} onChange={setSearch} placeholder="Search reports" />

      {filtered.length === 0 && <EmptyState icon={FileBarChart} title="No reports match" description={`Nothing matches "${search}". Try a different word.`} />}

      {filtered.map((category) => (
        <section key={category.name} className="space-y-1.5">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-2">{category.name}</h2>
          <ul className="divide-y divide-[var(--border)] border-y border-line">
            {category.reports.map((report) =>
              report.built ? (
                <li key={report.title}>
                  <Link href={report.href} className="flex items-baseline justify-between gap-4 px-1 py-2 transition-colors hover:bg-hover">
                    <span className="text-[13px] font-medium text-ink">{report.title}</span>
                    {report.note && <span className="truncate text-xs text-ink-2">{report.note}</span>}
                  </Link>
                </li>
              ) : (
                <li key={report.title} className="flex items-baseline justify-between gap-4 px-1 py-2">
                  <span className="text-[13px] text-ink-2">{report.title}</span>
                  <StatusPill tone="neutral">{report.note ?? "Not built yet"}</StatusPill>
                </li>
              )
            )}
          </ul>
        </section>
      ))}
    </div>
  );
}
