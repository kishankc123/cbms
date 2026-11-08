import { describe, expect, it } from "vitest";
import { cleanNotes, compareCount, countedTotal } from "./cash-count-rules";

describe("cash count", () => {
  it("adds up the notes and the coins", () => {
    expect(countedTotal({ "1000": 2, "500": 1, "5": 3 }, 12.5)).toBe(2527.5);
    expect(countedTotal({}, 0)).toBe(0);
  });

  it("accepts blanks as zero and refuses anything that is not a whole number of a known note", () => {
    expect(cleanNotes({ "1000": "3", "500": "", "100": 0 })).toEqual({ "1000": 3 });
    expect(cleanNotes({ "1000": "2.5" })).toBeNull();
    expect(cleanNotes({ "1000": "-1" })).toBeNull();
    expect(cleanNotes({ "1000": "abc" })).toBeNull();
    expect(cleanNotes({ "250": 1 })).toBeNull();
  });

  it("says whether the till is short, over, or right", () => {
    expect(compareCount(4900, 5000)).toMatchObject({ difference: -100, status: "short" });
    expect(compareCount(5100.5, 5000)).toMatchObject({ difference: 100.5, status: "over" });
    expect(compareCount(5000, 5000)).toMatchObject({ difference: 0, status: "matches" });
    expect(compareCount(5000.004, 5000).status).toBe("matches");
  });
});
