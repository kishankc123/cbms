import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { bankInstitutions } from "@/db/schema";
import { institutionForFile, logoProblem, STARTING_INSTITUTIONS, type Institution, type InstitutionKind } from "./institution-rules";

// The directory of banks and wallets a country's organizations pick from. Kept by the platform administrator; the screens read it through listInstitutions.

export async function listInstitutions(countryCode: string, activeOnly = true): Promise<Institution[]> {
  const rows = await db
    .select({ id: bankInstitutions.id, name: bankInstitutions.name, code: bankInstitutions.code, kind: bankInstitutions.kind, isActive: bankInstitutions.isActive, hasLogo: sql<boolean>`${bankInstitutions.logo} is not null`, updatedAt: bankInstitutions.updatedAt })
    .from(bankInstitutions)
    .where(and(eq(bankInstitutions.countryCode, countryCode), activeOnly ? eq(bankInstitutions.isActive, true) : undefined))
    .orderBy(asc(bankInstitutions.kind), asc(bankInstitutions.sortOrder), asc(bankInstitutions.name));
  return rows.map((r) => ({ ...r, kind: r.kind === "wallet" ? "wallet" : "bank", updatedAt: r.updatedAt.toISOString() }));
}

/** Adds an institution, or changes one (name, kind, shown or hidden). */
export async function saveInstitution(input: { id?: string; countryCode: string; name: string; code?: string | null; kind: InstitutionKind; isActive: boolean }): Promise<{ ok: true } | { ok: false; error: string }> {
  const name = input.name.trim();
  const code = input.code?.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12) || null;
  if (!name || name.length > 80) return { ok: false, error: "Enter a name of up to 80 characters." };
  if (input.kind !== "bank" && input.kind !== "wallet") return { ok: false, error: "Choose bank or wallet." };
  try {
    if (input.id) await db.update(bankInstitutions).set({ name, code, kind: input.kind, isActive: input.isActive, updatedAt: new Date() }).where(eq(bankInstitutions.id, input.id));
    else await db.insert(bankInstitutions).values({ countryCode: input.countryCode, name, code, kind: input.kind, isActive: input.isActive });
    return { ok: true };
  } catch {
    return { ok: false, error: `${name} is already in the list.` };
  }
}

/** Sets a logo from a file's type and base64 content, or removes it when file is null. */
export async function setLogo(id: string, file: { type: string; base64: string } | null): Promise<{ ok: true } | { ok: false; error: string }> {
  if (file) {
    const bytes = Buffer.from(file.base64, "base64");
    const problem = logoProblem(file.type, bytes.length, file.type === "image/svg+xml" ? bytes.toString("utf8") : undefined);
    if (problem) return { ok: false, error: problem };
  }
  await db.update(bankInstitutions).set({ logo: file?.base64 ?? null, logoType: file?.type ?? null, updatedAt: new Date() }).where(eq(bankInstitutions.id, id));
  return { ok: true };
}

/** Puts many logo files on their institutions at once, matched by file name. Returns what was done and which files matched nothing (or more than one). */
export async function setLogosByFileName(countryCode: string, files: { name: string; type: string; base64: string }[]): Promise<{ done: string[]; skipped: string[] }> {
  const list = await listInstitutions(countryCode, false);
  const out = { done: [] as string[], skipped: [] as string[] };
  for (const f of files) {
    const id = institutionForFile(f.name, list);
    const result = id ? await setLogo(id, f) : null;
    (result?.ok ? out.done : out.skipped).push(f.name);
  }
  return out;
}

export async function getLogo(id: string): Promise<{ logo: string; logoType: string } | null> {
  const [r] = await db.select({ logo: bankInstitutions.logo, logoType: bankInstitutions.logoType }).from(bankInstitutions).where(eq(bankInstitutions.id, id)).limit(1);
  return r?.logo && r.logoType ? { logo: r.logo, logoType: r.logoType } : null;
}

/** Loads the starting list for a country that has none yet (Nepal only). Returns how many were added. */
export async function seedBankInstitutions(countryCode: string): Promise<number> {
  if (countryCode !== "NP" || (await listInstitutions(countryCode, false)).length > 0) return 0;
  const added = await db.insert(bankInstitutions).values(STARTING_INSTITUTIONS.map((i, n) => ({ countryCode, ...i, sortOrder: n }))).onConflictDoNothing().returning({ id: bankInstitutions.id });
  return added.length;
}
