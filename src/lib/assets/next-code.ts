import { and, eq, like } from "drizzle-orm";
import { db } from "@/db";
import { assets, assetSettings } from "@/db/schema";
import { buildAssetCode, nextAssetSequence } from "./codes";

/** The next free asset code, for example FA-000012. Two people saving at once are settled by the unique index. */
export async function nextAssetCode(tenantId: string, skip = 0): Promise<string> {
  const [settings] = await db.select({ prefix: assetSettings.codePrefix }).from(assetSettings).where(eq(assetSettings.tenantId, tenantId)).limit(1);
  const prefix = settings?.prefix ?? "FA-";
  const rows = await db.select({ code: assets.assetCode }).from(assets).where(and(eq(assets.tenantId, tenantId), like(assets.assetCode, `${prefix}%`)));
  return buildAssetCode(prefix, nextAssetSequence(prefix, rows.map((r) => r.code)) + skip);
}
