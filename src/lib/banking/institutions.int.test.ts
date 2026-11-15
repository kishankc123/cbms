import { afterAll, describe, expect, it } from "vitest";
import { like } from "drizzle-orm";
import { db } from "@/db";
import { bankInstitutions } from "@/db/schema";
import { getLogo, listInstitutions, saveInstitution, seedBankInstitutions, setLogo, setLogosByFileName } from "./institutions";

// Works on Nepal's directory with names that start "ZZ ", removed afterwards.
const NP = "NP";
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const mine = async () => (await listInstitutions(NP, false)).filter((i) => i.name.startsWith("ZZ "));

afterAll(async () => {
  await db.delete(bankInstitutions).where(like(bankInstitutions.name, "ZZ %"));
});

describe("the directory of banks and wallets", () => {
  it("adds, changes and hides an entry, and refuses the same name twice", async () => {
    expect(await saveInstitution({ countryCode: NP, name: " ZZ Test Bank ", kind: "bank", isActive: true })).toEqual({ ok: true });
    expect(await saveInstitution({ countryCode: NP, name: "zz test bank", kind: "bank", isActive: true })).toMatchObject({ ok: false, error: expect.stringMatching(/already in the list/) });
    expect(await saveInstitution({ countryCode: NP, name: "  ", kind: "bank", isActive: true })).toMatchObject({ ok: false });
    const [a] = await mine();
    expect(a).toMatchObject({ name: "ZZ Test Bank", kind: "bank", isActive: true, hasLogo: false });
    await saveInstitution({ id: a.id, countryCode: NP, name: "ZZ Test Bank", kind: "wallet", isActive: false });
    expect((await mine())[0]).toMatchObject({ kind: "wallet", isActive: false });
    expect((await listInstitutions(NP)).some((i) => i.id === a.id)).toBe(false); // hidden ones are not offered
  });

  it("stores a logo, refuses a bad one, and removes it", async () => {
    const [a] = await mine();
    expect(await setLogo(a.id, { type: "image/png", base64: PNG })).toEqual({ ok: true });
    expect((await mine())[0].hasLogo).toBe(true);
    expect(await getLogo(a.id)).toMatchObject({ logoType: "image/png" });
    expect(await setLogo(a.id, { type: "application/pdf", base64: PNG })).toMatchObject({ ok: false });
    const evil = Buffer.from("<svg onload='x()'></svg>").toString("base64");
    expect(await setLogo(a.id, { type: "image/svg+xml", base64: evil })).toMatchObject({ ok: false, error: expect.stringMatching(/script/) });
    expect((await mine())[0].hasLogo).toBe(true); // the refused ones changed nothing
    await setLogo(a.id, null);
    expect(await getLogo(a.id)).toBeNull();
  });

  it("puts many logos on their banks by file name, and reports the files that matched nothing", async () => {
    await saveInstitution({ countryCode: NP, name: "ZZ Second Bank", kind: "bank", isActive: true });
    const r = await setLogosByFileName(NP, [{ name: "zzsecond.png", type: "image/png", base64: PNG }, { name: "nothing.png", type: "image/png", base64: PNG }]);
    expect(r).toEqual({ done: ["zzsecond.png"], skipped: ["nothing.png"] });
    expect((await mine()).filter((i) => i.hasLogo).map((i) => i.name)).toEqual(["ZZ Second Bank"]);
  });

  it("loads the starting list for Nepal only (it adds what is missing, so it is not run here against real data)", async () => {
    expect(await seedBankInstitutions("IN")).toBe(0);
  });
});
