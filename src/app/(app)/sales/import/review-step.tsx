"use client";

import { PaymentModeSelect } from "@/components/payment-mode-select";
import { useMemo, useState } from "react";
import { StatusPill } from "@/components/ui/status-pill";
import { IMPORT_FIELDS, type SalesColumnMapping } from "@/lib/sales/import/fields";
import type { DateOptions, FileAnalysis, GroupDecision, ImportSettings, Overrides, ReviewResult, ReviewRow } from "@/lib/sales/import/types";
import type { ImportSetup } from "./actions";
import type { File } from "./import-sales";
import { RowEditor } from "./row-editor";

const card = "rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)]";
const field = "rounded border border-gray-300 bg-white px-2 py-1.5 text-sm focus:border-[var(--color-primary)] focus:outline-none";
const money = (n: number | null) => (n === null ? "—" : n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const PAGE = 50;

type Row = ReviewRow;
type Filter = "all" | "ready" | "attention" | "duplicate" | "skipped";
const TONE = { ready: "success", attention: "critical", duplicate: "action", skipped: "pending" } as const;
const LABEL = { ready: "Ready", attention: "Needs attention", duplicate: "Duplicate", skipped: "Skipped" } as const;

type Props = {
  file: File;
  analysis: FileAnalysis;
  setup: ImportSetup | null;
  mapping: SalesColumnMapping;
  onMapping: (m: SalesColumnMapping) => void;
  dateOptions: DateOptions;
  onDates: (d: DateOptions) => void;
  settings: ImportSettings;
  onSettings: (s: ImportSettings) => void;
  review: ReviewResult | null;
  rows: Row[] | null;
  decisions: Record<string, GroupDecision>;
  onDecisions: (d: Record<string, GroupDecision>) => void;
  skipRows: number[];
  onSkipRows: (r: number[]) => void;
  overrides: Overrides;
  onOverrides: (o: Overrides) => void;
  onCheck: () => void;
  includeDuplicates: boolean;
  onIncludeDuplicates: (v: boolean) => void;
  toImport: number;
  busy: boolean;
  onImport: () => void;
  onBack: () => void;
};

export function ReviewStep(p: Props) {
  const needsColumns = !p.analysis.mappingComplete || !IMPORT_FIELDS.filter((f) => f.required).every((f) => p.mapping[f.key]) || p.analysis.dates.blocking;
  const [editColumns, setEditColumns] = useState(false);
  const showColumns = needsColumns || editColumns;

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

      <Columns {...p} show={showColumns} forced={needsColumns} onToggle={() => setEditColumns((v) => !v)} />
      <Defaults {...p} />

      {!p.review ? (
        <div className={`${card} p-6 text-sm text-[var(--text-secondary)]`}>{p.busy ? "Checking every row..." : "Match the columns above and the review appears here."}</div>
      ) : (
        <>
          <Summary {...p} review={p.review} />
          {p.review.groups.length > 0 && <Groups {...p} review={p.review} setup={p.setup} />}
          <Rows {...p} review={p.review} />
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------ columns and dates

function Columns({ analysis, mapping, onMapping, dateOptions, onDates, show, forced, onToggle }: Props & { show: boolean; forced: boolean; onToggle: () => void }) {
  const found = IMPORT_FIELDS.filter((f) => mapping[f.key]);
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {IMPORT_FIELDS.map((f) => (
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
              <select className={field} value={dateOptions.choice} onChange={(e) => onDates({ ...dateOptions, choice: e.target.value as DateOptions["choice"] })}>
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

function Defaults({ settings, onSettings, setup, mapping, review }: Props) {
  const paidColumn = Boolean(mapping.paid);
  const revenueColumn = Boolean(mapping.revenue);
  const needsAccount = settings.paidMode === "full" || (settings.paidMode === "file" && paidColumn && !mapping.account);
  return (
    <section className={`${card} p-4`}>
      <p className="mb-3 text-sm font-medium text-[var(--text-primary)]">If the file doesn&apos;t say</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="mb-1 block text-xs text-gray-500">Amounts are</label>
          <select className={`${field} w-full`} value={settings.amountsIncludeVat ? "incl" : "excl"} onChange={(e) => onSettings({ ...settings, amountsIncludeVat: e.target.value === "incl" })}>
            <option value="excl">Before VAT</option>
            <option value="incl">Including VAT</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500">Bill type</label>
          <select className={`${field} w-full`} value={settings.defaultBillType} onChange={(e) => onSettings({ ...settings, defaultBillType: e.target.value as ImportSettings["defaultBillType"] })}>
            <option value="taxable">Taxable{setup && setup.vatRate > 0 ? ` (${setup.vatRate}%)` : ""}</option>
            <option value="zero_rated">Zero-rated</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500">Revenue account</label>
          <select className={`${field} w-full`} value={settings.defaultRevenueAccountId ?? ""} onChange={(e) => onSettings({ ...settings, defaultRevenueAccountId: e.target.value || null })}>
            <option value="">{revenueColumn ? "— when the file names none —" : "Sales Revenue (default)"}</option>
            {(setup?.revenueAccounts ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500">Payment</label>
          <select className={`${field} w-full`} value={settings.paidMode} onChange={(e) => onSettings({ ...settings, paidMode: e.target.value as ImportSettings["paidMode"] })}>
            <option value="file">{paidColumn ? "Use the paid column" : "Unpaid (no paid column)"}</option>
            <option value="unpaid">All unpaid</option>
            <option value="full">All paid in full</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500">Money received into{needsAccount ? " *" : ""}</label>
          <PaymentModeSelect
            value={{ modeId: settings.defaultModeId ?? "", accountId: settings.defaultAccountId ?? "" }}
            onChange={(v) => onSettings({ ...settings, defaultAccountId: v.accountId || null, defaultModeId: v.modeId || null })}
            className={`${field} w-full`}
          />
        </div>
      </div>
      {settings.amountsIncludeVat && review && <p className="mt-2 text-xs text-[var(--text-secondary)]">Each amount is taken as the invoice total after any discount; the VAT is worked back out of it.</p>}
    </section>
  );
}

// ------------------------------------------------------------ the numbers

function Summary({ rows, review, includeDuplicates, onIncludeDuplicates, toImport, busy, onImport, onCheck, settings }: Props & { review: ReviewResult }) {
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
  const fileTotalLabel = settings.amountsIncludeVat ? "Invoice totals to import" : "Invoice amounts to import (before VAT)";
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
            Amount column in the file: <span className="tabular-nums text-[var(--text-primary)]">{money(review.fileTotal)}</span> · {fileTotalLabel}: <span className="tabular-nums text-[var(--text-primary)]">{money(compare)}</span>
            {Math.abs(review.fileTotal - compare) > 0.005 && <span className="ml-2 text-amber-700">Difference {money(Math.round((review.fileTotal - compare) * 100) / 100)}: rows that aren&apos;t going in.</span>}
          </p>
          <p>
            VAT <span className="tabular-nums text-[var(--text-primary)]">{money(Math.round(importTax * 100) / 100)}</span> · Invoice total <span className="tabular-nums text-[var(--text-primary)]">{money(Math.round(importTotal * 100) / 100)}</span>
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
            {busy ? "Importing..." : `Import ${toImport} invoice${toImport === 1 ? "" : "s"}`}
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

// ------------------------------------------------------------ customers in the file that aren't set up yet

function Groups({ review, decisions, onDecisions, setup }: Props & { review: ReviewResult }) {
  const customers = setup?.customers ?? [];
  const set = (key: string, d: GroupDecision | undefined) => {
    const next = { ...decisions };
    if (d) next[key] = d;
    else delete next[key];
    onDecisions(next);
  };
  const decide = (key: string, text: string, value: string, remember: boolean) => {
    if (value === "") return set(key, undefined);
    if (value === "create") return set(key, { action: "create", name: text });
    if (value === "skip") return set(key, { action: "skip" });
    set(key, { action: "existing", customerId: value, remember });
  };
  const valueOf = (key: string) => {
    const d = decisions[key];
    return !d ? "" : d.action === "existing" ? d.customerId : d.action;
  };
  const undecided = review.groups.filter((g) => !decisions[g.key]).length;

  return (
    <section className={`${card} p-4`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-[var(--text-primary)]">
            {review.groups.length} name{review.groups.length === 1 ? "" : "s"} in your file aren&apos;t customers yet
          </p>
          <p className="text-xs text-[var(--text-secondary)]">Decide each once; it applies to all its rows. {undecided > 0 ? `${undecided} still to decide.` : "All decided."}</p>
        </div>
        <div className="flex flex-wrap gap-3 text-sm">
          {review.groups.some((g) => g.suggestion && !decisions[g.key]) && (
            <button
              type="button"
              className="text-[var(--color-primary)] hover:underline"
              onClick={() => {
                const next = { ...decisions };
                for (const g of review.groups) if (g.suggestion && !next[g.key]) next[g.key] = { action: "existing", customerId: g.suggestion.customerId, remember: true };
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
                for (const g of review.groups) if (!next[g.key]) next[g.key] = { action: "create", name: g.text };
                onDecisions(next);
              }}
            >
              Create all the rest as new customers
            </button>
          )}
        </div>
      </div>

      <ul className="mt-3 divide-y divide-[var(--card-border)]">
        {review.groups.map((g) => {
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
                <option value="create">Create as a new customer</option>
                <option value="skip">Skip these rows</option>
                {g.suggestion && <option value={g.suggestion.customerId}>Use {g.suggestion.name}</option>}
                <optgroup label="Use an existing customer">
                  {customers
                    .filter((c) => c.id !== g.suggestion?.customerId)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </optgroup>
              </select>
              {d?.action === "create" && <input className={`${field} w-56`} value={d.name} onChange={(e) => set(g.key, { action: "create", name: e.target.value })} aria-label="New customer name" />}
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

// ------------------------------------------------------------ every row

function Rows({ rows, skipRows, onSkipRows, decisions, overrides, onOverrides }: Props & { review: ReviewResult }) {
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
    return all.filter((r) => (filter === "all" || r.status === filter) && (term === "" || r.customerText.toLowerCase().includes(term) || (r.customerName ?? "").toLowerCase().includes(term) || String(r.rowNumber) === term));
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
          placeholder="Search customer or row"
          className={`${field} w-56`}
        />
      </div>

      <div className={`${card} overflow-x-auto`}>
        <table className="w-full text-sm">
          <thead className="bg-[var(--surface-muted-bg)] text-left text-[var(--text-secondary)]">
            <tr>
              <th className="px-3 py-2 font-medium">Row</th>
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Customer</th>
              <th className="px-3 py-2 text-right font-medium">Amount</th>
              <th className="px-3 py-2 text-right font-medium">Invoice total</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Note</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const d = r.customerKey ? decisions[r.customerKey] : undefined;
              const name = r.customerName ?? (d?.action === "create" ? d.name : r.customerText);
              return (
                <tr key={r.rowNumber} className={`border-t border-[var(--card-border)] ${r.status === "skipped" ? "opacity-50" : ""}`}>
                  <td className="px-3 py-2 text-[var(--text-secondary)]">{r.rowNumber}</td>
                  <td className="px-3 py-2">{r.dateIso ?? <span className="text-red-600">{r.dateRaw || "—"}</span>}</td>
                  <td className="px-3 py-2">
                    {name || <span className="text-[var(--text-secondary)]">Cash sale</span>}
                    {d?.action === "create" && <span className="ml-1 text-xs text-[var(--text-secondary)]">(new)</span>}
                  </td>
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
                <td colSpan={8} className="px-4 py-8 text-center text-[var(--text-secondary)]">
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
          fields={IMPORT_FIELDS}
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
