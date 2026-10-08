"use client";

import { PaymentModeSelect } from "@/components/payment-mode-select";
import { useMemo, useState } from "react";
import { StatusPill } from "@/components/ui/status-pill";
import { PURCHASE_FIELDS, purchaseMappingComplete, type PurchaseColumnMapping } from "@/lib/purchases/import/fields";
import type { CategoryDecision, PurchaseDateOptions, PurchaseFileAnalysis, PurchaseImportSettings, PurchaseOverrides, PurchaseReviewResult, PurchaseReviewRow, SupplierDecision } from "@/lib/purchases/import/types";
import { BILL_TYPE_LABEL } from "@/lib/purchases/import/values";
import { RowEditor } from "../../sales/import/row-editor";
import type { PurchaseImportSetup } from "./actions";
import type { PurchaseFile } from "./import-purchases";

const card = "rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)]";
const field = "rounded border border-gray-300 bg-white px-2 py-1.5 text-sm focus:border-[var(--color-primary)] focus:outline-none";
const money = (n: number | null) => (n === null ? "—" : n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const PAGE = 50;

type Filter = "all" | "ready" | "attention" | "duplicate" | "skipped";
const TONE = { ready: "success", attention: "critical", duplicate: "action", skipped: "pending" } as const;
const LABEL = { ready: "Ready", attention: "Needs attention", duplicate: "Duplicate", skipped: "Skipped" } as const;

type Props = {
  file: PurchaseFile;
  analysis: PurchaseFileAnalysis;
  setup: PurchaseImportSetup | null;
  mapping: PurchaseColumnMapping;
  onMapping: (m: PurchaseColumnMapping) => void;
  dateOptions: PurchaseDateOptions;
  onDates: (d: PurchaseDateOptions) => void;
  settings: PurchaseImportSettings;
  onSettings: (s: PurchaseImportSettings) => void;
  review: PurchaseReviewResult | null;
  rows: PurchaseReviewRow[] | null;
  supplierDecisions: Record<string, SupplierDecision>;
  onSupplierDecisions: (d: Record<string, SupplierDecision>) => void;
  categoryDecisions: Record<string, CategoryDecision>;
  onCategoryDecisions: (d: Record<string, CategoryDecision>) => void;
  skipRows: number[];
  onSkipRows: (r: number[]) => void;
  overrides: PurchaseOverrides;
  onOverrides: (o: PurchaseOverrides) => void;
  includeDuplicates: boolean;
  onIncludeDuplicates: (v: boolean) => void;
  toImport: number;
  busy: boolean;
  onImport: () => void;
  onCheck: () => void;
  onBack: () => void;
};

export function ReviewStep(p: Props) {
  const needsColumns = !p.analysis.mappingComplete || !purchaseMappingComplete(p.mapping) || p.analysis.dates.blocking;
  const [editColumns, setEditColumns] = useState(false);

  return (
    <div className="space-y-4">
      <div className={`${card} flex flex-wrap items-center justify-between gap-3 px-4 py-3`}>
        <div>
          <p className="text-sm font-medium text-[var(--text-primary)]">{p.file.name}</p>
          <p className="text-xs text-[var(--text-secondary)]">
            {p.analysis.rowCount} row{p.analysis.rowCount === 1 ? "" : "s"}
            {p.analysis.remembered ? " · columns remembered from your last import" : ""}
          </p>
        </div>
        <button type="button" onClick={p.onBack} className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
          Choose another file
        </button>
      </div>

      <Columns {...p} show={needsColumns || editColumns} forced={needsColumns} onToggle={() => setEditColumns((v) => !v)} />
      <Defaults {...p} />

      {!p.review ? (
        <div className={`${card} p-6 text-sm text-[var(--text-secondary)]`}>{p.busy ? "Checking every row..." : "Match the columns above and the review appears here."}</div>
      ) : (
        <>
          <Summary {...p} review={p.review} />
          {p.review.supplierGroups.length > 0 && <SupplierGroups {...p} review={p.review} />}
          {p.review.categoryGroups.length > 0 && <CategoryGroups {...p} review={p.review} />}
          <Rows {...p} />
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------ columns and dates

function Columns({ analysis, mapping, onMapping, dateOptions, onDates, show, forced, onToggle }: Props & { show: boolean; forced: boolean; onToggle: () => void }) {
  const found = PURCHASE_FIELDS.filter((f) => mapping[f.key]);
  return (
    <section className={`${card} p-4`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium text-[var(--text-primary)]">{forced ? "Match your columns" : "Columns found"}</span>
          {!forced &&
            found.map((f) => (
              <span key={f.key} className="rounded-full bg-[var(--surface-muted-bg)] px-2 py-0.5 text-xs text-[var(--text-secondary)]">
                {f.label} ✓
              </span>
            ))}
          <span className="rounded-full bg-[var(--surface-muted-bg)] px-2 py-0.5 text-xs text-[var(--text-secondary)]">
            Dates: {dateOptions.choice === "auto" ? (analysis.dates.detected === "BS" || analysis.dates.detected === "AD" ? `${analysis.dates.detected} detected` : "check below") : dateOptions.choice}
          </span>
        </div>
        {!forced && (
          <button type="button" onClick={onToggle} className="text-sm text-[var(--color-primary)] hover:underline">
            {show ? "Hide" : "Change"}
          </button>
        )}
      </div>

      {show && (
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {PURCHASE_FIELDS.map((f) => (
              <div key={f.key}>
                <label className="mb-1 block text-xs text-gray-500">
                  {f.label}
                  {f.required ? " *" : ""}
                </label>
                <select className={`${field} w-full`} value={mapping[f.key] ?? ""} onChange={(e) => onMapping({ ...mapping, [f.key]: e.target.value || undefined })}>
                  <option value="">{f.required ? "Choose column" : "— not in my file —"}</option>
                  {analysis.headers.filter(Boolean).map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="mb-1 block text-xs text-gray-500">Dates in the file are</label>
              <select className={field} value={dateOptions.choice} onChange={(e) => onDates({ ...dateOptions, choice: e.target.value as PurchaseDateOptions["choice"] })}>
                <option value="auto">Detect automatically</option>
                <option value="AD">AD (Gregorian)</option>
                <option value="BS">BS (Bikram Sambat)</option>
              </select>
            </div>
            {analysis.dates.dayMonthAmbiguity && (
              <label className="flex items-center gap-1.5 text-sm text-[var(--text-secondary)]">
                <input type="checkbox" checked={dateOptions.dayFirst} onChange={(e) => onDates({ ...dateOptions, dayFirst: e.target.checked })} />
                Day comes before month (15/04/2083)
              </label>
            )}
            {analysis.dates.mixed && (
              <label className="flex items-center gap-1.5 text-sm text-[var(--text-secondary)]">
                <input type="checkbox" checked={dateOptions.allowMixed} onChange={(e) => onDates({ ...dateOptions, allowMixed: e.target.checked })} />
                The file mixes AD and BS dates, read each row on its own
              </label>
            )}
          </div>
          {analysis.dates.blocking && <p className="text-sm text-amber-700">The dates can&apos;t be told apart yet. Choose AD or BS above.</p>}
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------ what to assume when the file doesn't say

function Defaults({ settings, onSettings, setup, mapping }: Props) {
  const paidColumn = Boolean(mapping.paid);
  const needsAccount = settings.paidMode === "full" || (settings.paidMode === "file" && paidColumn && !mapping.account);
  const needsCategory = !mapping.category;
  return (
    <section className={`${card} p-4`}>
      <p className="mb-3 text-sm font-medium text-[var(--text-primary)]">If the file doesn&apos;t say</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div>
          <label className="mb-1 block text-xs text-gray-500">Category{needsCategory ? " *" : ""}</label>
          <select className={`${field} w-full`} value={settings.defaultCategoryId ?? ""} onChange={(e) => onSettings({ ...settings, defaultCategoryId: e.target.value || null })}>
            <option value="">{needsCategory ? "Choose category" : "— when a row has none —"}</option>
            {(setup?.categories ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500">Bill type</label>
          <select className={`${field} w-full`} value={settings.defaultBillType} onChange={(e) => onSettings({ ...settings, defaultBillType: e.target.value as PurchaseImportSettings["defaultBillType"] })}>
            {(Object.keys(BILL_TYPE_LABEL) as (keyof typeof BILL_TYPE_LABEL)[]).map((k) => (
              <option key={k} value={k}>
                {BILL_TYPE_LABEL[k]}
                {k === "vat" && setup && setup.vatRate > 0 ? ` (${setup.vatRate}%)` : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500">Amounts are</label>
          <select className={`${field} w-full`} value={settings.amountsIncludeVat ? "incl" : "excl"} onChange={(e) => onSettings({ ...settings, amountsIncludeVat: e.target.value === "incl" })}>
            <option value="excl">Before VAT</option>
            <option value="incl">Including VAT (VAT bills)</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500">Payment</label>
          <select className={`${field} w-full`} value={settings.paidMode} onChange={(e) => onSettings({ ...settings, paidMode: e.target.value as PurchaseImportSettings["paidMode"] })}>
            <option value="file">{paidColumn ? "Use the paid column" : "Unpaid (no paid column)"}</option>
            <option value="unpaid">All unpaid</option>
            <option value="full">All paid in full</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500">Paid from{needsAccount ? " *" : ""}</label>
          <PaymentModeSelect
            value={{ modeId: settings.defaultModeId ?? "", accountId: settings.defaultAccountId ?? "" }}
            onChange={(v) => onSettings({ ...settings, defaultAccountId: v.accountId || null, defaultModeId: v.modeId || null })}
            className={`${field} w-full`}
          />
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------ the numbers

function Summary({ rows, review, includeDuplicates, onIncludeDuplicates, toImport, busy, onImport, onCheck, settings }: Props & { review: PurchaseReviewResult }) {
  const counts = { ready: 0, attention: 0, duplicate: 0, skipped: 0 };
  let importTotal = 0;
  let importTax = 0;
  for (const r of rows ?? []) {
    counts[r.status]++;
    if (r.status === "ready" || (includeDuplicates && r.status === "duplicate")) {
      importTotal += r.total ?? 0;
      importTax += r.tax ?? 0;
    }
  }
  const before = Math.round((importTotal - importTax) * 100) / 100;
  const compare = settings.amountsIncludeVat ? Math.round(importTotal * 100) / 100 : before;
  return (
    <section className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card label="Ready" value={counts.ready} tone="text-green-700" />
        <Card label="Needs attention" value={counts.attention} tone={counts.attention ? "text-red-600" : undefined} />
        <Card label="Possible duplicates" value={counts.duplicate} tone={counts.duplicate ? "text-amber-700" : undefined} />
        <Card label="Skipped" value={counts.skipped} />
      </div>
      <div className={`${card} flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm`}>
        <div className="text-[var(--text-secondary)]">
          <p>
            Amount column in the file: <span className="tabular-nums text-[var(--text-primary)]">{money(review.fileTotal)}</span> · {settings.amountsIncludeVat ? "Bill totals to import" : "Bill amounts to import (before VAT)"}:{" "}
            <span className="tabular-nums text-[var(--text-primary)]">{money(compare)}</span>
            {Math.abs(review.fileTotal - compare) > 0.005 && <span className="ml-2 text-amber-700">Difference {money(Math.round((review.fileTotal - compare) * 100) / 100)}: rows that aren&apos;t going in.</span>}
          </p>
          <p>
            VAT <span className="tabular-nums text-[var(--text-primary)]">{money(Math.round(importTax * 100) / 100)}</span> · Bill total <span className="tabular-nums text-[var(--text-primary)]">{money(Math.round(importTotal * 100) / 100)}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {counts.duplicate > 0 && (
            <label className="flex items-center gap-1.5 text-sm text-[var(--text-secondary)]">
              <input type="checkbox" checked={includeDuplicates} onChange={(e) => onIncludeDuplicates(e.target.checked)} />
              Import the duplicates too
            </label>
          )}
          <button type="button" disabled={busy || toImport === 0} onClick={onCheck} className="rounded border border-gray-300 px-4 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            Check only
          </button>
          <button type="button" disabled={busy || toImport === 0} onClick={onImport} className="rounded bg-[var(--color-primary)] px-5 py-1.5 text-sm font-medium text-white hover:bg-[var(--color-primary-hover)] disabled:opacity-50">
            {busy ? "Working..." : `Import ${toImport} bill${toImport === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </section>
  );
}

function Card({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className={`${card} p-3`}>
      <p className="text-xs text-[var(--text-secondary)]">{label}</p>
      <p className={`mt-0.5 text-xl font-semibold ${tone ?? "text-[var(--text-primary)]"}`}>{value}</p>
    </div>
  );
}

// ------------------------------------------------------------ suppliers in the file that aren't set up yet

function SupplierGroups({ review, supplierDecisions: decisions, onSupplierDecisions: onDecisions, setup }: Props & { review: PurchaseReviewResult }) {
  const suppliers = setup?.suppliers ?? [];
  const set = (key: string, d: SupplierDecision | undefined) => {
    const next = { ...decisions };
    if (d) next[key] = d;
    else delete next[key];
    onDecisions(next);
  };
  const decide = (key: string, text: string, value: string, remember: boolean) => {
    if (value === "") return set(key, undefined);
    if (value === "create") return set(key, { action: "create", name: text });
    if (value === "skip") return set(key, { action: "skip" });
    set(key, { action: "existing", vendorId: value, remember });
  };
  const valueOf = (key: string) => {
    const d = decisions[key];
    return !d ? "" : d.action === "existing" ? d.vendorId : d.action;
  };
  const groups = review.supplierGroups;
  const undecided = groups.filter((g) => !decisions[g.key]).length;

  return (
    <section className={`${card} p-4`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-[var(--text-primary)]">
            {groups.length} supplier name{groups.length === 1 ? "" : "s"} in your file aren&apos;t suppliers yet
          </p>
          <p className="text-xs text-[var(--text-secondary)]">Decide each once; it applies to all its rows. {undecided > 0 ? `${undecided} still to decide.` : "All decided."}</p>
        </div>
        <div className="flex flex-wrap gap-3 text-sm">
          {groups.some((g) => g.suggestion && !decisions[g.key]) && (
            <button
              type="button"
              className="text-[var(--color-primary)] hover:underline"
              onClick={() => {
                const next = { ...decisions };
                for (const g of groups) if (g.suggestion && !next[g.key]) next[g.key] = { action: "existing", vendorId: g.suggestion.vendorId, remember: true };
                onDecisions(next);
              }}
            >
              Use all suggestions
            </button>
          )}
          {undecided > 0 && (
            <button
              type="button"
              className="text-[var(--color-primary)] hover:underline"
              onClick={() => {
                const next = { ...decisions };
                for (const g of groups) if (!next[g.key]) next[g.key] = { action: "create", name: g.text };
                onDecisions(next);
              }}
            >
              Create all the rest as new suppliers
            </button>
          )}
        </div>
      </div>
      <ul className="mt-3 divide-y divide-[var(--card-border)]">
        {groups.map((g) => {
          const d = decisions[g.key];
          return (
            <li key={g.key} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <div className="min-w-48 flex-1">
                <p className="font-medium text-[var(--text-primary)]">&ldquo;{g.text}&rdquo;</p>
                <p className="text-xs text-[var(--text-secondary)]">
                  {g.rows} row{g.rows === 1 ? "" : "s"} · {money(g.total)}
                  {g.suggestion ? ` · looks like ${g.suggestion.name} (${Math.round(g.suggestion.score * 100)}%)` : ""}
                </p>
              </div>
              <select className={`${field} w-64`} value={valueOf(g.key)} onChange={(e) => decide(g.key, g.text, e.target.value, d?.action === "existing" ? d.remember : true)}>
                <option value="">Decide…</option>
                <option value="create">Create as a new supplier</option>
                <option value="skip">Skip these rows</option>
                {g.suggestion && <option value={g.suggestion.vendorId}>Use {g.suggestion.name}</option>}
                <optgroup label="Use an existing supplier">
                  {suppliers
                    .filter((s) => s.id !== g.suggestion?.vendorId)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </optgroup>
              </select>
              {d?.action === "create" && <input className={`${field} w-56`} value={d.name} onChange={(e) => set(g.key, { action: "create", name: e.target.value })} aria-label="New supplier name" />}
              {d?.action === "existing" && (
                <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                  <input type="checkbox" checked={d.remember} onChange={(e) => set(g.key, { ...d, remember: e.target.checked })} />
                  Remember for next time
                </label>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ------------------------------------------------------------ categories in the file that aren't yours

function CategoryGroups({ review, categoryDecisions: decisions, onCategoryDecisions: onDecisions, setup }: Props & { review: PurchaseReviewResult }) {
  const categories = setup?.categories ?? [];
  const groups = review.categoryGroups;
  const set = (key: string, d: CategoryDecision | undefined) => {
    const next = { ...decisions };
    if (d) next[key] = d;
    else delete next[key];
    onDecisions(next);
  };
  const undecided = groups.filter((g) => !decisions[g.key]).length;
  const valueOf = (key: string) => {
    const d = decisions[key];
    return !d ? "" : d.action === "existing" ? d.categoryId : "skip";
  };

  return (
    <section className={`${card} p-4`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-[var(--text-primary)]">
            {groups.length} categor{groups.length === 1 ? "y" : "ies"} in your file aren&apos;t one of yours
          </p>
          <p className="text-xs text-[var(--text-secondary)]">Choose which of your purchase categories each belongs to. {undecided > 0 ? `${undecided} still to decide.` : "All decided."}</p>
        </div>
        {groups.some((g) => g.suggestion && !decisions[g.key]) && (
          <button
            type="button"
            className="text-sm text-[var(--color-primary)] hover:underline"
            onClick={() => {
              const next = { ...decisions };
              for (const g of groups) if (g.suggestion && !next[g.key]) next[g.key] = { action: "existing", categoryId: g.suggestion.categoryId };
              onDecisions(next);
            }}
          >
            Use all suggestions
          </button>
        )}
      </div>
      <ul className="mt-3 divide-y divide-[var(--card-border)]">
        {groups.map((g) => (
          <li key={g.key} className="flex flex-wrap items-center gap-3 py-2 text-sm">
            <div className="min-w-48 flex-1">
              <p className="font-medium text-[var(--text-primary)]">&ldquo;{g.text}&rdquo;</p>
              <p className="text-xs text-[var(--text-secondary)]">
                {g.rows} row{g.rows === 1 ? "" : "s"} · {money(g.total)}
                {g.suggestion ? ` · looks like ${g.suggestion.name} (${Math.round(g.suggestion.score * 100)}%)` : ""}
              </p>
            </div>
            <select
              className={`${field} w-64`}
              value={valueOf(g.key)}
              onChange={(e) => {
                const v = e.target.value;
                set(g.key, v === "" ? undefined : v === "skip" ? { action: "skip" } : { action: "existing", categoryId: v });
              }}
            >
              <option value="">Decide…</option>
              <option value="skip">Skip these rows</option>
              {g.suggestion && <option value={g.suggestion.categoryId}>Use {g.suggestion.name}</option>}
              <optgroup label="Use a category">
                {categories
                  .filter((c) => c.id !== g.suggestion?.categoryId)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </optgroup>
            </select>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ------------------------------------------------------------ every row

function Rows({ rows, skipRows, onSkipRows, supplierDecisions, overrides, onOverrides }: Props) {
  const [editing, setEditing] = useState<number | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const all = useMemo(() => rows ?? [], [rows]);

  const counts = useMemo(() => {
    const c = { all: all.length, ready: 0, attention: 0, duplicate: 0, skipped: 0 };
    for (const r of all) c[r.status]++;
    return c;
  }, [all]);
  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return all.filter((r) => (filter === "all" || r.status === filter) && (term === "" || r.supplierText.toLowerCase().includes(term) || (r.supplierName ?? "").toLowerCase().includes(term) || r.categoryText.toLowerCase().includes(term) || String(r.rowNumber) === term));
  }, [all, filter, q]);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const current = Math.min(page, pages);
  const visible = shown.slice((current - 1) * PAGE, current * PAGE);
  const tabs: [Filter, string][] = [
    ["all", "All"],
    ["ready", "Ready"],
    ["attention", "Needs attention"],
    ["duplicate", "Duplicates"],
    ["skipped", "Skipped"],
  ];
  const toggleSkip = (n: number) => onSkipRows(skipRows.includes(n) ? skipRows.filter((x) => x !== n) : [...skipRows, n]);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-full bg-[var(--surface-muted-bg)] p-1">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setFilter(id);
                setPage(1);
              }}
              className={`rounded-full px-3 py-1 text-sm ${filter === id ? "bg-[var(--card-bg)] font-medium text-[var(--text-primary)] shadow-sm" : "text-[var(--text-secondary)]"}`}
            >
              {label} ({counts[id]})
            </button>
          ))}
        </div>
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          placeholder="Search supplier, category or row"
          className={`${field} w-64`}
        />
      </div>

      <div className={`${card} overflow-x-auto`}>
        <table className="w-full text-sm">
          <thead className="bg-[var(--surface-muted-bg)] text-left text-[var(--text-secondary)]">
            <tr>
              <th className="px-3 py-2 font-medium">Row</th>
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Supplier</th>
              <th className="px-3 py-2 font-medium">Category</th>
              <th className="px-3 py-2 text-right font-medium">Amount</th>
              <th className="px-3 py-2 text-right font-medium">Bill total</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Note</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const d = r.supplierKey ? supplierDecisions[r.supplierKey] : undefined;
              const name = r.supplierName ?? (d?.action === "create" ? d.name : r.supplierText);
              return (
                <tr key={r.rowNumber} className={`border-t border-[var(--card-border)] ${r.status === "skipped" ? "opacity-50" : ""}`}>
                  <td className="px-3 py-2 text-[var(--text-secondary)]">{r.rowNumber}</td>
                  <td className="px-3 py-2">{r.dateIso ?? <span className="text-red-600">{r.dateRaw || "—"}</span>}</td>
                  <td className="px-3 py-2">
                    {name || <span className="text-[var(--text-secondary)]">No supplier</span>}
                    {d?.action === "create" && <span className="ml-1 text-xs text-[var(--text-secondary)]">(new)</span>}
                  </td>
                  <td className="px-3 py-2">{r.categoryName ?? (r.categoryText ? <span className="text-red-600">{r.categoryText}</span> : <span className="text-[var(--text-secondary)]">—</span>)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(r.amount)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(r.total)}</td>
                  <td className="px-3 py-2">
                    <StatusPill tone={TONE[r.status]}>{LABEL[r.status]}</StatusPill>
                  </td>
                  <td className="max-w-xs px-3 py-2 text-xs text-[var(--text-secondary)]">{r.status === "skipped" ? "" : r.messages.join(" ")}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {r.status !== "skipped" && (
                      <button type="button" onClick={() => setEditing(r.rowNumber)} className="mr-3 text-xs text-[var(--color-primary)] hover:underline">
                        {overrides[r.rowNumber] ? "Fix (edited)" : "Fix"}
                      </button>
                    )}
                    {(r.status !== "skipped" || skipRows.includes(r.rowNumber)) && (
                      <button type="button" onClick={() => toggleSkip(r.rowNumber)} className="text-xs text-[var(--text-secondary)] hover:underline">
                        {skipRows.includes(r.rowNumber) ? "Include" : "Skip"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-[var(--text-secondary)]">
                  No rows here.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing !== null && all.find((x) => x.rowNumber === editing) && (
        <RowEditor
          key={editing}
          fields={PURCHASE_FIELDS}
          row={all.find((x) => x.rowNumber === editing)!}
          edited={Boolean(overrides[editing])}
          onClose={() => setEditing(null)}
          onRevert={() => {
            const next = { ...overrides };
            delete next[editing];
            setEditing(null);
            onOverrides(next);
          }}
          onSave={(values) => {
            const row = all.find((x) => x.rowNumber === editing)!;
            // Only what changed is kept, so an untouched cell still follows the file.
            const changed = Object.fromEntries(Object.entries(values).filter(([k, v]) => (row.raw[k as keyof typeof row.raw] ?? "") !== (v ?? "")));
            const next = { ...overrides, [editing]: { ...(overrides[editing] ?? {}), ...changed } };
            setEditing(null);
            onOverrides(next);
          }}
        />
      )}
      {pages > 1 && (
        <div className="flex items-center justify-end gap-3 text-sm text-[var(--text-secondary)]">
          <button type="button" disabled={current <= 1} onClick={() => setPage(current - 1)} className="rounded border border-gray-300 px-3 py-1 disabled:opacity-40">
            Previous
          </button>
          <span>
            Page {current} of {pages}
          </span>
          <button type="button" disabled={current >= pages} onClick={() => setPage(current + 1)} className="rounded border border-gray-300 px-3 py-1 disabled:opacity-40">
            Next
          </button>
        </div>
      )}
    </section>
  );
}
