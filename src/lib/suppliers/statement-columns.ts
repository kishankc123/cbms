import type { ColumnMapping } from "@/lib/banking/normalize-rows";

// Which column of a supplier's statement is which, guessed from the headings. A person can change any of them on the preview screen.

const FIRST = (headers: string[], taken: Set<string>, test: (h: string) => boolean) => headers.find((h) => !taken.has(h) && test(h.trim().toLowerCase()));

export function guessMapping(headers: string[]): ColumnMapping {
  const taken = new Set<string>();
  const pick = (test: (h: string) => boolean) => {
    const found = FIRST(headers, taken, test);
    if (found) taken.add(found);
    return found;
  };
  const date = pick((h) => /date|miti|मिति/.test(h));
  const debit = pick((h) => h === "dr" || h.startsWith("debit") || h === "dr." || h.endsWith(" debit") || h.startsWith("dr "));
  const credit = pick((h) => h === "cr" || h.startsWith("credit") || h === "cr." || h.endsWith(" credit") || h.startsWith("cr "));
  const amount = debit || credit ? undefined : pick((h) => h === "amount" || h.startsWith("amount"));
  const balance = pick((h) => h.includes("balance") || h === "bal");
  const reference = pick((h) => /ref|document|doc\b|doc\.|voucher|vch|bill|invoice|inv\b|cheque|chq/.test(h));
  const description = pick((h) => /desc|particular|narration|detail|remark|note/.test(h));
  return { date: date ?? "", debit, credit, amount, balance, reference, description };
}

/** What is missing before the statement can be read, in plain words, or null. */
export function mappingProblem(m: ColumnMapping): string | null {
  if (!m.date) return "Choose the Date column.";
  if (!m.debit && !m.credit && !m.amount) return "Choose the Debit and Credit columns, or one Amount column.";
  return null;
}
