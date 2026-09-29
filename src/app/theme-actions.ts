"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { themeCookieName, type Theme } from "@/lib/theme";

export async function setTheme(value: Theme) {
  const store = await cookies();
  store.set(themeCookieName, value, { path: "/", httpOnly: false, sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  revalidatePath("/", "layout");
}
