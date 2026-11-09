import { describe, expect, it } from "vitest";
import { evaluateFormula, isFormula } from "./calc";

const val = (s: string, d?: number) => {
  const r = evaluateFormula(s, d);
  return r.ok ? r.value : `ERR:${r.error}`;
};

describe("isFormula", () => {
  it("is a formula only when it starts with =", () => {
    expect(isFormula("=250+250")).toBe(true);
    expect(isFormula("  =1")).toBe(true);
    expect(isFormula("250+250")).toBe(false);
    expect(isFormula("")).toBe(false);
    expect(isFormula("-5")).toBe(false);
  });
});

describe("evaluateFormula", () => {
  it("adds, subtracts, multiplies and divides", () => {
    expect(val("=250+250")).toBe("500");
    expect(val("=1000-250.5")).toBe("749.5");
    expect(val("=12*4")).toBe("48");
    expect(val("=100/8")).toBe("12.5");
    expect(val("=12x4")).toBe("48");
    expect(val("=12×4÷2")).toBe("24");
  });

  it("does multiplication and division before addition, and respects brackets", () => {
    expect(val("=2+3*4")).toBe("14");
    expect(val("=(2+3)*4")).toBe("20");
    expect(val("=10-2-3")).toBe("5");
    expect(val("=100/(2+3)")).toBe("20");
    expect(val("=((1+2)*(3+4))")).toBe("21");
  });

  it("accepts spaces, commas in numbers, and a sign in front", () => {
    expect(val("= 1,250 + 750 ")).toBe("2000");
    expect(val("=-5+3")).toBe("-2");
    expect(val("=2*-3")).toBe("-6");
    expect(val("=+4")).toBe("4");
    expect(val("=.5+.25")).toBe("0.75");
  });

  it("treats a percentage after + or - as a share of what came before, and elsewhere as a hundredth", () => {
    expect(val("=1000+13%")).toBe("1130");
    expect(val("=1000-10%")).toBe("900");
    expect(val("=1000*13%")).toBe("130");
    expect(val("=13%")).toBe("0.13");
    expect(val("=200+50+10%")).toBe("275");
  });

  it("rounds only at the end, to the places asked for", () => {
    expect(val("=1/3*3")).toBe("1");
    expect(val("=10/3")).toBe("3.33");
    expect(val("=10/3", 4)).toBe("3.3333");
    expect(val("=2.675", 2)).toBe("2.68");
    expect(val("=0.1+0.2")).toBe("0.3");
    expect(val("=-2.675", 2)).toBe("-2.68");
    expect(val("=1/3", 0)).toBe("0");
  });

  it("never returns minus zero", () => {
    expect(val("=-0.001")).toBe("0");
  });

  it("gives a plain reason when the sum can't be worked out, and never throws", () => {
    expect(val("=")).toMatch(/^ERR:Type a sum/);
    expect(val("=250+")).toMatch(/^ERR:/);
    expect(val("=(1+2")).toBe("ERR:A bracket is not closed.");
    expect(val("=1+2)")).toBe("ERR:A bracket is closed that was never opened.");
    expect(val("=5/0")).toBe("ERR:Can't divide by zero.");
    expect(val("=5/(2-2)")).toBe("ERR:Can't divide by zero.");
    expect(val("=2 3")).toMatch(/^ERR:/);
    expect(val("=1..2")).toMatch(/^ERR:/);
    expect(val("=abc")).toMatch(/^ERR:"a" can't be used/);
    expect(val("250+250")).toMatch(/^ERR:Start with =/);
    expect(val("=1e5")).toMatch(/^ERR:/);
    expect(val("=" + "9".repeat(20))).toBe("ERR:That number is too large.");
    expect(val("=" + "1+".repeat(150) + "1")).toBe("ERR:That sum is too long.");
  });

  it("cannot run code", () => {
    expect(val("=alert(1)")).toMatch(/^ERR:/);
    expect(val("=constructor")).toMatch(/^ERR:/);
    expect(val("=1;process.exit()")).toMatch(/^ERR:/);
  });
});
