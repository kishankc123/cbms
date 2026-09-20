import bcrypt from "bcryptjs";
import { db } from "./index";
import { users, memberships, tenants, subscriptions, accounts } from "./schema";
import { DEFAULT_CHART_OF_ACCOUNTS } from "../lib/ledger/default-chart-of-accounts";

async function main() {
  const superAdminEmail = "super@cbms.local";
  const superAdminPassword = "ChangeMe123!";

  await db
    .insert(users)
    .values({
      name: "Super Admin",
      email: superAdminEmail,
      passwordHash: await bcrypt.hash(superAdminPassword, 12),
      isPlatformAdmin: true,
      emailVerifiedAt: new Date(),
    })
    .onConflictDoNothing({ target: users.email });

  const [demoTenant] = await db
    .insert(tenants)
    .values({
      clientCode: "CL-000001",
      companyName: "Demo Client Pvt. Ltd.",
      industry: "General",
      fiscalYearStartMonth: 1,
      baseCurrency: "NPR",
    })
    .returning();

  await db.insert(accounts).values(
    DEFAULT_CHART_OF_ACCOUNTS.map((a) => ({
      tenantId: demoTenant.id,
      code: a.code,
      name: a.name,
      category: a.category,
      subCategory: a.subCategory,
    }))
  );
  await db.insert(subscriptions).values({ tenantId: demoTenant.id });

  const [demoOwner] = await db
    .insert(users)
    .values({
      name: "Demo Admin",
      email: "admin@demo.local",
      passwordHash: await bcrypt.hash("ChangeMe123!", 12),
      emailVerifiedAt: new Date(),
    })
    .returning();
  await db.insert(memberships).values({ userId: demoOwner.id, tenantId: demoTenant.id, role: "owner" });

  console.log("Seeded:");
  console.log(`  Platform admin: ${superAdminEmail} / ${superAdminPassword}`);
  console.log(`  Demo organization: ${demoTenant.companyName} (${demoTenant.clientCode})`);
  console.log(`  Demo owner: admin@demo.local / ChangeMe123!`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
