import { describe, expect, it } from "vitest";
import { answerValid, filedBefore, latestFinishedYearEnd, periodOptions, prefillFrom } from "./catchup-rules";

const TODAY = "2026-10-08"; // 22 Ashwin 2083, in FY 2083/84

describe("what can be chosen as filed up to", () => {
  it("income tax: every fiscal year from the one the company was registered in to the last finished one", () => {
    const o = periodOptions("year", "2022-02-03", TODAY); // registered 20 Magh 2078
    expect(o.map((x) => x.label)).toEqual(["FY 2078/79", "FY 2079/80", "FY 2080/81", "FY 2081/82", "FY 2082/83"]);
    expect(o[o.length - 1].value).toBe("2026-07-16"); // end of Ashadh 2083
  });

  it("VAT monthly: every completed month from the VAT start month, never the month still running", () => {
    const o = periodOptions("month", "2026-04-20", TODAY); // VAT from 7 Baisakh 2083
    expect(o.map((x) => x.label)).toEqual(["Baisakh 2083", "Jestha 2083", "Ashadh 2083", "Shrawan 2083", "Bhadra 2083"]);
  });

  it("an organization joining in Falgun still gets every month of the year to choose from", () => {
    const o = periodOptions("month", "2026-04-20", "2027-03-01"); // Falgun 2083
    expect(o[0].label).toBe("Baisakh 2083");
    expect(o[o.length - 1].label).toBe("Magh 2083"); // Falgun is still running
    expect(o).toHaveLength(10);
  });

  it("VAT quarterly: the three terms of a year", () => {
    const o = periodOptions("term", "2025-07-17", "2026-08-30"); // from FY 2082/83, in Bhadra 2083
    expect(o.map((x) => x.label)).toEqual(["Shrawan–Kartik 2082", "Mangsir–Falgun 2082", "Chaitra–Ashad 2082"]);
  });

  it("the excise permit can be renewed through the current fiscal year", () => {
    expect(periodOptions("permit", "2022-02-03", TODAY).map((x) => x.label)).toEqual(["FY 2078/79", "FY 2079/80", "FY 2080/81", "FY 2081/82", "FY 2082/83", "FY 2083/84"]);
  });
});

describe("pre-selecting from the income tax answer", () => {
  const monthly = periodOptions("month", "2023-02-03", TODAY);
  it("when income tax is filed through the latest finished year, the other streams are pre-selected through the same date", () => {
    const end = latestFinishedYearEnd(TODAY)!;
    expect(end).toBe("2026-07-16");
    expect(prefillFrom(end, end, monthly)).toBe("2026-07-16");
  });
  it("is blank when an earlier year was the answer, none was filed, or the stream began after that year", () => {
    const end = latestFinishedYearEnd(TODAY)!;
    expect(prefillFrom("2025-07-16", end, monthly)).toBeNull();
    expect(prefillFrom(null, end, monthly)).toBeNull();
    expect(prefillFrom(end, end, periodOptions("month", "2026-09-25", TODAY))).toBeNull(); // VAT began after Ashadh 2083
  });
});

describe("answers and what they mark", () => {
  const o = periodOptions("month", "2026-04-20", TODAY);
  it("is valid when none, or one of the offered periods", () => {
    expect(answerValid(o, null)).toBe(true);
    expect(answerValid(o, "2026-07-16")).toBe(true);
    expect(answerValid(o, "2026-07-15")).toBe(false);
  });
  it("marks a period filed when it ended on or before the answer", () => {
    expect(filedBefore("2026-07-16", "2026-07-16")).toBe(true);
    expect(filedBefore("2026-08-16", "2026-07-16")).toBe(false);
    expect(filedBefore("2026-08-16", null)).toBe(false);
  });
});
