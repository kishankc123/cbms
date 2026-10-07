import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { createSubAccount } from "@/lib/ledger/control-accounts";
import { createPaymentMode, deletePaymentMode, listLinkableAccounts, listModeOptions, listPaymentModes, modeAccountIds, updatePaymentMode } from "@/lib/payment-modes";

let org: Awaited<ReturnType<typeof createTempOrg>>;
let walletGroup: typeof accounts.$inferSelect;
let fonepayA: string;
let fonepayB: string;
let cashId: string;

const mode = async (name: string) => (await listPaymentModes(org.tenantId)).find((m) => m.name === name)!;

beforeAll(async () => {
  org = await createTempOrg("ZZ Payment Modes");
  cashId = (await db.select().from(accounts).where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.code, "1000"))))[0].id;
  [walletGroup] = await db.insert(accounts).values({ tenantId: org.tenantId, code: "1020", name: "Digital Wallets", category: "asset", subCategory: "Current assets" }).returning();
  fonepayA = (await createSubAccount(org.tenantId, walletGroup, "Fonepay Counter")).id;
  fonepayB = (await createSubAccount(org.tenantId, walletGroup, "Fonepay Online")).id;
});
afterAll(async () => {
  await org.remove();
});

describe("payment modes", () => {
  it("a new organization starts with the standard modes, Cash and Bank transfer linked", async () => {
    const modes = await listPaymentModes(org.tenantId);
    expect(modes.map((m) => m.name)).toEqual(["Cash", "Cheque", "Bank transfer", "Fonepay", "Card", "Wallet"]);
    expect((await mode("Cash")).accounts.map((a) => a.code)).toEqual(["1000"]);
    expect((await mode("Cheque")).accounts).toHaveLength(0);
  });

  it("offers only lowest-level accounts: the group is a heading, its sub-groups are linkable", async () => {
    const codes = (await listLinkableAccounts(org.tenantId)).map((a) => a.code);
    expect(codes).toContain("1020.01");
    expect(codes).not.toContain("1020");
    expect(codes).not.toContain("1100");
    expect(codes).not.toContain("1200");
    const fonepay = await mode("Fonepay");
    const refused = await updatePaymentMode(org.tenantId, org.userId, fonepay.id, { name: "Fonepay", isActive: true, accountIds: [walletGroup.id] });
    expect(refused).toMatchObject({ ok: false, error: expect.stringMatching(/sub-groups/) });
  });

  it("links sub-groups, and one account can serve several modes", async () => {
    const fonepay = await mode("Fonepay");
    expect(await updatePaymentMode(org.tenantId, org.userId, fonepay.id, { name: "Fonepay", isActive: true, accountIds: [fonepayA, fonepayB] })).toMatchObject({ ok: true });
    expect((await mode("Fonepay")).accounts.map((a) => a.code)).toEqual(["1020.01", "1020.02"]);

    const wallet = await mode("Wallet");
    // the same accounts also serve Wallet and Cheque
    expect(await updatePaymentMode(org.tenantId, org.userId, wallet.id, { name: "Wallet", isActive: true, accountIds: [fonepayA, fonepayB] })).toMatchObject({ ok: true });
    const cheque = await mode("Cheque");
    expect(await updatePaymentMode(org.tenantId, org.userId, cheque.id, { name: "Cheque", isActive: true, accountIds: [fonepayA] })).toMatchObject({ ok: true });
    expect((await listLinkableAccounts(org.tenantId)).find((a) => a.id === fonepayA)?.modes.map((m) => m.name)).toEqual(["Cheque", "Fonepay", "Wallet"]);

    // what a payment screen offers: every active mode with its accounts
    const offered = await listModeOptions(org.tenantId);
    expect(offered.map((m) => m.name)).toEqual(["Cash", "Cheque", "Bank transfer", "Fonepay", "Wallet"]); // Card has nothing linked, so it is left out
    expect(offered.find((m) => m.name === "Wallet")!.accounts.map((a) => a.code)).toEqual(["1020.01", "1020.02"]);
    expect(await modeAccountIds(org.tenantId)).toContain(fonepayB);

    // unlinking from one mode leaves the others
    await updatePaymentMode(org.tenantId, org.userId, fonepay.id, { name: "Fonepay", isActive: true, accountIds: [fonepayB] });
    expect((await mode("Fonepay")).accounts.map((a) => a.code)).toEqual(["1020.02"]);
    expect((await mode("Wallet")).accounts).toHaveLength(2);
  });

  it("adds, renames and refuses a duplicate or empty name", async () => {
    const added = await createPaymentMode(org.tenantId, org.userId, { name: "  QR   code ", isActive: true, accountIds: [] });
    expect(added).toMatchObject({ ok: true });
    expect((await mode("QR code")).sortOrder).toBe(7);
    expect(await createPaymentMode(org.tenantId, org.userId, { name: "qr CODE", isActive: true, accountIds: [] })).toMatchObject({ ok: false, error: expect.stringMatching(/already a mode/) });
    expect(await createPaymentMode(org.tenantId, org.userId, { name: "   ", isActive: true, accountIds: [] })).toMatchObject({ ok: false });
    if (added.ok) expect(await updatePaymentMode(org.tenantId, org.userId, added.modeId, { name: "Cash", isActive: true, accountIds: [] })).toMatchObject({ ok: false, error: expect.stringMatching(/already a mode/) });
  });

  it("a linked account later given sub-groups is flagged, not silently used", async () => {
    const cash = await mode("Cash");
    await createSubAccount(org.tenantId, { id: cashId, code: "1000", category: "asset", subCategory: "Current assets" }, "Counter Cash");
    const after = (await mode("Cash")).accounts.find((a) => a.id === cashId)!;
    expect(after.usable).toBe(false);
    expect(cash.accounts[0].usable).toBe(true);
  });

  it("deleting a mode only removes its links", async () => {
    const fonepay = await mode("Fonepay");
    expect(await deletePaymentMode(org.tenantId, org.userId, fonepay.id)).toMatchObject({ ok: true });
    expect((await listPaymentModes(org.tenantId)).some((m) => m.name === "Fonepay")).toBe(false);
    expect((await db.select().from(accounts).where(eq(accounts.id, fonepayA))).length).toBe(1);
    // the account stays linked to its other modes
    expect((await listLinkableAccounts(org.tenantId)).find((a) => a.id === fonepayA)?.modes.map((m) => m.name)).toEqual(["Cheque", "Wallet"]);
  });
});
