import { describe, it, expect } from "vitest";
import { resolveImportDates } from "./import-dates";
import { normalizeStatementRows } from "./normalize-rows";

const TODAY = "2026-09-20";

describe("bank statement date import", () => {
  it("auto-detects an all-BS column and converts to AD", () => {
    const r = resolveImportDates(["2083-06-01", "2083-06-02", "2083/06/03"], { today: TODAY });
    expect(r.detected).toBe("BS");
    expect(r.applied).toBe("BS");
    expect(r.blocking).toBe(false);
    expect(r.rows.map((x) => x.iso)).toEqual(["2026-09-17", "2026-09-18", "2026-09-19"]);
  });

  it("auto-detects an all-AD column", () => {
    const r = resolveImportDates(["2026-09-17", "18/09/2026", "19-09-2026"], { today: TODAY });
    expect(r.detected).toBe("AD");
    expect(r.rows.map((x) => x.iso)).toEqual(["2026-09-17", "2026-09-18", "2026-09-19"]);
    expect(r.blocking).toBe(false);
  });

  it("flags mixed AD/BS columns and blocks until accepted", () => {
    const values = ["2026-09-17", "2083-06-02"];
    const blocked = resolveImportDates(values, { today: TODAY });
    expect(blocked.mixed).toBe(true);
    expect(blocked.blocking).toBe(true);
    const accepted = resolveImportDates(values, { today: TODAY, allowMixed: true });
    expect(accepted.blocking).toBe(false);
    expect(accepted.rows.map((x) => x.iso)).toEqual(["2026-09-17", "2026-09-18"]);
    expect(accepted.rows.map((x) => x.status)).toEqual(["AD", "BS"]);
  });

  it("blocks undecidable dates unless the user forces a calendar", () => {
    // A date valid and plausible in neither window is not guessed.
    const r = resolveImportDates(["2040-01-01"], { today: TODAY });
    expect(r.blocking).toBe(true);
  });

  it("manual override wins over detection and warns when the file looks different", () => {
    const r = resolveImportDates(["2083-06-01", "2083-06-02"], { today: TODAY, choice: "AD" });
    expect(r.applied).toBe("AD");
    expect(r.rows[0].iso).toBe("2083-06-01"); // read literally as AD
    expect(r.rows[0].note).toMatch(/BS/);
  });

  it("reports unreadable rows without blocking the rest", () => {
    const r = resolveImportDates(["2083-06-01", "Closing balance"], { today: TODAY });
    expect(r.counts.invalid).toBe(1);
    expect(r.blocking).toBe(false);
    expect(r.rows[1].iso).toBeNull();
  });

  it("uses the AD date for stored rows, whichever calendar the file used", () => {
    const headers = ["Miti", "Narration", "Credit", "Debit"];
    const rows = [
      ["2083-06-01", "Deposit", "1,000.00", ""],
      ["2083-06-02", "Cheque", "", "250"],
    ];
    const { valid, dates } = normalizeStatementRows(headers, rows, { date: "Miti", description: "Narration", credit: "Credit", debit: "Debit" }, { choice: "auto" });
    expect(dates.applied).toBe("BS");
    expect(valid.map((v) => v.transactionDate)).toEqual(["2026-09-17", "2026-09-18"]);
    expect(valid.map((v) => v.amount)).toEqual([1000, -250]);
  });
});
