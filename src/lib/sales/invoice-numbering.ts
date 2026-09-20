// Pure invoice-numbering rules (no database), unit-tested.

/**
 * The next invoice number that isn't already taken. Numbers come from the configured pattern with a
 * running sequence; the sequence starts at `start` (usually "invoices so far + 1") and skips forward past
 * any number already used — so deleted/voided rows, hand-typed numbers or two people saving at once can
 * never produce a duplicate.
 */
export function nextFreeInvoiceNumber(taken: ReadonlySet<string>, build: (sequence: number) => string, start: number): { number: string; sequence: number } {
  let sequence = Math.max(start, 1);
  for (let guard = 0; guard < 100000; guard++, sequence++) {
    const number = build(sequence);
    if (!taken.has(number)) return { number, sequence };
  }
  throw new Error("Could not find a free invoice number");
}
