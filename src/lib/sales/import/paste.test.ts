import { describe, expect, it } from "vitest";
import { parsePasted, pastedToCsv } from "./paste";

describe("pasting cells from a spreadsheet", () => {
  it("splits tab-separated rows and drops blank lines", () => {
    expect(parsePasted("Date\tCustomer\tAmount\n2083-04-15\tHimal\t1,000\n\n")).toEqual([
      ["Date", "Customer", "Amount"],
      ["2083-04-15", "Himal", "1,000"],
    ]);
  });
  it("keeps quoted cells whole, including quotes, tabs and line breaks inside them", () => {
    expect(parsePasted('Name\tNote\n"Acme ""Best"" Ltd"\t"line one\nline two"')).toEqual([
      ["Name", "Note"],
      ['Acme "Best" Ltd', "line one\nline two"],
    ]);
  });
  it("accepts Windows line endings and empty cells", () => {
    expect(parsePasted("a\tb\tc\r\n1\t\t3\r\n")).toEqual([
      ["a", "b", "c"],
      ["1", "", "3"],
    ]);
  });
  it("makes CSV with commas protected, and refuses a paste with no data row", () => {
    expect(pastedToCsv("Date\tCustomer\tAmount\n2083-04-15\tSharma, Ram & Sons\t1,000")).toBe('Date,Customer,Amount\n2083-04-15,"Sharma, Ram & Sons","1,000"');
    expect(pastedToCsv("Date\tCustomer\tAmount")).toBeNull();
    expect(pastedToCsv("")).toBeNull();
  });
});
