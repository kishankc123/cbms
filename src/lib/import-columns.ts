// The columns of an import file. Imports use the template that is downloaded from the screen, so a column is simply the one
// headed with the field's name: capitals, spaces and punctuation don't matter, and nothing has to be matched by hand.

export type FieldDef<K extends string> = { key: K; label: string; required: boolean; help: string };
export type ColumnMapping<K extends string> = Partial<Record<K, string>>;

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export function templateMapping<K extends string>(fields: FieldDef<K>[], headers: string[]): ColumnMapping<K> {
  const byName = new Map(headers.map((h) => [norm(h), h]));
  const mapping: ColumnMapping<K> = {};
  for (const f of fields) {
    const header = byName.get(norm(f.label));
    if (header) mapping[f.key] = header;
  }
  return mapping;
}

/** Refuses a file that lacks a required column, in words that say what to do. */
export function assertColumns<K extends string>(fields: FieldDef<K>[], mapping: ColumnMapping<K>) {
  const missing = fields.find((f) => f.required && !mapping[f.key]);
  if (missing) throw new Error(`The file has no "${missing.label}" column. Download the template and keep its column names.`);
}

/** The first sheet of a template: the field names as the heading row, then sample rows given by field. */
export function templateRows<K extends string>(fields: FieldDef<K>[], samples: Partial<Record<K, string | number>>[]): (string | number)[][] {
  return [fields.map((f) => f.label), ...samples.map((s) => fields.map((f) => s[f.key] ?? ""))];
}
