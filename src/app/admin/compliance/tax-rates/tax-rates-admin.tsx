"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { StatusPill } from "@/components/ui/status-pill";
import { ymdOf, monthNames } from "@/lib/calendar";
import { PUBLISHABLE_TAX_TYPES, type PublishableTaxType, type RateVersion } from "@/lib/compliance/platform-tax-rate-types";
import { adminCard, adminField } from "../../ui";
import { editPublishedRate, publishRate, type TaxRateAdminData } from "./actions";

const pct = (n: number) => `${n.toFixed(2)}%`;
// Dates are stored as real (AD) dates; in Nepal the Bikram Sambat date is what people recognize, so show both.
function bothDates(iso: string | null) {
  if (!iso) return "—";
  const bs = ymdOf("BS", iso);
  return bs ? `${iso} (${bs.day} ${monthNames("BS")[bs.month - 1]} ${bs.year} BS)` : iso;
}

type Draft = { rate: string; effectiveFrom: string; source: string; isVerified: boolean };
const blankDraft: Draft = { rate: "", effectiveFrom: "", source: "", isVerified: false };

export function TaxRatesAdmin({ data }: { data: TaxRateAdminData }) {
  const router = useRouter();
  const [open, setOpen] = useState<PublishableTaxType | null>(null);
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [editing, setEditing] = useState<{ id: string; isVerified: boolean; source: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string; skipped?: { name: string; reason: string }[] } | null>(null);

  if (!data.country || !data.rates) return <p className={`${adminCard} p-5 text-sm text-[var(--text-secondary)]`}>No country is configured yet.</p>;
  const country = data.country;
  const rates = data.rates;

  async function publish(type: PublishableTaxType) {
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

  const versionsOf = (type: PublishableTaxType): RateVersion[] => rates[type];

  return (
    <div className="space-y-5">
      <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
        Country
        <select value={country.code} onChange={(e) => router.push(`/admin/compliance/tax-rates?country=${e.target.value}`)} className={adminField}>
          {data.countries.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

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
        {PUBLISHABLE_TAX_TYPES.map((t) => {
          const versions = versionsOf(t.key);
          const inForce = versions.find((v) => v.inForce) ?? versions[versions.length - 1];
          const latest = versions[versions.length - 1];
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
                    Publish a new rate
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
                      <input type="date" min={latest ? latest.effectiveFrom : undefined} value={draft.effectiveFrom} onChange={(e) => setDraft({ ...draft, effectiveFrom: e.target.value })} className={`${adminField} mt-1 w-full`} />
                    </label>
                  </div>
                  <label className="block text-xs text-[var(--text-secondary)]">
                    Source (optional)
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

              {versions.length > 0 && (
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
                    {[...versions].reverse().map((v) =>
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
                            {pct(v.rate)} {v.inForce && <StatusPill tone="success">in force</StatusPill>}
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

      <section className={`${adminCard} p-5`}>
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">Organizations in {country.name}</h2>
        <p className="mb-3 text-xs text-[var(--text-secondary)]">What each organization is using now. An organization with its own rate can change it itself; one on the published rate cannot.</p>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-[var(--text-secondary)]">
            <tr>
              <th className="py-1 pr-2 font-medium">Organization</th>
              <th className="py-1 pr-2 font-medium">VAT</th>
              <th className="py-1 pr-2 font-medium">TDS</th>
              <th className="py-1 font-medium">Follows published rates</th>
            </tr>
          </thead>
          <tbody>
            {rates.organizations.map((o) => (
              <tr key={o.id} className="border-t border-[var(--card-border)]">
                <td className="py-1.5 pr-2">{o.name}</td>
                {[o.vat, o.tds].map((r, i) => (
                  <td key={i} className="py-1.5 pr-2">
                    {r ? (
                      <>
                        {pct(r.rate)} <span className="text-xs text-[var(--text-secondary)]">{r.source === "platform" ? "published" : "own"}</span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                ))}
                <td className="py-1.5">{o.followsPublished ? <StatusPill tone="success">yes</StatusPill> : <StatusPill tone="action">no</StatusPill>}</td>
              </tr>
            ))}
            {rates.organizations.length === 0 && (
              <tr>
                <td colSpan={4} className="py-4 text-center text-[var(--text-secondary)]">
                  No organizations in this country yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
