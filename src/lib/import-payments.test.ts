import { describe, expect, it } from "vitest";
import { readPaySlots, type PayKey } from "./import-payments";
import type { PaymentResolver } from "./payment-modes";

// A bank that takes cheques, transfers and Fonepay; cash that takes only Cash.
const cash = { id: "a-cash", code: "1000", name: "Cash" };
const bank = { id: "a-bank", code: "1010.01", name: "Everest Bank" };
const bank2 = { id: "a-bank2", code: "1010.02", name: "Nabil Bank" };
const modes = [
  { id: "m-cash", name: "Cash", accounts: [cash] },
  { id: "m-cheque", name: "Cheque", accounts: [bank, bank2] },
  { id: "m-fone", name: "Fonepay", accounts: [bank] },
  { id: "m-xfer", name: "Bank transfer", accounts: [bank, bank2] },
];
const all = [cash, bank, bank2];
const resolver = {
  modes,
  resolve(text: string) {
    const k = text.trim().toLowerCase();
    const a = all.find((x) => x.name.toLowerCase() === k || x.code === k);
    if (a) {
      const m = modes.filter((md) => md.accounts.some((x) => x.id === a.id));
      return { accountId: a.id, modeId: m.length === 1 ? m[0].id : null };
    }
    const md = modes.find((x) => x.name.toLowerCase() === k);
    if (md) return md.accounts.length === 1 ? { accountId: md.accounts[0].id, modeId: md.id } : { ambiguous: md.accounts.map((x) => x.name) };
    return null;
  },
} as unknown as PaymentResolver;

const read = (cells: Partial<Record<PayKey, string>>, defaults = { accountId: null as string | null, modeId: null as string | null }) => readPaySlots((k) => cells[k] ?? "", resolver, defaults)[0];

describe("payment mode columns in an import", () => {
  it("account and mode together record that mode", () => {
    expect(read({ account: "Everest Bank", mode: "Cheque" })).toMatchObject({ account: "ok", accountId: bank.id, modeId: "m-cheque" });
  });

  it("a mode the account cannot use is reported in plain words", () => {
    const s = read({ account: "Cash", mode: "Fonepay" });
    expect(s.account).toBe("unknown");
    expect(s.accountNote).toMatch(/isn't one of the accounts the mode "Fonepay" can use/);
  });

  it("an unknown mode is reported", () => {
    const s = read({ account: "Cash", mode: "Barter" });
    expect(s.account).toBe("unknown");
    expect(s.accountNote).toMatch(/isn't one of your payment modes/);
  });

  it("a mode alone uses its only account, or the default account when it has several", () => {
    expect(read({ mode: "Fonepay" })).toMatchObject({ account: "ok", accountId: bank.id, modeId: "m-fone" });
    expect(read({ mode: "Cheque" }).account).toBe("unknown");
    expect(read({ mode: "Cheque" }, { accountId: bank2.id, modeId: null })).toMatchObject({ account: "ok", accountId: bank2.id, modeId: "m-cheque" });
  });

  it("an account in several modes with no mode in the file takes the default mode, if that mode can use it", () => {
    expect(read({ account: "Everest Bank" })).toMatchObject({ account: "ok", accountId: bank.id, modeId: null });
    expect(read({ account: "Everest Bank" }, { accountId: null, modeId: "m-xfer" })).toMatchObject({ modeId: "m-xfer" });
    expect(read({ account: "Cash" }, { accountId: null, modeId: "m-xfer" })).toMatchObject({ modeId: "m-cash" }); // its own single mode wins
    expect(read({ account: "Everest Bank" }, { accountId: null, modeId: "m-cash" })).toMatchObject({ modeId: null }); // default mode cannot use this bank
  });
});
