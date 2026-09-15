import bcrypt from "bcryptjs";
import { db } from "./index";
import { tenants, users, accounts } from "./schema";
import { DEFAULT_CHART_OF_ACCOUNTS } from "../lib/ledger/default-chart-of-accounts";

async function main() {
  const superAdminEmail = "super@cbms.local";
  const superAdminPassword = "ChangeMe123!";
  const passwordHash = await bcrypt.hash(superAdminPassword, 12);

  await db
    .insert(users)
    .values({
      tenantId: null,
      name: "Super Admin",
      email: superAdminEmail,
      passwordHash,
      role: "super_admin",
      permissions: {},
    })
    .onConflictDoNothing({ target: users.email });

  const [demoTenant] = await db
    .insert(tenants)
    .values({
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

  const adminPasswordHash = await bcrypt.hash("ChangeMe123!", 12);
  await db.insert(users).values({
    tenantId: demoTenant.id,
    name: "Demo Admin",
    email: "admin@demo.local",
    passwordHash: adminPasswordHash,
    role: "admin",
    permissions: {},
  });

  console.log("Seeded:");
  console.log(`  Super Admin: ${superAdminEmail} / ${superAdminPassword}`);
  console.log(`  Demo Tenant: ${demoTenant.companyName} (${demoTenant.id})`);
  console.log(`  Demo Admin: admin@demo.local / ChangeMe123!`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
