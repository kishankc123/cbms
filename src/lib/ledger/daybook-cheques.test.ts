import { describe, expect, it } from "vitest";
import { buildDayCheques, chequeStatusLabel, type DayChequeRow } from "./daybook-cheques";

const row = (o: Partial<DayChequeRow> & { id: string }): DayChequeRow => ({ kind: "issued", number: "001", party: "Supplier", amount: 100, chequeDate: "2026-11-08", status: "issued", open: true, clearedDate: null, depositedDate: null, closedOn: null, ...o });

describe("the cheques of a day", () => {
  const rows = [
    row({ id: "a", amount: 500 }),
    row({ id: "b", kind: "received", chequeDate: "2026-11-08", status: "received", amount: 300 }),
    row({ id: "c", chequeDate: "2026-11-01", amount: 200 }),
    row({ id: "d", kind: "received", chequeDate: "2026-11-02", status: "cleared", open: false, clearedDate: "2026-11-08", amount: 700 }),
    row({ id: "e", chequeDate: "2026-11-05", status: "stopped", open: false, closedOn: "2026-11-08", amount: 50 }),
    row({ id: "f", kind: "received", chequeDate: "2026-11-03", status: "deposited", open: false, depositedDate: "2026-11-08", amount: 90 }),
  ];

  it("sorts them into what is dated today, what is late, what the bank did, and what came back", () => {
    const r = buildDayCheques(rows, "2026-11-08", "2026-11-08");
    expect(r.groups.map((g) => [g.key, g.rows.map((x) => x.id)])).toEqual([
      ["due", ["a", "b"]],
      ["overdue", ["c"]],
      ["deposited", ["f"]],
      ["cleared", ["d"]],
      ["closed", ["e"]],
    ]);
    expect(r.groups[0]).toMatchObject({ issued: 500, received: 300 });
  });

  it("leaves out late cheques on a past day, since who is still waiting is only known today", () => {
    const r = buildDayCheques(rows, "2026-11-08", "2026-11-20");
    expect(r.groups.some((g) => g.key === "overdue")).toBe(false);
  });

  it("says nothing on a quiet day", () => {
    expect(buildDayCheques(rows, "2026-10-01", "2026-11-08")).toEqual({ groups: [], any: false });
  });

  it("describes a cheque in plain words", () => {
    expect(chequeStatusLabel({ kind: "issued", status: "issued", chequeDate: "2026-11-08" }, "2026-11-08")).toBe("Not yet presented");
    expect(chequeStatusLabel({ kind: "received", status: "received", chequeDate: "2026-11-20" }, "2026-11-08")).toBe("Post-dated");
    expect(chequeStatusLabel({ kind: "issued", status: "cleared", chequeDate: "2026-11-01" }, "2026-11-08")).toBe("Paid");
  });
});
