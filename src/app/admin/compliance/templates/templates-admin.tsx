"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { StatusPill } from "@/components/ui/status-pill";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { blankDueRuleForm, describeCondition, describeDueRule, dueRuleToForm, formToDueRule, PERIOD_OPTIONS, type DueRuleForm } from "@/lib/compliance/template-rules";
import type { NewTemplateInput, TemplateRow } from "@/lib/compliance/template-admin";
import { appliesProblem, appliesToCondition, conditionToApplies, EVERYONE, type Applies } from "@/lib/compliance/applicability-form";
import { NOT_TAXES } from "@/lib/compliance/config-tabs";
import { ApplicabilityEditor } from "./applicability-editor";
import { adminCard, adminField } from "../../ui";
import { addTemplate, saveTemplate, type TemplateAdminData } from "./actions";

type Draft = {
  name: string;
  description: string;
  isActive: boolean;
  isVerified: boolean;
  activeFrom: string;
  activeTo: string;
  due: DueRuleForm;
  /** The conditions as plain choices; null for a rule too detailed for them, which is then kept as `original`. */
  applies: Applies | null;
  original: unknown;
  moveOpenItems: boolean;
};

const appliesText = (d: Draft) => {
  const condition = d.applies ? appliesToCondition(d.applies) : d.original;
  return condition ? JSON.stringify(condition) : "";
};

const draftOf = (t: TemplateRow): Draft => ({
  name: t.name,
  description: t.description ?? "",
  isActive: t.isActive,
  isVerified: t.isVerified,
  activeFrom: t.activeFrom ?? "",
  activeTo: t.activeTo ?? "",
  due: t.dueRule ? dueRuleToForm(t.dueRule) : t.frequency === "event_based" ? { ...blankDueRuleForm(), period: "event", mode: "days" } : blankDueRuleForm(),
  applies: conditionToApplies(t.applicability),
  original: t.applicability,
  moveOpenItems: false,
});

/**
 * `categoryKeys`: only requirements in these categories. `taxKey`: only the ones for that tax. `exceptTaxKeys`: leave out the
 * ones for those taxes (what is left over once each tax has shown its own). `addable` shows the "Add requirement" button.
 */
export function TemplatesAdmin({ data, categoryKeys, taxKey, exceptTaxKeys, addable }: { data: TemplateAdminData; categoryKeys?: string[]; taxKey?: string; exceptTaxKeys?: string[]; addable?: boolean }) {
  const router = useRouter();
  const ask = useConfirm();
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [fresh, setFresh] = useState<TemplateRow | null>(null); // a requirement being added, shown at the top as an open form
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  const templates = useMemo(() => data.templates.filter((t) => (!categoryKeys || categoryKeys.includes(t.categoryKey)) && (!taxKey || t.taxTypeKey === taxKey) && !(exceptTaxKeys && t.taxTypeKey && exceptTaxKeys.includes(t.taxTypeKey))), [data.templates, categoryKeys, taxKey, exceptTaxKeys]);
  const categories = useMemo(() => Array.from(new Map(templates.map((t) => [t.categoryKey, t.categoryName])).entries()), [templates]);
  const shown = (fresh ? [fresh] : []).concat(templates.filter((t) => (category === "all" || t.categoryKey === category) && (!search.trim() || (t.name + " " + t.key).toLowerCase().includes(search.trim().toLowerCase()))));


  // Inside one tax's group, or for what is left over, an empty list is simply not shown.
  if (!addable && templates.length === 0 && (taxKey !== undefined || exceptTaxKeys !== undefined)) return null;

  const choices = data.options.categories.filter((c) => !categoryKeys || categoryKeys.includes(c.key));

  function startAdd() {
    const row: TemplateRow = { id: "new", key: "", name: "", description: null, categoryKey: choices[0]?.key ?? "statutory", categoryName: "", taxTypeKey: taxKey ?? null, taxTypeName: null, authorityKey: null, entityTypeKey: null, entityTypeName: null, frequency: "monthly", periodCalendar: "statutory", applicability: null, applicabilityText: "", dueRule: null, dueRuleText: "", activeFrom: null, activeTo: null, isActive: true, isVerified: false, generatedItems: 0 };
    setFresh(row);
    setOpenId(row.id);
    const registrable = taxKey && data.options.taxTypes.some((x) => x.key === taxKey && x.isRegistrable);
    setDraft({ ...draftOf(row), applies: registrable ? { match: "all", rows: [{ kind: "registered", not: false, value: [taxKey] }] } : EVERYONE });
    setMessage(null);
  }

  function setFrequency(frequency: string) {
    if (!fresh || !draft) return;
    setFresh({ ...fresh, frequency });
    setDraft({ ...draft, due: frequency === "event_based" ? { ...blankDueRuleForm(), period: "event", mode: "days" } : blankDueRuleForm() });
  }

  function close() {
    setOpenId(null);
    setDraft(null);
    setFresh(null);
    setMessage(null);
  }

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
    const problem = draft.applies && appliesProblem(draft.applies);
    if (problem) return setMessage({ tone: "bad", text: problem });
    setBusy(true);
    try {
      if (t.id === "new") {
        const added = await addTemplate({
          countryCode: data.country!.code,
          categoryKey: t.categoryKey,
          taxTypeKey: t.taxTypeKey ?? "",
          authorityKey: t.authorityKey ?? "",
          entityTypeKey: t.entityTypeKey ?? "",
          frequency: t.frequency as NewTemplateInput["frequency"],
          name: draft.name,
          description: draft.description,
          isActive: draft.isActive,
          isVerified: draft.isVerified,
          activeFrom: draft.activeFrom,
          activeTo: draft.activeTo,
          dueRule,
          applicabilityText: appliesText(draft),
        });
        if (!added.ok) return setMessage({ tone: "bad", text: added.error });
        close();
        router.refresh();
        await ask("Organizations get items from it the next time items are generated.", { title: "Requirement added", confirmLabel: "OK", cancelLabel: "" });
        return;
      }
      const r = await saveTemplate({
        id: t.id,
        name: draft.name,
        description: draft.description,
        isActive: draft.isActive,
        isVerified: draft.isVerified,
        activeFrom: draft.activeFrom,
        activeTo: draft.activeTo,
        dueRule,
        applicabilityText: appliesText(draft),
        moveOpenItems: draft.moveOpenItems,
      });
      if (!r.ok) return setMessage({ tone: "bad", text: r.error });
      const text = r.changes.length === 0 ? "Nothing was changed." : `Saved: ${r.changes.map((c) => c.field).join(", ")}.${r.movedItems > 0 ? ` ${r.movedItems} open item${r.movedItems === 1 ? "" : "s"} moved to the new due date.` : ""}`;
      if (r.changes.length === 0) setMessage({ tone: "ok", text });
      if (r.changes.length > 0) {
        setOpenId(null);
        setDraft(null);
        setMessage(null);
        router.refresh();
        await ask(text, { title: "Saved", confirmLabel: "OK", cancelLabel: "" });
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
  const names = { taxes: Object.fromEntries(data.options.taxTypes.map((x) => [x.key, x.name])), entityTypes: Object.fromEntries(data.options.entityTypes.map((x) => [x.key, x.name])) };
  const applicabilityPreview = () => (draft ? describeCondition(draft.applies ? appliesToCondition(draft.applies) : draft.original, names) : "");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        {categories.length > 1 && (
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
        )}
        {addable && !fresh && (
          <button type="button" onClick={startAdd} className="ml-auto rounded bg-[var(--color-primary)] px-4 py-1.5 text-sm text-white hover:bg-[var(--color-primary-hover)]">
            Add requirement
          </button>
        )}
        {templates.length > 4 && <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search requirements…" className={`${adminField} w-64`} />}
      </div>

      {message && openId === null && <p className={`rounded border px-3 py-2 text-sm ${message.tone === "ok" ? "border-green-300 bg-green-50 text-green-800" : "border-red-300 bg-red-50 text-red-700"}`}>{message.text}</p>}

      <div className="space-y-3">
        {shown.map((t) => (
          <section key={t.id} className={`${adminCard} p-4`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-[var(--text-primary)]">
                  {t.id === "new" ? "New requirement" : t.name} <span className="font-mono text-xs text-[var(--text-secondary)]">{t.key}</span>
                </p>
                {t.id !== "new" && (
                  <>
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
                  </>
                )}
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
                {t.id === "new" && fresh && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-xs text-[var(--text-secondary)]">
                      Repeats
                      <select value={fresh.frequency} onChange={(e) => setFrequency(e.target.value)} className={`${adminField} mt-1 w-full`}>
                        <option value="monthly">Every month</option>
                        <option value="quarterly">Every quarter</option>
                        <option value="annual">Every year</option>
                        <option value="one_time">Once</option>
                        <option value="event_based">When something happens</option>
                      </select>
                    </label>
                    {choices.length > 1 && (
                      <label className="text-xs text-[var(--text-secondary)]">
                        Category
                        <select value={fresh.categoryKey} onChange={(e) => setFresh({ ...fresh, categoryKey: e.target.value })} className={`${adminField} mt-1 w-full`}>
                          {choices.map((c) => (
                            <option key={c.key} value={c.key}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <label className="text-xs text-[var(--text-secondary)]">
                      Authority (optional)
                      <select value={fresh.authorityKey ?? ""} onChange={(e) => setFresh({ ...fresh, authorityKey: e.target.value || null })} className={`${adminField} mt-1 w-full`}>
                        <option value="">None</option>
                        {data.options.authorities.map((a) => (
                          <option key={a.key} value={a.key}>
                            {a.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs text-[var(--text-secondary)]">
                      Only for (optional)
                      <select value={fresh.entityTypeKey ?? ""} onChange={(e) => setFresh({ ...fresh, entityTypeKey: e.target.value || null })} className={`${adminField} mt-1 w-full`}>
                        <option value="">Every company type</option>
                        {data.options.entityTypes.map((e) => (
                          <option key={e.key} value={e.key}>
                            {e.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    {!taxKey && (
                      <label className="text-xs text-[var(--text-secondary)]">
                        Tax (optional)
                        <select value={fresh.taxTypeKey ?? ""} onChange={(e) => setFresh({ ...fresh, taxTypeKey: e.target.value || null })} className={`${adminField} mt-1 w-full`}>
                          <option value="">None</option>
                          {data.options.taxTypes.map((x) => (
                            <option key={x.key} value={x.key}>
                              {x.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                )}
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

                <ApplicabilityEditor applies={draft.applies} sentence={applicabilityPreview()} taxes={data.options.taxTypes.filter((x) => !(NOT_TAXES as readonly string[]).includes(x.key))} companyTypes={data.options.entityTypes} onChange={(applies) => setDraft({ ...draft, applies })} />

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
                  <button type="button" disabled={busy} onClick={close} className="rounded border border-gray-300 px-4 py-1.5 text-sm text-gray-700">
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </section>
        ))}
        {shown.length === 0 && <p className={`${adminCard} p-5 text-center text-sm text-[var(--text-secondary)]`}>{templates.length === 0 ? "Nothing here yet." : "No requirements match."}</p>}
      </div>
    </div>
  );
}
