"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { StatusPill } from "@/components/ui/status-pill";
import { blankDueRuleForm, describeCondition, describeDueRule, dueRuleToForm, formToDueRule, KNOWN_FACTS, parseApplicability, PERIOD_OPTIONS, type DueRuleForm } from "@/lib/compliance/template-rules";
import type { TemplateRow } from "@/lib/compliance/template-admin";
import { adminCard, adminField } from "../../ui";
import { saveTemplate, type TemplateAdminData } from "./actions";

type Draft = {
  name: string;
  description: string;
  isActive: boolean;
  isVerified: boolean;
  activeFrom: string;
  activeTo: string;
  due: DueRuleForm;
  applicabilityText: string;
  moveOpenItems: boolean;
};

const draftOf = (t: TemplateRow): Draft => ({
  name: t.name,
  description: t.description ?? "",
  isActive: t.isActive,
  isVerified: t.isVerified,
  activeFrom: t.activeFrom ?? "",
  activeTo: t.activeTo ?? "",
  due: t.dueRule ? dueRuleToForm(t.dueRule) : t.frequency === "event_based" ? { ...blankDueRuleForm(), period: "event", mode: "days" } : blankDueRuleForm(),
  applicabilityText: t.applicability ? JSON.stringify(t.applicability, null, 2) : "",
  moveOpenItems: false,
});

export function TemplatesAdmin({ data }: { data: TemplateAdminData }) {
  const router = useRouter();
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  const categories = useMemo(() => Array.from(new Map(data.templates.map((t) => [t.categoryKey, t.categoryName])).entries()), [data.templates]);
  const shown = data.templates.filter((t) => (category === "all" || t.categoryKey === category) && (!search.trim() || (t.name + " " + t.key).toLowerCase().includes(search.trim().toLowerCase())));

  if (!data.country) return <p className={`${adminCard} p-5 text-sm text-[var(--text-secondary)]`}>No country is configured yet.</p>;
  const country = data.country;

  function open(t: TemplateRow) {
    setOpenId(t.id);
    setDraft(draftOf(t));
    setMessage(null);
  }

  async function save(t: TemplateRow) {
    if (!draft) return;
    setMessage(null);
    // The due date: an event-based requirement may have none (a blank number of days).
    let dueRule = null;
    if (!(t.frequency === "event_based" && !draft.due.daysAfterEnd.trim())) {
      const r = formToDueRule(t.frequency === "event_based" ? { ...draft.due, period: "event", mode: "days" } : draft.due);
      if (!r.ok) return setMessage({ tone: "bad", text: r.error });
      dueRule = r.rule;
    }
    setBusy(true);
    try {
      const r = await saveTemplate({
        id: t.id,
        name: draft.name,
        description: draft.description,
        isActive: draft.isActive,
        isVerified: draft.isVerified,
        activeFrom: draft.activeFrom,
        activeTo: draft.activeTo,
        dueRule,
        applicabilityText: draft.applicabilityText,
        moveOpenItems: draft.moveOpenItems,
      });
      if (!r.ok) return setMessage({ tone: "bad", text: r.error });
      setMessage({ tone: "ok", text: r.changes.length === 0 ? "Nothing was changed." : `Saved: ${r.changes.map((c) => c.field).join(", ")}.${r.movedItems > 0 ? ` ${r.movedItems} open item${r.movedItems === 1 ? "" : "s"} moved to the new due date.` : ""}` });
      if (r.changes.length > 0) {
        setOpenId(null);
        setDraft(null);
        router.refresh();
      }
    } catch (e) {
      setMessage({ tone: "bad", text: e instanceof Error ? e.message : "Could not save." });
    } finally {
      setBusy(false);
    }
  }

  const duePreview = (t: TemplateRow) => {
    if (!draft) return "";
    if (t.frequency === "event_based" && !draft.due.daysAfterEnd.trim()) return describeDueRule(null);
    const r = formToDueRule(t.frequency === "event_based" ? { ...draft.due, period: "event", mode: "days" } : draft.due);
    return r.ok ? describeDueRule(r.rule) : r.error;
  };
  const applicabilityPreview = () => {
    if (!draft) return "";
    const p = parseApplicability(draft.applicabilityText);
    return p.ok ? describeCondition(p.condition) : p.error;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
          Country
          <select value={country.code} onChange={(e) => router.push(`/admin/compliance/templates?country=${e.target.value}`)} className={adminField}>
            {data.countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
          Category
          <select value={category} onChange={(e) => setCategory(e.target.value)} className={adminField}>
            <option value="all">All</option>
            {categories.map(([key, name]) => (
              <option key={key} value={key}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search requirements…" className={`${adminField} w-64`} />
      </div>

      {message && openId === null && <p className={`rounded border px-3 py-2 text-sm ${message.tone === "ok" ? "border-green-300 bg-green-50 text-green-800" : "border-red-300 bg-red-50 text-red-700"}`}>{message.text}</p>}

      <div className="space-y-3">
        {shown.map((t) => (
          <section key={t.id} className={`${adminCard} p-4`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-[var(--text-primary)]">
                  {t.name} <span className="font-mono text-xs text-[var(--text-secondary)]">{t.key}</span>
                </p>
                <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                  {t.categoryName}
                  {t.taxTypeName ? ` · ${t.taxTypeName}` : ""} · {t.frequency.replace("_", " ")}
                  {t.entityTypeName ? ` · only ${t.entityTypeName}` : ""} · {t.generatedItems} item{t.generatedItems === 1 ? "" : "s"} generated
                </p>
                <p className="mt-1 text-sm text-[var(--text-primary)]">
                  <span className="text-[var(--text-secondary)]">Due: </span>
                  {t.dueRuleText}
                </p>
                <p className="text-sm text-[var(--text-primary)]">
                  <span className="text-[var(--text-secondary)]">Applies to: </span>
                  {t.applicabilityText}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <StatusPill tone={t.isActive ? "success" : "pending"}>{t.isActive ? "active" : "inactive"}</StatusPill>
                <StatusPill tone={t.isVerified ? "success" : "action"}>{t.isVerified ? "verified" : "unverified"}</StatusPill>
                {openId !== t.id && (
                  <button type="button" onClick={() => open(t)} className="rounded border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50">
                    Edit
                  </button>
                )}
              </div>
            </div>

            {openId === t.id && draft && (
              <div className="mt-4 space-y-4 border-t border-[var(--card-border)] pt-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-xs text-[var(--text-secondary)]">
                    Name
                    <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={`${adminField} mt-1 w-full`} />
                  </label>
                  <label className="text-xs text-[var(--text-secondary)]">
                    Description
                    <input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} className={`${adminField} mt-1 w-full`} />
                  </label>
                  <label className="text-xs text-[var(--text-secondary)]">
                    Active from (optional)
                    <input type="date" value={draft.activeFrom} onChange={(e) => setDraft({ ...draft, activeFrom: e.target.value })} className={`${adminField} mt-1 w-full`} />
                  </label>
                  <label className="text-xs text-[var(--text-secondary)]">
                    Active to (optional)
                    <input type="date" value={draft.activeTo} onChange={(e) => setDraft({ ...draft, activeTo: e.target.value })} className={`${adminField} mt-1 w-full`} />
                  </label>
                </div>

                <div className="space-y-2 rounded border border-[var(--card-border)] p-3">
                  <p className="text-sm font-medium text-[var(--text-primary)]">When it is due</p>
                  {t.frequency === "event_based" ? (
                    <label className="block text-xs text-[var(--text-secondary)]">
                      Days after the event (leave blank for no due date)
                      <input value={draft.due.daysAfterEnd} onChange={(e) => setDraft({ ...draft, due: { ...draft.due, period: "event", mode: "days", daysAfterEnd: e.target.value } })} className={`${adminField} mt-1 w-32`} />
                    </label>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-end gap-3">
                        <label className="text-xs text-[var(--text-secondary)]">
                          Repeats
                          <select value={draft.due.period} onChange={(e) => setDraft({ ...draft, due: { ...draft.due, period: e.target.value as DueRuleForm["period"] } })} className={`${adminField} mt-1 block`}>
                            {PERIOD_OPTIONS.filter((p) => p.value !== "event").map((p) => (
                              <option key={p.value} value={p.value}>
                                {p.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="text-xs text-[var(--text-secondary)]">
                          Due
                          <select value={draft.due.mode} onChange={(e) => setDraft({ ...draft, due: { ...draft.due, mode: e.target.value as DueRuleForm["mode"] } })} className={`${adminField} mt-1 block`}>
                            <option value="day">On a day of a later month</option>
                            <option value="days">A number of days after it ends</option>
                          </select>
                        </label>
                        {draft.due.mode === "day" ? (
                          <>
                            <label className="text-xs text-[var(--text-secondary)]">
                              Months after it ends
                              <input value={draft.due.monthsAfterEnd} onChange={(e) => setDraft({ ...draft, due: { ...draft.due, monthsAfterEnd: e.target.value } })} className={`${adminField} mt-1 block w-24`} />
                            </label>
                            <label className="text-xs text-[var(--text-secondary)]">
                              On day (1–32, or last)
                              <input value={draft.due.dayOfMonth} onChange={(e) => setDraft({ ...draft, due: { ...draft.due, dayOfMonth: e.target.value } })} className={`${adminField} mt-1 block w-28`} />
                            </label>
                          </>
                        ) : (
                          <label className="text-xs text-[var(--text-secondary)]">
                            Days after
                            <input value={draft.due.daysAfterEnd} onChange={(e) => setDraft({ ...draft, due: { ...draft.due, daysAfterEnd: e.target.value } })} className={`${adminField} mt-1 block w-24`} />
                          </label>
                        )}
                      </div>
                    </>
                  )}
                  <p className="text-sm text-[var(--text-primary)]">→ {duePreview(t)}</p>
                  {JSON.stringify(t.dueRule ?? null) !== "null" && describeDueRule(t.dueRule) !== duePreview(t) && (
                    <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                      <input type="checkbox" checked={draft.moveOpenItems} onChange={(e) => setDraft({ ...draft, moveOpenItems: e.target.checked })} />
                      Also move the due dates of items that are not filed yet. Filed items never move.
                    </label>
                  )}
                </div>

                <div className="space-y-2 rounded border border-[var(--card-border)] p-3">
                  <p className="text-sm font-medium text-[var(--text-primary)]">Who it applies to</p>
                  <textarea
                    value={draft.applicabilityText}
                    onChange={(e) => setDraft({ ...draft, applicabilityText: e.target.value })}
                    rows={5}
                    placeholder="Empty means every organization"
                    className={`${adminField} w-full font-mono text-xs`}
                  />
                  <p className="text-sm text-[var(--text-primary)]">→ {applicabilityPreview()}</p>
                  <details className="text-xs text-[var(--text-secondary)]">
                    <summary className="cursor-pointer">How to write a condition</summary>
                    <p className="mt-1">
                      One test is <code>{`{"fact":"has_employees","op":"eq","value":true}`}</code>. Combine tests with <code>{`{"all":[…]}`}</code> (every one), <code>{`{"any":[…]}`}</code> (at least one) or <code>{`{"not":{…}}`}</code>. Operators: eq, neq, in, includes, gt, gte, lt, lte.
                    </p>
                    <ul className="mt-1 list-disc pl-5">
                      {KNOWN_FACTS.map((f) => (
                        <li key={f.fact}>
                          <code>{f.fact}</code>: {f.help}
                        </li>
                      ))}
                    </ul>
                  </details>
                </div>

                <div className="flex flex-wrap items-center gap-5">
                  <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                    <input type="checkbox" checked={draft.isActive} onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })} /> Active (organizations get items from it)
                  </label>
                  <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                    <input type="checkbox" checked={draft.isVerified} onChange={(e) => setDraft({ ...draft, isVerified: e.target.checked })} /> A reviewer has confirmed it against current law
                  </label>
                </div>

                {message && <p className={`rounded border px-3 py-2 text-sm ${message.tone === "ok" ? "border-green-300 bg-green-50 text-green-800" : "border-red-300 bg-red-50 text-red-700"}`}>{message.text}</p>}
                <div className="flex gap-2">
                  <button type="button" disabled={busy} onClick={() => save(t)} className="rounded bg-[var(--color-primary)] px-4 py-1.5 text-sm text-white disabled:opacity-50">
                    {busy ? "Saving…" : "Save"}
                  </button>
                  <button type="button" disabled={busy} onClick={() => { setOpenId(null); setDraft(null); setMessage(null); }} className="rounded border border-gray-300 px-4 py-1.5 text-sm text-gray-700">
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </section>
        ))}
        {shown.length === 0 && <p className={`${adminCard} p-5 text-center text-sm text-[var(--text-secondary)]`}>No requirements match.</p>}
      </div>
    </div>
  );
}
