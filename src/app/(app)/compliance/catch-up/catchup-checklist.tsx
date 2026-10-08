"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useProblem } from "@/components/problem-dialog";
import { D } from "@/components/calendar/date-text";
import type { StreamKey } from "@/lib/compliance/catchup-rules";
import { saveCatchupAnswers, type CatchupData } from "../catchup-actions";

const select = "w-full max-w-md rounded border border-gray-300 bg-white px-2 py-1.5 text-sm focus:border-[var(--color-primary)] focus:outline-none";

// One question per kind of requirement, income tax first. When income tax is filed through the latest finished fiscal year, the
// others are pre-selected through the same date for the person to confirm: a starting point, never an automatic tick.
export function CatchupChecklist({ data }: { data: CatchupData }) {
  const router = useRouter();
  const { report, reportError, dialog } = useProblem();
  // "" = none filed yet; undefined = not answered yet.
  const [answers, setAnswers] = useState<Partial<Record<StreamKey, string>>>(() => Object.fromEntries(data.streams.filter((s) => s.answered).map((s) => [s.key, s.filedThrough ?? ""])));
  const [suggested, setSuggested] = useState<Set<StreamKey>>(new Set());
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  if (!data.ready) return null;
  if (data.streams.length === 0) return <p className="rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-500">There is nothing to catch up on yet.</p>;

  const latestLabel = data.streams[0].options.find((o) => o.value === data.latestFinishedYearEnd)?.label ?? "the latest finished year";

  function choose(key: StreamKey, value: string) {
    setSaved(false);
    const next = { ...answers, [key]: value };
    const nextSuggested = new Set(suggested);
    nextSuggested.delete(key);
    // Income tax filed through the latest finished year: pre-select the rest through the same date, unless already answered.
    if (key === "income_tax" && value && value === data.latestFinishedYearEnd) {
      for (const s of data.streams) {
        if (s.key === "income_tax" || next[s.key] !== undefined) continue;
        next[s.key] = s.options.some((o) => o.value === value) ? value : "";
        nextSuggested.add(s.key);
      }
    }
    setAnswers(next);
    setSuggested(nextSuggested);
  }

  const complete = data.streams.every((s) => answers[s.key] !== undefined);

  async function save() {
    setSaving(true);
    try {
      const body: Partial<Record<StreamKey, string | null>> = {};
      for (const s of data.streams) body[s.key] = answers[s.key] ? (answers[s.key] as string) : null;
      const r = await saveCatchupAnswers(body);
      if (!r.ok) return report(r.error);
      setSaved(true);
      setSuggested(new Set());
      router.refresh();
    } catch (e) {
      reportError(e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {data.firstFiscalYear && (
        <p className="text-sm text-gray-600">
          Your company was registered in fiscal year <span className="font-medium">{data.firstFiscalYear}</span>, so income tax is tracked from then.
        </p>
      )}

      {data.streams.map((s, i) => {
        const value = answers[s.key];
        const permit = s.key === "excise_permit";
        return (
          <section key={s.key} className="space-y-2 rounded-lg border border-gray-200 bg-white p-4">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-base font-semibold text-gray-900">
                {i + 1}. {s.label}
              </h2>
              <span className="text-xs text-gray-500">
                Starts <D value={s.from} />
              </span>
            </div>
            <label className="block text-xs text-gray-500">{permit ? "Permit renewed (paid) through" : "Filed up to and including"}</label>
            <select className={select} value={value ?? "__unanswered"} disabled={!data.canEdit} onChange={(e) => choose(s.key, e.target.value)}>
              {value === undefined && (
                <option value="__unanswered" disabled>
                  Choose...
                </option>
              )}
              {!permit && <option value="">None filed yet</option>}
              {s.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            {suggested.has(s.key) && <p className="text-xs text-[var(--status-action-text)]">Pre-selected because income tax is filed through {latestLabel}. Please check it is right.</p>}
            {permit && <p className="text-xs text-gray-500">The fiscal year the permit was issued in counts as paid. The next renewal falls due in Shrawan.</p>}
            {!permit && s.options.length === 0 && <p className="text-xs text-gray-500">No period has finished yet since this started, so there is nothing to mark as filed. Choose None filed yet, and the first period will appear when it is due.</p>}
          </section>
        );
      })}

      {data.canEdit && (
        <div className="flex items-center gap-3">
          <button type="button" disabled={!complete || saving} onClick={save} className="rounded bg-[var(--color-primary)] px-5 py-1.5 text-sm font-medium text-white hover:bg-[var(--color-primary-hover)] disabled:opacity-50">
            {saving ? "Saving..." : "Save checklist"}
          </button>
          {!complete && <span className="text-xs text-gray-500">Answer every question to save.</span>}
          {saved && (
            <span className="text-sm text-green-700">
              Saved. See the result in{" "}
              <Link href="/compliance/tax" className="underline">
                Tax Compliance
              </Link>
              .
            </span>
          )}
        </div>
      )}
      {dialog}
    </div>
  );
}
