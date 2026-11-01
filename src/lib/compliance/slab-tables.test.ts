import { describe, expect, it } from "vitest";
import { changedSlabRows, checkSlabTables, sameSlabTables, slabTax } from "./slab-tables";

const both = (rows: { upTo: unknown; rate: unknown }[]) => ({ single: rows, couple: rows });
const ok = both([{ upTo: 500000, rate: 1 }, { upTo: 700000, rate: 10 }, { upTo: null, rate: 20 }]);

describe("slab tables", () => {
  it("accepts rising slabs with the last one open-ended, in both classes", () => {
    expect(checkSlabTables(ok)).toMatchObject({ ok: true });
    expect(checkSlabTables(both([{ upTo: "", rate: "15" }]))).toMatchObject({ ok: true, tables: { single: [{ upTo: null, rate: 15 }] } });
  });

  it("explains what is wrong in plain words", () => {
    const error = (t: unknown) => (checkSlabTables(t) as { error: string }).error;
    expect(error({ single: ok.single })).toMatch(/Couple: add at least one slab/);
    expect(error(both([{ upTo: 500000, rate: 1 }, { upTo: 400000, rate: 10 }, { upTo: null, rate: 20 }]))).toMatch(/slab 2: it has to end above 500,000/);
    expect(error(both([{ upTo: 500000, rate: 1 }]))).toMatch(/last slab must have no upper limit/);
    expect(error(both([{ upTo: null, rate: 1 }, { upTo: null, rate: 2 }]))).toMatch(/slab 1: enter where the slab ends/);
    expect(error(both([{ upTo: 100, rate: 101 }, { upTo: null, rate: 2 }]))).toMatch(/rate must be a number between 0 and 100/);
    expect(error(both([{ upTo: 100, rate: "" }, { upTo: null, rate: 2 }]))).toMatch(/rate must be a number/);
    expect(error(both([{ upTo: 100, rate: 1 }, { upTo: 200, rate: 2 }]))).toMatch(/last slab must have no upper limit/);
  });

  it("works out the tax slab by slab", () => {
    const slabs = [{ upTo: 500000, rate: 1 }, { upTo: 700000, rate: 10 }, { upTo: 1000000, rate: 20 }, { upTo: null, rate: 30 }];
    expect(slabTax(slabs, 0)).toBe(0);
    expect(slabTax(slabs, 400000)).toBe(4000);
    expect(slabTax(slabs, 700000)).toBe(5000 + 20000);
    expect(slabTax(slabs, 1200000)).toBe(5000 + 20000 + 60000 + 60000);
  });

  it("compares tables and finds the rows that changed", () => {
    const a = checkSlabTables(ok);
    const b = checkSlabTables(both([{ upTo: 500000, rate: 1 }, { upTo: 700000, rate: 12 }, { upTo: null, rate: 20 }]));
    if (!a.ok || !b.ok) throw new Error("tables should be valid");
    expect(sameSlabTables(a.tables, a.tables)).toBe(true);
    expect(sameSlabTables(a.tables, b.tables)).toBe(false);
    expect(changedSlabRows(a.tables.single, [{ upTo: "500000", rate: "1" }, { upTo: "700000", rate: "12" }, { upTo: "", rate: "20" }])).toEqual([false, true, false]);
    expect(changedSlabRows(a.tables.single, [{ upTo: "500000", rate: "1" }, { upTo: "700000", rate: "10" }, { upTo: "900000", rate: "20" }, { upTo: "", rate: "30" }])).toEqual([false, false, true, true]);
  });
});
