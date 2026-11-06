"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { StatusPill } from "@/components/ui/status-pill";
import type { TaxDepreciationRules } from "@/lib/tax-depreciation/rules";
import { adminCard, adminField } from "../../ui";
import { bothDates } from "../tax-rates/tax-rates-admin";
import { editTaxDepreciationRuleNotes, publishTaxDepreciationRules, type TaxDepreciationRulesAdminData } from "./actions";

const primary = "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-accent px-3 py-[5px] text-[13px] font-medium text-[var(--on-accent)] transition-colors hover:bg-accent-hover disabled:pointer-events-none disabled:opacity-50";
const MONTHS_BS = ["Baisakh", "Jestha", "Ashadh", "Shrawan", "Bhadra", "Ashwin", "Kartik", "Mangsir", "Poush", "Magh", "Falgun", "Chaitra"];

function RulesView({ rules }: { rules: TaxDepreciationRules }) {
  return (
    <div className="space-y-3">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-ink-2 [&_th]:border-b [&_th]:border-line [&_th]:bg-app">
          <tr><th className="py-1 pr-2 font-medium">Class</th><th className="py-1 pr-2 font-medium">Kind</th><th className="py-1 pr-2 text-right font-medium">Rate</th><th className="py-1 text-right font-medium">Small-balance write-off</th></tr>
        </thead>
        <tbody>
          {rules.pools.map((p) => (
            <tr key={p.key} className="border-b border-line">
              <td className="py-1 pr-2">{p.label}</td>
              <td className="py-1 pr-2 text-xs">{p.kind === "pooled" ? "One pooled balance" : "Each asset on its own"}</td>
              <td className="py-1 pr-2 text-right tabular-nums">{p.ratePercent === null ? "From period of use" : `${p.ratePercent}%`}</td>
              <td className="py-1 text-right tabular-nums">{p.writeOffBelow === null ? "None" : `Under ${p.writeOffBelow.toLocaleString("en-IN")}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-sm text-[var(--text-secondary)]">
        Share of an addition counted in its own year: {rules.timing.map((b) => `${MONTHS_BS[b.fromMonth - 1]} to ${MONTHS_BS[b.toMonth - 1]} ${b.thirds}/3`).join(", ")}. The tax year starts in {MONTHS_BS[rules.taxYearStartMonth - 1]}.
      </p>
      <p className="text-sm text-[var(--text-secondary)]">
        Statutory additions: {rules.statutoryAdditions.map((s) => s.label).join("; ")}. Concessions (off until an organization confirms them with documents): {rules.concessions.map((c) => c.label).join("; ")}.
      </p>
    </div>
  );
}

export function TaxDepreciationRulesAdmin({ data }: { data: TaxDepreciationRulesAdminData }) {
  const router = useRouter();
  const [form, setForm] = useState<{ effectiveFrom: string; source: string; isVerified: boolean; json: string } | null>(null);
  const [notes, setNotes] = useState<{ id: string; isVerified: boolean; source: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  if (!data.country) return null;
  const country = data.country;
  const current = data.versions.filter((v) => v.inForce).pop() ?? data.versions[data.versions.length - 1];
  const latest = data.versions[data.versions.length - 1];

  async function save() {
    if (!form) return;
    setBusy(true);
    setMessage(null);
    try {
      const r = await publishTaxDepreciationRules({ countryCode: country.code, effectiveFrom: form.effectiveFrom, rulesJson: form.json, isVerified: form.isVerified, source: form.source });
      if (!r.ok) setMessage({ tone: "bad", text: r.error });
      else {
        setMessage({ tone: "ok", text: `Published. These rules apply from ${form.effectiveFrom}.` });
        setForm(null);
        router.refresh();
      }
    } catch (e) {
      setMessage({ tone: "bad", text: e instanceof Error ? e.message : "Could not publish the rules." });
    } finally {
      setBusy(false);
    }
  }

  async function saveNotes() {
    if (!notes) return;
    setBusy(true);
    try {
      const r = await editTaxDepreciationRuleNotes(notes);
      if (!r.ok) setMessage({ tone: "bad", text: r.error });
      else {
        setNotes(null);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`${adminCard} space-y-4 p-5`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Tax depreciation rules for {country.name}</h2>
          <p className="mt-1 text-2xl font-semibold text-[var(--text-primary)]">{current ? (current.isVerified ? "Verified" : "Not verified") : "Not set"}</p>
          <p className="text-xs text-[var(--text-secondary)]">
            {current ? `In force from ${bothDates(current.effectiveFrom)}. Used only for the tax calculation; it never changes the books or the accounting depreciation.` : "No rules are set, so organizations in this country cannot calculate tax depreciation."}
          </p>
        </div>
        {!form && current && (
          <button type="button" onClick={() => { setMessage(null); setForm({ effectiveFrom: "", source: "", isVerified: false, json: JSON.stringify(current.rules, null, 2) }); }} className={primary}>
            Publish a new version
          </button>
        )}
      </div>

      {current && !current.isVerified && !form && <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">These figures have not been checked against the current Finance Act and Income Tax Act. Confirm them with Verify / source below before organizations rely on them.</p>}
      {message && <p className={`rounded border px-3 py-2 text-sm ${message.tone === "ok" ? "border-green-300 bg-green-50 text-green-800" : "border-red-300 bg-red-50 text-red-700"}`}>{message.text}</p>}

      {form && (
        <div className="space-y-3 rounded border border-[var(--card-border)] p-3">
          <p className="text-sm font-medium text-[var(--text-primary)]">New version of the tax depreciation rules</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-[var(--text-secondary)]">
              Starts on {latest ? `(after ${latest.effectiveFrom})` : ""}
              <input type="date" value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} className={`${adminField} mt-1 w-full`} />
            </label>
            <label className="text-xs text-[var(--text-secondary)]">
              Source (Act, notice or rule)
              <input value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} placeholder="e.g. Finance Act 2083" className={`${adminField} mt-1 w-full`} />
            </label>
          </div>
          <label className="block text-xs text-[var(--text-secondary)]">
            The rules (classes, rates, timing bands, statutory additions, concessions). Change the figures and keep the layout.
            <textarea value={form.json} onChange={(e) => setForm({ ...form, json: e.target.value })} rows={18} spellCheck={false} className={`${adminField} mt-1 w-full font-mono text-xs`} />
          </label>
          <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
            <input type="checkbox" checked={form.isVerified} onChange={(e) => setForm({ ...form, isVerified: e.target.checked })} />
            A reviewer has confirmed these rules against current law
          </label>
          <p className="text-xs text-[var(--text-secondary)]">The earlier rules end the day before. A tax year that has been finalised keeps the rules it used.</p>
          <div className="flex gap-2">
            <button type="button" disabled={busy || !form.effectiveFrom} onClick={save} className={primary}>{busy ? "Publishing…" : "Publish"}</button>
            <button type="button" disabled={busy} onClick={() => setForm(null)} className="rounded border border-gray-300 px-4 py-1.5 text-sm text-gray-700">Cancel</button>
          </div>
        </div>
      )}

      {current && !form && <RulesView rules={current.rules} />}

      {data.versions.length > 0 && (
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-ink-2 [&_th]:whitespace-nowrap [&_th]:border-b [&_th]:border-line [&_th]:bg-app">
            <tr><th className="py-1 pr-2 font-medium">From</th><th className="py-1 pr-2 font-medium">To</th><th className="py-1 pr-2 font-medium">Source</th><th /></tr>
          </thead>
          <tbody>
            {[...data.versions].reverse().map((v) =>
              notes?.id === v.id ? (
                <tr key={v.id} className="border-b border-line align-top">
                  <td colSpan={4} className="space-y-2 py-2">
                    <input value={notes.source} onChange={(e) => setNotes({ ...notes, source: e.target.value })} placeholder="Source" className={`${adminField} w-full`} />
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={notes.isVerified} onChange={(e) => setNotes({ ...notes, isVerified: e.target.checked })} /> Verified against current law
                    </label>
                    <div className="flex gap-2">
                      <button type="button" disabled={busy} onClick={saveNotes} className={primary}>Save</button>
                      <button type="button" onClick={() => setNotes(null)} className="rounded border border-gray-300 px-3 py-1 text-sm text-gray-700">Cancel</button>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr key={v.id} className="border-b border-line align-top transition-colors hover:bg-hover">
                  <td className="py-1.5 pr-2 text-xs">{bothDates(v.effectiveFrom)} {v.inForce && <StatusPill tone="success">in force</StatusPill>}</td>
                  <td className="py-1.5 pr-2 text-xs">{v.effectiveTo ? bothDates(v.effectiveTo) : "—"}</td>
                  <td className="py-1.5 pr-2 text-xs">{v.source ?? "—"} {v.isVerified ? <StatusPill tone="success">verified</StatusPill> : <StatusPill tone="pending">unverified</StatusPill>}</td>
                  <td className="py-1.5 text-right"><button type="button" onClick={() => setNotes({ id: v.id, isVerified: v.isVerified, source: v.source ?? "" })} className="text-xs text-[var(--accent-text)] hover:underline">Verify / source</button></td>
                </tr>
              )
            )}
          </tbody>
        </table>
      )}
    </section>
  );
}
