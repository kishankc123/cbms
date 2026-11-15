import { describe, expect, it } from "vitest";
import { colourOf, defaultModeNames, initials, institutionForFile, logoProblem, missingStarting, STARTING_INSTITUTIONS } from "./institution-rules";

describe("initials and colour", () => {
  it("takes the first letters of two words, or the first two letters of one", () => {
    expect(initials("Nabil Bank")).toBe("NB");
    expect(initials("eSewa")).toBe("ES");
    expect(initials("  Global   IME Bank ")).toBe("GI");
    expect(initials("")).toBe("?");
  });
  it("gives the same colour for the same name every time", () => {
    expect(colourOf("Nabil Bank")).toBe(colourOf("Nabil Bank"));
    expect(colourOf("Nabil Bank")).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("what a logo file may be", () => {
  it("accepts a small picture and refuses the wrong type, a big file and an SVG with a script", () => {
    expect(logoProblem("image/png", 5_000)).toBeNull();
    expect(logoProblem("application/pdf", 5_000)).toMatch(/PNG, JPEG, WebP or SVG/);
    expect(logoProblem("image/png", 41_000)).toMatch(/at most 40 KB/);
    expect(logoProblem("image/svg+xml", 200, "<svg><rect/></svg>")).toBeNull();
    expect(logoProblem("image/svg+xml", 200, "<svg onload='x()'></svg>")).toMatch(/script/);
    expect(logoProblem("image/svg+xml", 200, "<svg><script>x()</script></svg>")).toMatch(/script/);
  });
});

describe("matching a logo file to its bank", () => {
  const list = [{ id: "1", name: "Nabil Bank" }, { id: "2", name: "NIC Asia Bank" }, { id: "3", name: "Nepal Bank" }, { id: "4", name: "Nepal Investment Mega Bank" }, { id: "5", name: "eSewa" }];
  it("matches by the start of the name, or the whole name", () => {
    expect(institutionForFile("nabil.svg", list)).toBe("1");
    expect(institutionForFile("NIC-Asia-Bank.png", list)).toBe("2");
    expect(institutionForFile("esewa.PNG", list)).toBe("5");
    expect(institutionForFile("nepalbank.png", list)).toBe("3");
  });
  it("matches by the short code too", () => {
    const withCodes = [{ id: "6", name: "Global IME Bank Limited", code: "GIBL" }, { id: "7", name: "Nabil Bank Limited", code: "NABIL" }, { id: "8", name: "Nepal Bank Limited", code: "NBL" }];
    expect(institutionForFile("gibl.svg", withCodes)).toBe("6");
    expect(institutionForFile("NBL.png", withCodes)).toBe("8");
    expect(institutionForFile("nabil.png", withCodes)).toBe("7");
  });
  it("matches nothing when the name fits none or several", () => {
    expect(institutionForFile("nepal.png", list)).toBeNull();
    expect(institutionForFile("unknown.png", list)).toBeNull();
    expect(institutionForFile(".png", list)).toBeNull();
  });
});

describe("the starting list and the modes a bank is used for", () => {
  it("has the 20 commercial banks, 17 development banks and 3 wallets, each name and each code once", () => {
    const names = STARTING_INSTITUTIONS.map((i) => i.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(STARTING_INSTITUTIONS.map((i) => i.code)).size).toBe(STARTING_INSTITUTIONS.length);
    expect(STARTING_INSTITUTIONS.filter((i) => i.kind === "bank")).toHaveLength(20);
    expect(STARTING_INSTITUTIONS.filter((i) => i.kind === "development_bank")).toHaveLength(17);
    expect(STARTING_INSTITUTIONS.filter((i) => i.kind === "wallet").map((i) => i.code)).toEqual(["ESEWA", "KHALTI", "IMEPAY"]);
    expect(STARTING_INSTITUTIONS.some((i) => i.kind === "wallet")).toBe(true);
    expect(STARTING_INSTITUTIONS.some((i) => i.kind === "bank")).toBe(true);
  });
  it("finds the starting entries a list does not have yet", () => {
    expect(missingStarting([])).toHaveLength(STARTING_INSTITUTIONS.length);
    expect(missingStarting(STARTING_INSTITUTIONS)).toEqual([]);
    expect(missingStarting([{ name: "NABIL BANK LIMITED" }]).some((i) => i.code === "NABIL")).toBe(false);
  });
  it("suggests bank transfer and cheque for a bank, and wallet and its own name for a wallet", () => {
    expect(defaultModeNames("development_bank", "Garima Bikas Bank Limited")).toEqual(["Bank transfer", "Cheque"]);
    expect(defaultModeNames("bank", "Nabil Bank")).toEqual(["Bank transfer", "Cheque"]);
    expect(defaultModeNames("wallet", "Fonepay")).toEqual(["Wallet", "Fonepay"]);
  });
});
