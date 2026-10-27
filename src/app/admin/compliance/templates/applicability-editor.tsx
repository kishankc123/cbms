"use client";

import { adminField } from "../../ui";
import { EVERYONE, FILING_BASES, ROW_CHOICES, type Applies, type Row, type RowKind } from "@/lib/compliance/applicability-form";

type Tax = { key: string; name: string; isRegistrable: boolean };
type CompanyType = { key: string; name: string };

/** "Who it applies to": every organization, or the ones that match a few plain conditions. `applies` is null for a rule too detailed to edit here. */
export function ApplicabilityEditor({ applies, sentence, taxes, companyTypes, onChange }: { applies: Applies | null; sentence: string; taxes: Tax[]; companyTypes: CompanyType[]; onChange: (a: Applies) => void }) {
  const registrable = taxes.filter((t) => t.isRegistrable);
  const blank = (kind: RowKind, not: boolean): Row => ({ kind, not, value: kind === "registered" ? [registrable[0]?.key ?? ""] : kind === "filing" ? ["monthly"] : [] });
  const setRow = (i: number, row: Row) => applies && onChange({ ...applies, rows: applies.rows.map((r, idx) => (idx === i ? row : r)) });

  return (
    <div className="space-y-3 rounded border border-[var(--card-border)] p-3">
      <p className="text-sm font-medium text-[var(--text-primary)]">Who it applies to</p>
      {applies === null ? (
        <div className="space-y-2 text-sm text-[var(--text-secondary)]">
          <p>This rule is more detailed than the choices here, so it stays as it is.</p>
          <button type="button" onClick={() => onChange(EVERYONE)} className="text-[var(--color-primary)] hover:underline">
            Replace it with simple choices
          </button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-5 text-sm text-[var(--text-primary)]">
            <label className="flex items-center gap-2">
              <input type="radio" checked={applies.rows.length === 0} onChange={() => onChange({ ...applies, rows: [] })} /> Every organization
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" checked={applies.rows.length > 0} onChange={() => applies.rows.length === 0 && onChange({ ...applies, rows: [blank("registered", false)] })} /> Only organizations that match…
            </label>
          </div>

          {applies.rows.length > 0 && (
            <div className="space-y-2">
              {applies.rows.length > 1 && (
                <p className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                  Match
                  <select value={applies.match} onChange={(e) => onChange({ ...applies, match: e.target.value as "all" | "any" })} className={adminField}>
                    <option value="all">all</option>
                    <option value="any">any</option>
                  </select>
                  of these
                </p>
              )}
              {applies.rows.map((row, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <select
                    value={`${row.kind}:${row.not}`}
                    onChange={(e) => {
                      const [kind, not] = e.target.value.split(":");
                      setRow(i, kind === row.kind ? { ...row, not: not === "true" } : blank(kind as RowKind, not === "true"));
                    }}
                    className={adminField}
                  >
                    {ROW_CHOICES.map((c) => (
                      <option key={`${c.kind}:${c.not}`} value={`${c.kind}:${c.not}`}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                  {row.kind === "registered" && (
                    <select value={row.value[0] ?? ""} onChange={(e) => setRow(i, { ...row, value: [e.target.value] })} className={adminField}>
                      <option value="">Choose a tax</option>
                      {registrable.concat(taxes.filter((t) => !t.isRegistrable && t.key === row.value[0])).map((t) => (
                        <option key={t.key} value={t.key}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  )}
                  {row.kind === "filing" && (
                    <select value={row.value[0] ?? "monthly"} onChange={(e) => setRow(i, { ...row, value: [e.target.value] })} className={adminField}>
                      {FILING_BASES.map((b) => (
                        <option key={b.value} value={b.value}>
                          {b.label}
                        </option>
                      ))}
                    </select>
                  )}
                  {row.kind === "companyType" &&
                    (companyTypes.length === 0 ? (
                      <span className="text-xs text-[var(--text-secondary)]">No company types are set up for this country yet.</span>
                    ) : (
                      companyTypes.map((c) => (
                        <label key={c.key} className="flex items-center gap-1.5 text-sm text-[var(--text-primary)]">
                          <input type="checkbox" checked={row.value.includes(c.key)} onChange={(e) => setRow(i, { ...row, value: e.target.checked ? [...row.value, c.key] : row.value.filter((v) => v !== c.key) })} />
                          {c.name}
                        </label>
                      ))
                    ))}
                  <button type="button" onClick={() => onChange({ ...applies, rows: applies.rows.filter((_, idx) => idx !== i) })} className="text-sm text-red-600 hover:underline">
                    Remove
                  </button>
                </div>
              ))}
              <button type="button" onClick={() => onChange({ ...applies, rows: [...applies.rows, blank("employees", false)] })} className="text-sm text-[var(--color-primary)] hover:underline">
                + Add a condition
              </button>
            </div>
          )}
        </>
      )}
      <p className="text-sm text-[var(--text-primary)]">→ {sentence}</p>
      {applies?.rows.some((r) => r.kind === "registered") && <p className="text-xs text-[var(--text-secondary)]">Whether an organization is registered for a tax comes from its Company details.</p>}
    </div>
  );
}
