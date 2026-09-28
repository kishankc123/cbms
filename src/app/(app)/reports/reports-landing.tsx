"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { ReportCategory } from "./report-catalog";

export function ReportsLanding({ categories }: { categories: ReportCategory[] }) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return categories;
    return categories
      .map((c) => ({ ...c, reports: c.reports.filter((r) => r.title.toLowerCase().includes(q)) }))
      .filter((c) => c.reports.length > 0);
  }, [categories, search]);

  return (
    <div className="space-y-8">
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search reports…"
        className="w-full max-w-sm rounded border border-gray-300 bg-white px-3 py-2 text-sm"
      />

      {filtered.length === 0 && <p className="text-sm text-gray-400">No reports match &quot;{search}&quot;.</p>}

      {filtered.map((category) => (
        <section key={category.name} className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-900">{category.name}</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {category.reports.map((report) =>
              report.built ? (
                <Link
                  key={report.title}
                  href={report.href}
                  className="rounded-lg border border-gray-200 bg-white p-4 hover:border-[var(--color-primary)] hover:shadow-sm"
                >
                  <p className="text-sm font-medium text-gray-900">{report.title}</p>
                  {report.note && <p className="mt-1 text-xs text-gray-500">{report.note}</p>}
                </Link>
              ) : (
                <div key={report.title} className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-4 opacity-70">
                  <p className="text-sm font-medium text-gray-500">{report.title}</p>
                  <p className="mt-1 text-xs text-gray-400">{report.note ?? "Not built yet"}</p>
                </div>
              )
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
