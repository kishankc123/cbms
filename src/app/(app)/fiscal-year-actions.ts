"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireTenantSession } from "@/lib/session";
import { activeFiscalYearCookieName } from "@/lib/fiscal";

/** `value` is a fiscal year id, or "all_time". */
export async function setActiveFiscalYear(value: string) {
  const session = await requireTenantSession();
  const store = await cookies();
  store.set(activeFiscalYearCookieName(session.tenantId), value, { path: "/", httpOnly: false, sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  revalidatePath("/", "layout");
}
