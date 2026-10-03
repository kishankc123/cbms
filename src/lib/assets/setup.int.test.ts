import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accountRoles, accounts, assetCategories } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { listAccountsWithBalances } from "@/lib/ledger/chart";
import { getExpenseCategoryAccounts } from "@/lib/ledger/expense-accounts";
import { ASSET_ROLES, ensureAssetAccounts } from "./accounts";
import { DEFAULT_ASSET_CATEGORIES, ensureAssetSetup } from "./setup";

let org: Awaited<ReturnType<typeof createTempOrg>>;
let other: Awaited<ReturnType<typeof createTempOrg>>;

beforeAll(async () => {
  org = await createTempOrg("ZZ Assets Setup");
  other = await createTempOrg("ZZ Assets Other");
});
afterAll(async () => {
  await org.remove();
  await other.remove();
});

describe("assets setup", () => {
  it("creates the settings row, the starting categories and the six role accounts, and is safe to repeat", async () => {
    const first = await ensureAssetSetup(org.tenantId);
    expect(first.settings.codePrefix).toBe("FA-");
    expect(first.settings.autoGenerateCode).toBe(true);
    expect(first.settings.depreciationFrequency).toBe("monthly");

    const categories = await db.select().from(assetCategories).where(eq(assetCategories.tenantId, org.tenantId));
    expect(categories.length).toBe(DEFAULT_ASSET_CATEGORIES.length);
    expect(categories.find((c) => c.name === "Land")?.defaultMethod).toBe("none");

    const roles = await db.select().from(accountRoles).where(eq(accountRoles.tenantId, org.tenantId));
    for (const key of Object.values(ASSET_ROLES)) expect(roles.some((r) => r.roleKey === key)).toBe(true);

    await ensureAssetSetup(org.tenantId);
    const again = await db.select().from(assetCategories).where(eq(assetCategories.tenantId, org.tenantId));
    expect(again.length).toBe(categories.length);
    expect((await db.select().from(accountRoles).where(eq(accountRoles.tenantId, org.tenantId))).length).toBe(roles.length);
  });

  it("uses the organization's existing Fixed Assets account, and keeps one organization's setup out of another's", async () => {
    const cost = (await ensureAssetAccounts(org.tenantId))[ASSET_ROLES.cost];
    expect(cost.code).toBe("1500");
    await ensureAssetSetup(other.tenantId);
    const otherCost = (await ensureAssetAccounts(other.tenantId))[ASSET_ROLES.cost];
    expect(otherCost.tenantId).toBe(other.tenantId);
    expect(otherCost.id).not.toBe(cost.id);
  });

  it("never takes over an account that already uses a code the module would like", async () => {
    const third = await createTempOrg("ZZ Assets Taken");
    try {
      // 5500 is the preferred depreciation expense code: occupy it (and the default-chart name) with something else.
      await db.delete(accounts).where(and(eq(accounts.tenantId, third.tenantId), eq(accounts.code, "5500")));
      await db.insert(accounts).values({ tenantId: third.tenantId, code: "5500", name: "Marketing", category: "expense", subCategory: "Indirect expenses" });
      await db.delete(accounts).where(and(eq(accounts.tenantId, third.tenantId), eq(accounts.name, "Depreciation Expense")));

      const { [ASSET_ROLES.depreciationExpense]: dep } = await ensureAssetAccounts(third.tenantId);
      expect(dep.name).toBe("Depreciation Expense");
      expect(dep.code).not.toBe("5500");
      const [marketing] = await db.select().from(accounts).where(and(eq(accounts.tenantId, third.tenantId), eq(accounts.code, "5500")));
      expect(marketing.name).toBe("Marketing");
    } finally {
      await third.remove();
    }
  });

  it("marks the role accounts as system accounts, shows accumulated depreciation as a contra account, and keeps the posting expenses out of expense categories", async () => {
    await ensureAssetSetup(org.tenantId);
    const rows = await listAccountsWithBalances(org.tenantId);
    const accum = rows.find((r) => r.code === "1590")!;
    expect(accum.system).toBe(true);
    expect(accum.contra).toBe(true);
    expect(rows.find((r) => r.code === "1500")!.contra).toBe(false);
    expect(rows.find((r) => r.code === "5500")!.system).toBe(true);

    const expenseCategories = await getExpenseCategoryAccounts(org.tenantId);
    expect(expenseCategories.some((a) => a.code === "5500" || a.code === "5600")).toBe(false);
    expect(expenseCategories.some((a) => a.code === "5300")).toBe(true);
  });
});
