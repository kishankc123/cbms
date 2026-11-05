"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { StatusPill } from "@/components/ui/status-pill";
import type { PayrollRules, SchemeKey } from "@/lib/payroll/retirement-rules";
import { adminCard, adminField } from "../../ui";
import { bothDates } from "../tax-rates/tax-rates-admin";
import { editPayrollRuleNotes, publishPayrollRules, type PayrollRulesAdminData } from "./actions";

const TYPES = [
  { key: "full_time", label: "Full time" },
  { key: "part_time", label: "Part time" },
  { key: "contract", label: "Contract" },
  { key: "intern", label: "Intern" },
];
const SCHEMES: { key: SchemeKey; name: string }[] = [
  { key: "ssf", name: "Social Security Fund (SSF)" },
  { key: "pf", name: "Conventional provident fund (PF)" },
];

type LineForm = { key: string; label: string; employeePct: string; employerPct: string };
type SchemeForm = { label: string; lines: LineForm[]; cap: string; types: string[]; sstPossible: boolean };
type Form = { effectiveFrom: string; source: string; isVerified: boolean; schemes: Record<SchemeKey, SchemeForm>; citEmployer: boolean; citCeiling: string; dedNum: string; dedDen: string; dedCap: string; sstBands: string };

// A country with nothing published starts from one empty line per scheme and no limits.
const emptyScheme = (label: string): PayrollRules["schemes"][SchemeKey] => ({ label, basis: "basic", lines: [{ key: "provident_fund", label: "Provident fund", employeePct: 0, employerPct: 0 }], monthlyBasisCap: null, eligibleEmploymentTypes: null, sstExemptionPossible: false });
const EMPTY_RULES: PayrollRules = { schemes: { ssf: emptyScheme("Social Security Fund"), pf: emptyScheme("Provident fund") }, cit: { employerContributionAllowed: true, monthlyCeiling: null }, retirementDeduction: { incomeShare: { num: 1, den: 3 }, annualCap: 0 }, sst: { exemptBands: 0 } };
const text = (n: number | null) => (n === null ? "" : String(n));

function toForm(r: PayrollRules): Form {
  const scheme = (k: SchemeKey): SchemeForm => ({ label: r.schemes[k].label, lines: r.schemes[k].lines.map((l) => ({ key: l.key, label: l.label, employeePct: String(l.employeePct), employerPct: String(l.employerPct) })), cap: text(r.schemes[k].monthlyBasisCap), types: r.schemes[k].eligibleEmploymentTypes ?? TYPES.map((t) => t.key), sstPossible: r.schemes[k].sstExemptionPossible });
  return { effectiveFrom: "", source: "", isVerified: false, schemes: { ssf: scheme("ssf"), pf: scheme("pf") }, citEmployer: r.cit.employerContributionAllowed, citCeiling: text(r.cit.monthlyCeiling), dedNum: String(r.retirementDeduction.incomeShare.num), dedDen: String(r.retirementDeduction.incomeShare.den), dedCap: String(r.retirementDeduction.annualCap), sstBands: String(r.sst.exemptBands) };
}

const emptyOrNumber = (s: string) => (s.trim() === "" ? null : Number(s));
function toRules(f: Form): unknown {
  const scheme = (k: SchemeKey) => ({ label: f.schemes[k].label, basis: "basic", lines: f.schemes[k].lines.map((l) => ({ key: l.key, label: l.label.trim(), employeePct: l.employeePct === "" ? NaN : Number(l.employeePct), employerPct: l.employerPct === "" ? NaN : Number(l.employerPct) })), monthlyBasisCap: emptyOrNumber(f.schemes[k].cap), eligibleEmploymentTypes: f.schemes[k].types.length === TYPES.length ? null : f.schemes[k].types, sstExemptionPossible: f.schemes[k].sstPossible });
  return { schemes: { ssf: scheme("ssf"), pf: scheme("pf") }, cit: { employerContributionAllowed: f.citEmployer, monthlyCeiling: emptyOrNumber(f.citCeiling) }, retirementDeduction: { incomeShare: { num: Number(f.dedNum), den: Number(f.dedDen) }, annualCap: Number(f.dedCap) }, sst: { exemptBands: f.sstBands === "" ? NaN : Number(f.sstBands) } };
}

const primary = "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-accent px-3 py-[5px] text-[13px] font-medium text-[var(--on-accent)] transition-colors hover:bg-accent-hover disabled:pointer-events-none disabled:opacity-50";
const num = `${adminField} w-24`;

/** The rules as stored, read only. */
function RulesView({ rules }: { rules: PayrollRules }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {SCHEMES.map(({ key, name }) => (
        <div key={key}>
          <p className="mb-1 text-xs font-medium text-[var(--text-secondary)]">{name}</p>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-ink-2 [&_th]:border-b [&_th]:border-line [&_th]:bg-app">
              <tr><th className="py-1 pr-2 font-medium">Contribution</th><th className="py-1 pr-2 text-right font-medium">Employee</th><th className="py-1 text-right font-medium">Employer</th></tr>
            </thead>
            <tbody>
              {rules.schemes[key].lines.map((l) => (
                <tr key={l.key} className="border-b border-line">
                  <td className="py-1 pr-2">{l.label}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{l.employeePct}%</td>
                  <td className="py-1 text-right tabular-nums">{l.employerPct}%</td>
                </tr>
              ))}
              <tr className="font-medium">
                <td className="py-1 pr-2">Total</td>
                <td className="py-1 pr-2 text-right tabular-nums">{Math.round(rules.schemes[key].lines.reduce((s, l) => s + l.employeePct, 0) * 100) / 100}%</td>
                <td className="py-1 text-right tabular-nums">{Math.round(rules.schemes[key].lines.reduce((s, l) => s + l.employerPct, 0) * 100) / 100}%</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            On basic salary{rules.schemes[key].monthlyBasisCap !== null ? `, up to ${rules.schemes[key].monthlyBasisCap!.toLocaleString("en-IN")} a month` : ""}. {rules.schemes[key].sstExemptionPossible ? "Can qualify an employee for the first-band exemption." : "No first-band exemption."}
          </p>
        </div>
      ))}
      <p className="text-sm text-[var(--text-secondary)] lg:col-span-2">
        Retirement savings reduce taxable income by the least of the actual amount, {rules.retirementDeduction.incomeShare.num}/{rules.retirementDeduction.incomeShare.den} of assessable income and {rules.retirementDeduction.annualCap.toLocaleString("en-IN")} a year. CIT: {rules.cit.employerContributionAllowed ? "employer contribution allowed" : "no employer contribution"}, {rules.cit.monthlyCeiling === null ? "no monthly ceiling" : `ceiling ${rules.cit.monthlyCeiling.toLocaleString("en-IN")} a month`}. First-band exemption waives the lowest {rules.sst.exemptBands} slab{rules.sst.exemptBands === 1 ? "" : "s"}.
      </p>
    </div>
  );
}

function SchemeEditor({ name, value, onChange }: { name: string; value: SchemeForm; onChange: (v: SchemeForm) => void }) {
  const setLine = (i: number, patch: Partial<LineForm>) => onChange({ ...value, lines: value.lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)) });
  const used = new Set(value.lines.map((l) => l.key));
  const add = () => {
    let key = "line", n = 1;
    while (used.has(key)) key = `line_${++n}`;
    onChange({ ...value, lines: [...value.lines, { key, label: "", employeePct: "0", employerPct: "0" }] });
  };
  return (
    <div className="space-y-2 rounded border border-[var(--card-border)] p-3">
      <p className="text-sm font-medium text-[var(--text-primary)]">{name}</p>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-ink-2 [&_th]:border-b [&_th]:border-line [&_th]:bg-app">
          <tr><th className="py-1 pr-2 font-medium">Contribution</th><th className="py-1 pr-2 font-medium">Employee %</th><th className="py-1 pr-2 font-medium">Employer %</th><th /></tr>
        </thead>
        <tbody>
          {value.lines.map((l, i) => (
            <tr key={l.key} className="border-t border-[var(--card-border)]">
              <td className="py-1 pr-2"><input value={l.label} onChange={(e) => setLine(i, { label: e.target.value })} placeholder="e.g. Gratuity" className={`${adminField} w-full`} /></td>
              <td className="py-1 pr-2"><input type="number" min="0" max="100" step="0.01" value={l.employeePct} onChange={(e) => setLine(i, { employeePct: e.target.value })} className={num} /></td>
              <td className="py-1 pr-2"><input type="number" min="0" max="100" step="0.01" value={l.employerPct} onChange={(e) => setLine(i, { employerPct: e.target.value })} className={num} /></td>
              <td className="py-1 text-right">{value.lines.length > 1 && <button type="button" onClick={() => onChange({ ...value, lines: value.lines.filter((_, idx) => idx !== i) })} className="text-xs text-red-600 hover:underline">Remove</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" onClick={() => { add(); }} className="text-xs text-[var(--accent-text)] hover:underline">+ Add contribution</button>
      <label className="block text-xs text-[var(--text-secondary)]">
        Most basic salary counted in a month (leave empty for no limit)
        <input type="number" min="0" value={value.cap} onChange={(e) => onChange({ ...value, cap: e.target.value })} className={`${adminField} mt-1 block w-40`} />
      </label>
      <fieldset className="text-xs text-[var(--text-secondary)]">
        <legend className="mb-1">Employment types that qualify (others get a warning, not a block)</legend>
        <div className="flex flex-wrap gap-3">
          {TYPES.map((t) => (
            <label key={t.key} className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={value.types.includes(t.key)} onChange={(e) => onChange({ ...value, types: e.target.checked ? [...value.types, t.key] : value.types.filter((x) => x !== t.key) })} />
              {t.label}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
        <input type="checkbox" checked={value.sstPossible} onChange={(e) => onChange({ ...value, sstPossible: e.target.checked })} />
        Joining this scheme can qualify an employee for the first-band (SST) exemption
      </label>
    </div>
  );
}

export function PayrollRulesAdmin({ data }: { data: PayrollRulesAdminData }) {
  const router = useRouter();
  const [form, setForm] = useState<Form | null>(null);
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
      const r = await publishPayrollRules({ countryCode: country.code, effectiveFrom: form.effectiveFrom, rules: toRules(form), isVerified: form.isVerified, source: form.source });
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
      const r = await editPayrollRuleNotes(notes);
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
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Payroll rules for {country.name}</h2>
          <p className="mt-1 text-2xl font-semibold text-[var(--text-primary)]">{current ? (current.isVerified ? "Verified" : "Not verified") : "Not set"}</p>
          <p className="text-xs text-[var(--text-secondary)]">
            {current ? `In force from ${bothDates(current.effectiveFrom)}. Organizations with an employee on a scheme use these rates. Salary tax slabs are set under Tax & rates → TDS → Payroll.` : "No rules are set. Employees cannot be put on a retirement scheme until they are."}
          </p>
        </div>
        {!form && (
          <button type="button" onClick={() => { setMessage(null); setForm(current ? toForm(current.rules) : toForm(EMPTY_RULES)); }} className={primary}>
            {current ? "Publish a new version" : "Set the rules"}
          </button>
        )}
      </div>

      {current && !current.isVerified && !form && <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">These figures have not been checked against current law (Finance Act, Income Tax Act, SSF rules). Confirm them with Verify / source below before relying on them.</p>}
      {message && <p className={`rounded border px-3 py-2 text-sm ${message.tone === "ok" ? "border-green-300 bg-green-50 text-green-800" : "border-red-300 bg-red-50 text-red-700"}`}>{message.text}</p>}

      {form && (
        <div className="space-y-3 rounded border border-[var(--card-border)] p-3">
          <p className="text-sm font-medium text-[var(--text-primary)]">New version of the payroll rules</p>
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
          <div className="grid gap-3 lg:grid-cols-2">
            {SCHEMES.map(({ key, name }) => (
              <SchemeEditor key={key} name={name} value={form.schemes[key]} onChange={(v) => setForm({ ...form, schemes: { ...form.schemes, [key]: v } })} />
            ))}
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            <div className="space-y-2 rounded border border-[var(--card-border)] p-3">
              <p className="text-sm font-medium text-[var(--text-primary)]">Retirement savings deduction</p>
              <p className="text-xs text-[var(--text-secondary)]">Taxable income is reduced by the least of the actual amount, this share of assessable income, and the yearly cap.</p>
              <div className="flex items-center gap-2 text-sm">
                <input type="number" min="1" value={form.dedNum} onChange={(e) => setForm({ ...form, dedNum: e.target.value })} className={`${adminField} w-16`} /> in
                <input type="number" min="1" value={form.dedDen} onChange={(e) => setForm({ ...form, dedDen: e.target.value })} className={`${adminField} w-16`} />
              </div>
              <label className="block text-xs text-[var(--text-secondary)]">
                Yearly cap
                <input type="number" min="0" value={form.dedCap} onChange={(e) => setForm({ ...form, dedCap: e.target.value })} className={`${adminField} mt-1 block w-40`} />
              </label>
            </div>
            <div className="space-y-2 rounded border border-[var(--card-border)] p-3">
              <p className="text-sm font-medium text-[var(--text-primary)]">CIT</p>
              <p className="text-xs text-[var(--text-secondary)]">No fixed rate: each employee chooses what they pay.</p>
              <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                <input type="checkbox" checked={form.citEmployer} onChange={(e) => setForm({ ...form, citEmployer: e.target.checked })} /> Employer may contribute
              </label>
              <label className="block text-xs text-[var(--text-secondary)]">
                Monthly ceiling (empty for none)
                <input type="number" min="0" value={form.citCeiling} onChange={(e) => setForm({ ...form, citCeiling: e.target.value })} className={`${adminField} mt-1 block w-40`} />
              </label>
            </div>
            <div className="space-y-2 rounded border border-[var(--card-border)] p-3">
              <p className="text-sm font-medium text-[var(--text-primary)]">First-band exemption</p>
              <p className="text-xs text-[var(--text-secondary)]">How many of the lowest salary slabs are waived for an employee confirmed eligible (the social security band is the first). 0 for none.</p>
              <input type="number" min="0" step="1" value={form.sstBands} onChange={(e) => setForm({ ...form, sstBands: e.target.value })} className={num} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
            <input type="checkbox" checked={form.isVerified} onChange={(e) => setForm({ ...form, isVerified: e.target.checked })} />
            A reviewer has confirmed these rules against current law
          </label>
          <p className="text-xs text-[var(--text-secondary)]">Payroll uses these rules from the start date. The earlier rules end the day before, and finished payroll is not changed.</p>
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
