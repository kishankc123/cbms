"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/session";
import { saveInstitution, seedBankInstitutions, setLogo, setLogosByFileName } from "@/lib/banking/institutions";
import type { InstitutionKind } from "@/lib/banking/institution-rules";

// The directory of banks and wallets, for the platform administrator only; each action checks that itself.

const done = <T,>(result: T) => {
  revalidatePath("/admin/banks");
  return result;
};

export async function saveBank(input: { id?: string; countryCode: string; name: string; kind: InstitutionKind; isActive: boolean }) {
  await requirePlatformAdmin();
  return done(await saveInstitution(input));
}

export async function setBankLogo(id: string, file: { type: string; base64: string } | null) {
  await requirePlatformAdmin();
  return done(await setLogo(id, file));
}

export async function setBankLogos(countryCode: string, files: { name: string; type: string; base64: string }[]) {
  await requirePlatformAdmin();
  return done(await setLogosByFileName(countryCode, files));
}

export async function loadStartingBanks(countryCode: string) {
  await requirePlatformAdmin();
  return done(await seedBankInstitutions(countryCode));
}
