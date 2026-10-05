import Link from "next/link";
import { D } from "@/components/calendar/date-text";
import { StatusPill } from "@/components/ui/status-pill";
import { getAssetListData } from "./actions";
import { AssetFilters } from "./asset-filters";
import { STATUS_LABEL, STATUS_TONE, money } from "./shared";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

function Card({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
      <p className="text-xs text-[var(--text-secondary)]">{label}</p>
      <p className="mt-1 text-xl font-semibold text-[var(--text-primary)]">{value}</p>
      {note && <p className="mt-0.5 text-xs text-[var(--text-secondary)]">{note}</p>}
    </div>
  );
}

export default async function AssetListPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const page = Math.max(Number(one(sp.page)) || 1, 1);
  const pageSize = Number(one(sp.size)) || 25;
  const search = one(sp.q);
  const status = one(sp.status);
  const categoryId = one(sp.category);
  const { summary, list, categories, canCreate } = await getAssetListData({ search, status, categoryId, page, pageSize });

  const filtered = Boolean(search || status || categoryId);
  const first = list.total === 0 ? 0 : (list.page - 1) * list.pageSize + 1;
  const last = Math.min(list.page * list.pageSize, list.total);
  const pages = Math.max(Math.ceil(list.total / list.pageSize), 1);
  const link = (p: number, size = list.pageSize) => {
    const next = new URLSearchParams();
    if (search) next.set("q", search);
    if (status) next.set("status", status);
    if (categoryId) next.set("category", categoryId);
    if (size !== 25) next.set("size", String(size));
    if (p > 1) next.set("page", String(p));
    const qs = next.toString();
    return qs ? `/assets?${qs}` : "/assets";
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Asset list</h1>
          <p className="mt-0.5 text-sm text-[var(--text-secondary)]">Every fixed asset, its cost, accumulated depreciation and net book value.</p>
        </div>
        {canCreate && (
          <Link href="/assets/transactions" className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5">
            + Add asset
          </Link>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Card label="Total asset cost" value={money(summary.cost)} />
        <Card label="Accumulated depreciation" value={money(summary.accumulated)} />
        <Card label="Net book value" value={money(summary.netBookValue)} />
        <Card label="Added this fiscal year" value={money(summary.additions)} />
        <Card label="Disposed" value={String(summary.disposed)} note="sold, disposed or written off" />
        <Card label="Fully depreciated" value={String(summary.fullyDepreciated)} />
      </div>

      <AssetFilters categories={categories} />

      <div className="overflow-x-auto rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--surface-muted-bg)] text-left text-[var(--text-secondary)]">
            <tr>
              <th className="px-4 py-2 font-medium">Code</th>
              <th className="px-4 py-2 font-medium">Asset</th>
              <th className="px-4 py-2 font-medium">Category</th>
              <th className="px-4 py-2 font-medium">Purchase date</th>
              <th className="px-4 py-2 font-medium text-right">Cost</th>
              <th className="px-4 py-2 font-medium text-right">Accum. depreciation</th>
              <th className="px-4 py-2 font-medium text-right">Net book value</th>
              <th className="px-4 py-2 font-medium">Location</th>
              <th className="px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {list.rows.map((r) => (
              <tr key={r.id} className="border-t border-[var(--card-border)] hover:bg-[var(--surface-muted-bg)]">
                <td className="px-4 py-2 font-mono">
                  <Link href={`/assets/${r.id}`} className="text-[var(--color-primary)] hover:underline">
                    {r.assetCode}
                  </Link>
                </td>
                <td className="px-4 py-2 text-[var(--text-primary)]">
                  <Link href={`/assets/${r.id}`} className="hover:underline">
                    {r.name}
                  </Link>
                </td>
                <td className="px-4 py-2 text-[var(--text-secondary)]">{r.categoryName}</td>
                <td className="px-4 py-2 text-[var(--text-secondary)]">{r.purchaseDate ? <D value={r.purchaseDate} /> : "—"}</td>
                <td className="px-4 py-2 text-right tabular-nums">{money(r.cost)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-[var(--text-secondary)]">{money(r.accumulated)}</td>
                <td className="px-4 py-2 text-right tabular-nums font-medium text-[var(--text-primary)]">{money(r.netBookValue)}</td>
                <td className="px-4 py-2 text-[var(--text-secondary)]">{r.locationName ?? "—"}</td>
                <td className="px-4 py-2">
                  <StatusPill tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</StatusPill>
                </td>
              </tr>
            ))}
            {list.rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center">
                  <p className="text-sm font-medium text-[var(--text-primary)]">{filtered ? "No assets match these filters" : "No assets yet"}</p>
                  <p className="mt-1 text-sm text-[var(--text-secondary)]">
                    {filtered ? "Try a different search, or clear the filters." : "Assets appear here once you purchase one or bring in your opening assets."}
                  </p>
                  {filtered ? (
                    <Link href="/assets" className="mt-3 inline-block text-sm text-[var(--color-primary)] hover:underline">
                      Clear filters
                    </Link>
                  ) : (
                    canCreate && (
                      <Link href="/assets/transactions" className="mt-3 inline-block text-sm text-[var(--color-primary)] hover:underline">
                        + Add asset
                      </Link>
                    )
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {list.total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-[var(--text-secondary)]">
          <span>
            Showing {first}–{last} of {list.total}
          </span>
          <div className="flex items-center gap-3">
            <span>Rows per page:</span>
            {[25, 50, 100].map((s) => (
              <Link key={s} href={link(1, s)} className={s === list.pageSize ? "font-medium text-[var(--text-primary)]" : "hover:text-[var(--text-primary)]"}>
                {s}
              </Link>
            ))}
            <span className="mx-1">|</span>
            {list.page > 1 ? (
              <Link href={link(list.page - 1)} className="hover:text-[var(--text-primary)]">
                ‹ Previous
              </Link>
            ) : (
              <span className="opacity-40">‹ Previous</span>
            )}
            {list.page < pages ? (
              <Link href={link(list.page + 1)} className="hover:text-[var(--text-primary)]">
                Next ›
              </Link>
            ) : (
              <span className="opacity-40">Next ›</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
