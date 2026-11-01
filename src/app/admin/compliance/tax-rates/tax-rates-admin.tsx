"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { StatusPill } from "@/components/ui/status-pill";
import { ymdOf, monthNames } from "@/lib/calendar";
import type { FiscalYear, RateVersion } from "@/lib/compliance/platform-tax-rate-types";
import { adminCard, adminField } from "../../ui";
import { confirmDraft, editPublishedRate, publishRate, type TaxRateAdminData } from "./actions";

const pct = (n: number) => `${n.toFixed(2)}%`;
// Dates are stored as real (AD) dates; in Nepal the Bikram Sambat date is what people recognize, so show both.
function bothDates(iso: string | null) {
  if (!iso) return "—";
  const bs = ymdOf("BS", iso);
  return bs ? `${iso} (${bs.day} ${monthNames("BS")[bs.month - 1]} ${bs.year} BS)` : iso;
}

type Draft = { rate: string; effectiveFrom: string; source: string; isVerified: boolean };
const blankDraft: Draft = { rate: "", effectiveFrom: "", source: "", isVerified: false };

/**
 * `only` limits the cards to some taxes; `organizations` is the table of what each organization is using. With `fiscalYear` the cards show
 * that year's versions (v1, v2...), its carried-forward rates waiting for confirmation, and publish only inside that year.
 */
export function TaxRatesAdmin({ data, only, organizations = true, fiscalYear }: { data: TaxRateAdminData; only?: string[]; organizations?: boolean; fiscalYear?: FiscalYear }) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [editing, setEditing] = useState<{ id: string; isVerified: boolean; source: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<Record<string, { rate: string; effectiveFrom: string }>>({});
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string; skipped?: { name: string; reason: string }[] } | null>(null);

  if (!data.country || !data.rates) return <p className={`${adminCard} p-5 text-sm text-[var(--text-secondary)]`}>No country is configured yet.</p>;
  const country = data.country;
  const rates = data.rates;

  async function publish(type: string) {
    setBusy(true);
    setMessage(null);
    try {
      const r = await publishRate({ countryCode: country.code, taxTypeKey: type, rate: Number(draft.rate), effectiveFrom: draft.effectiveFrom, isVerified: draft.isVerified, source: draft.source });
      if (!r.ok) {
        setMessage({ tone: "bad", text: r.error });
        return;
      }
      setMessage({ tone: "ok", text: `Published. It is now the rate in ${r.organizationsUpdated} organization${r.organizationsUpdated === 1 ? "" : "s"}.`, skipped: r.skipped });
      setOpen(null);
      setDraft(blankDraft);
      router.refresh();
    } catch (e) {
      setMessage({ tone: "bad", text: e instanceof Error ? e.message : "Could not publish the rate." });
    } finally {
      setBusy(false);
    }
  }

  async function confirm(draftId: string, d: { rate: string; effectiveFrom: string }) {
    setBusy(true);
    setMessage(null);
    try {
      const r = await confirmDraft({ draftId, rate: Number(d.rate), effectiveFrom: d.effectiveFrom, source: "Carried forward and confirmed", isVerified: false });
      if (!r.ok) setMessage({ tone: "bad", text: r.error });
      else {
        setMessage({ tone: "ok", text: `Confirmed and published. It is now the rate in ${r.organizationsUpdated} organization${r.organizationsUpdated === 1 ? "" : "s"} from ${d.effectiveFrom}.`, skipped: r.skipped });
        router.refresh();
      }
    } catch (e) {
      setMessage({ tone: "bad", text: e instanceof Error ? e.message : "Could not confirm the rate." });
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit() {
    if (!editing) return;
    setBusy(true);
    setMessage(null);
    try {
      const r = await editPublishedRate(editing);
      if (!r.ok) setMessage({ tone: "bad", text: r.error });
      else {
        setEditing(null);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  const versionsOf = (type: string): RateVersion[] => rates.versions[type] ?? [];
  const inYear = (v: RateVersion) => !fiscalYear || (v.effectiveFrom >= fiscalYear.from && v.effectiveFrom <= fiscalYear.to);
  const shownTypes = rates.types.filter((t) => !only || only.includes(t.key));

  return (
    <div className="space-y-5">
      {message && (
        <div className={`rounded border px-3 py-2 text-sm ${message.tone === "ok" ? "border-green-300 bg-green-50 text-green-800" : "border-red-300 bg-red-50 text-red-700"}`}>
          <p>{message.text}</p>
          {message.skipped && message.skipped.length > 0 && (
            <div className="mt-1 text-amber-800">
              <p>Left unchanged, because they already have a later rate of their own:</p>
              <ul className="list-disc pl-5">
                {message.skipped.map((s) => (
                  <li key={s.name}>
                    {s.name}: {s.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {shownTypes.map((t) => {
          const versions = versionsOf(t.key);
          const inForce = versions.find((v) => v.inForce) ?? versions[versions.length - 1];
          const latest = versions[versions.length - 1];
          const shown = versions.filter(inYear);
          const carried = fiscalYear && shown.length === 0 ? versions.filter((v) => v.effectiveFrom < fiscalYear.from).pop() : undefined;
          const draftOf = fiscalYear ? data.drafts.find((d) => d.taxTypeKey === t.key && d.effectiveFrom === fiscalYear.from) : undefined;
          const edited = draftOf ? { rate: confirming[t.key]?.rate ?? String(draftOf.rate), effectiveFrom: confirming[t.key]?.effectiveFrom ?? draftOf.effectiveFrom } : null;
          return (
            <section key={t.key} className={`${adminCard} space-y-3 p-5`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-[var(--text-primary)]">{t.label}</h2>
                  <p className="mt-1 text-2xl font-semibold text-[var(--text-primary)]">{inForce ? pct(inForce.rate) : "Not published"}</p>
                  <p className="text-xs text-[var(--text-secondary)]">{inForce ? `In force since ${bothDates(inForce.effectiveFrom)}` : "Organizations are using their own rate."}</p>
                </div>
                {open !== t.key && (
                  <button type="button" onClick={() => { setOpen(t.key); setDraft(blankDraft); setMessage(null); }} className="rounded bg-[var(--color-primary)] px-3 py-1.5 text-sm text-white hover:bg-[var(--color-primary-hover)]">
                    {fiscalYear ? `Publish v${shown.length + 1}` : "Publish a new rate"}
                  </button>
                )}
              </div>

              {open === t.key && (
                <div className="space-y-3 rounded border border-[var(--card-border)] p-3">
                  <div className="grid grid-cols-2 gap-3">
                    <label className="text-xs text-[var(--text-secondary)]">
                      New rate (%)
                      <input type="number" step="0.01" min="0" max="100" value={draft.rate} onChange={(e) => setDraft({ ...draft, rate: e.target.value })} className={`${adminField} mt-1 w-full`} />
                    </label>
                    <label className="text-xs text-[var(--text-secondary)]">
                      Starts on
                      <input type="date" min={fiscalYear && (!latest || fiscalYear.from > latest.effectiveFrom) ? fiscalYear.from : latest?.effectiveFrom} max={fiscalYear?.to} value={draft.effectiveFrom} onChange={(e) => setDraft({ ...draft, effectiveFrom: e.target.value })} className={`${adminField} mt-1 w-full`} />
                    </label>
                  </div>
                  <label className="block text-xs text-[var(--text-secondary)]">
                    {fiscalYear ? "Reason or source (optional)" : "Source (optional)"}
                    <input value={draft.source} onChange={(e) => setDraft({ ...draft, source: e.target.value })} placeholder="e.g. Finance Act 2083" className={`${adminField} mt-1 w-full`} />
                  </label>
                  <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                    <input type="checkbox" checked={draft.isVerified} onChange={(e) => setDraft({ ...draft, isVerified: e.target.checked })} />
                    A reviewer has confirmed this rate against current law
                  </label>
                  <p className="text-xs text-[var(--text-secondary)]">
                    This changes the {t.label} rate in every organization in {country.name} from that date. An organization that already has a later rate of its own is left alone and listed.
                    {latest ? ` It has to start after ${latest.effectiveFrom}.` : ""}
                  </p>
                  <div className="flex gap-2">
                    <button type="button" disabled={busy || !draft.rate || !draft.effectiveFrom} onClick={() => publish(t.key)} className="rounded bg-[var(--color-primary)] px-4 py-1.5 text-sm text-white disabled:opacity-50">
                      {busy ? "Publishing…" : "Publish"}
                    </button>
                    <button type="button" disabled={busy} onClick={() => setOpen(null)} className="rounded border border-gray-300 px-4 py-1.5 text-sm text-gray-700">
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {draftOf && edited && (
                <div className="space-y-2 rounded border border-amber-300 bg-amber-50 p-3">
                  <div className="flex items-center gap-2 text-sm text-amber-900">
                    <StatusPill tone="pending">Needs confirmation</StatusPill>
                    <span>Carried forward from the previous year. Until you confirm, the earlier rate keeps applying.</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="text-xs text-[var(--text-secondary)]">
                      Rate (%)
                      <input type="number" step="0.01" min="0" max="100" value={edited.rate} onChange={(e) => setConfirming({ ...confirming, [t.key]: { ...edited, rate: e.target.value } })} className={`${adminField} mt-1 w-full`} />
                    </label>
                    <label className="text-xs text-[var(--text-secondary)]">
                      Starts on
                      <input type="date" min={fiscalYear?.from} max={fiscalYear?.to} value={edited.effectiveFrom} onChange={(e) => setConfirming({ ...confirming, [t.key]: { ...edited, effectiveFrom: e.target.value } })} className={`${adminField} mt-1 w-full`} />
                    </label>
                  </div>
                  <button type="button" disabled={busy} onClick={() => confirm(draftOf.id, edited)} className="rounded bg-[var(--color-primary)] px-4 py-1.5 text-sm text-white disabled:opacity-50">
                    {busy ? "Publishing…" : "Confirm and publish"}
                  </button>
                </div>
              )}

              {fiscalYear && shown.length === 0 && !draftOf && <p className="text-sm text-[var(--text-secondary)]">{carried ? `No version starts in ${fiscalYear?.label}. ${pct(carried.rate)} (v${carried.version} of ${carried.fiscalYear}) continues.` : `Nothing is published for ${fiscalYear?.label} yet.`}</p>}

              {shown.length > 0 && (
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-[var(--text-secondary)]">
                    <tr>
                      <th className="py-1 pr-2 font-medium">Rate</th>
                      <th className="py-1 pr-2 font-medium">From</th>
                      <th className="py-1 pr-2 font-medium">To</th>
                      <th className="py-1 pr-2 font-medium">Source</th>
                      <th className="py-1 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...shown].reverse().map((v) =>
                      editing?.id === v.id ? (
                        <tr key={v.id} className="border-t border-[var(--card-border)] align-top">
                          <td colSpan={5} className="space-y-2 py-2">
                            <input value={editing.source} onChange={(e) => setEditing({ ...editing, source: e.target.value })} placeholder="Source" className={`${adminField} w-full`} />
                            <label className="flex items-center gap-2 text-sm">
                              <input type="checkbox" checked={editing.isVerified} onChange={(e) => setEditing({ ...editing, isVerified: e.target.checked })} /> Verified against current law
                            </label>
                            <div className="flex gap-2">
                              <button type="button" disabled={busy} onClick={saveEdit} className="rounded bg-[var(--color-primary)] px-3 py-1 text-sm text-white disabled:opacity-50">
                                Save
                              </button>
                              <button type="button" onClick={() => setEditing(null)} className="rounded border border-gray-300 px-3 py-1 text-sm text-gray-700">
                                Cancel
                              </button>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        <tr key={v.id} className="border-t border-[var(--card-border)] align-top">
                          <td className="py-1.5 pr-2 font-medium">
                            {fiscalYear && <span className="mr-2 text-xs text-[var(--text-secondary)]">v{v.version}</span>}{pct(v.rate)} {v.inForce && <StatusPill tone="success">in force</StatusPill>}
                          </td>
                          <td className="py-1.5 pr-2 text-xs">{bothDates(v.effectiveFrom)}</td>
                          <td className="py-1.5 pr-2 text-xs">{v.effectiveTo ? bothDates(v.effectiveTo) : "—"}</td>
                          <td className="py-1.5 pr-2 text-xs">
                            {v.source ?? "—"} {v.isVerified ? <StatusPill tone="success">verified</StatusPill> : <StatusPill tone="pending">unverified</StatusPill>}
                          </td>
                          <td className="py-1.5 text-right">
                            <button type="button" onClick={() => setEditing({ id: v.id, isVerified: v.isVerified, source: v.source ?? "" })} className="text-xs text-[var(--color-primary)] hover:underline">
                              Edit
                            </button>
                          </td>
                        </tr>
                      )
                    )}
                  </tbody>
                </table>
              )}
            </section>
          );
        })}
      </div>

      {organizations && (
      <section className={`${adminCard} p-5`}>
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">Organizations in {country.name}</h2>
        <p className="mb-3 text-xs text-[var(--text-secondary)]">What each organization is using now. Only you can change a rate. An organization marked own was set before rates were published, and keeps it until you publish a rate for it.</p>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-[var(--text-secondary)]">
            <tr>
              <th className="py-1 pr-2 font-medium">Organization</th>
              {shownTypes.map((t) => (
                <th key={t.key} className="py-1 pr-2 font-medium">
                  {t.label}
                </th>
              ))}
              <th className="py-1 font-medium">Follows published rates</th>
            </tr>
          </thead>
          <tbody>
            {rates.organizations.map((o) => (
              <tr key={o.id} className="border-t border-[var(--card-border)]">
                <td className="py-1.5 pr-2">{o.name}</td>
                {shownTypes.map((t) => {
                  const r = o.rates[t.key];
                  return (
                    <td key={t.key} className="py-1.5 pr-2">
                      {r ? (
                        <>
                          {pct(r.rate)} <span className="text-xs text-[var(--text-secondary)]">{r.source === "platform" ? "published" : "own"}</span>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                  );
                })}
                <td className="py-1.5">{o.followsPublished ? <StatusPill tone="success">yes</StatusPill> : <StatusPill tone="action">no</StatusPill>}</td>
              </tr>
            ))}
            {rates.organizations.length === 0 && (
              <tr>
                <td colSpan={shownTypes.length + 2} className="py-4 text-center text-[var(--text-secondary)]">
                  No organizations in this country yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
      )}
    </div>
  );
}
